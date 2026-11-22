import { useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { CheckIcon, CopyIcon } from "./Icons";

function supportsLookbehind(): boolean {
  try {
    new RegExp("(?<!a)b");
    return true;
  } catch {
    return false;
  }
}

function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map((child) => textOf(child)).join("");
  if (typeof node === "object" && "props" in node) {
    return textOf((node as { props?: { children?: ReactNode } }).props?.children);
  }
  return "";
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const child = Array.isArray(children) ? children[0] : children;
  const className =
    (child as { props?: { className?: string } } | null | undefined)?.props?.className ?? "";
  const language = /language-([\w-]+)/.exec(className)?.[1] ?? "";
  const code = textOf(children);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // 剪贴板不可用时静默失败
    }
  };

  return (
    <div className="code-block">
      <div className="code-head">
        <span>{language || "code"}</span>
        <button type="button" onClick={copy} aria-label="复制代码">
          {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
          <span>{copied ? "已复制" : "复制"}</span>
        </button>
      </div>
      <pre>{children}</pre>
    </div>
  );
}

export default function Markdown({
  content,
  onCitationClick,
}: {
  content: string;
  onCitationClick?: (index: number) => void;
}) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={supportsLookbehind() ? [remarkGfm] : []}
        rehypePlugins={[[rehypeHighlight, { detect: false, ignoreMissing: true }]]}
        components={{
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
          a: (props) => {
            const match = /^#source-(\d+)$/.exec(props.href ?? "");
            if (match) {
              return (
                <a
                  href={props.href}
                  className="citation"
                  onClick={(event) => {
                    event.preventDefault();
                    onCitationClick?.(Number(match[1]));
                  }}
                >
                  {props.children}
                </a>
              );
            }
            return (
              <a href={props.href} target="_blank" rel="noreferrer noopener">
                {props.children}
              </a>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
