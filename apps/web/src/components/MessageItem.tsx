import { useEffect, useState } from "react";
import type { Message } from "../lib/types";
import { CheckIcon, CopyIcon } from "./Icons";
import Markdown from "./Markdown";

function ThinkingBlock({ text, streaming }: { text: string; streaming: boolean }) {
  const [open, setOpen] = useState(streaming);

  useEffect(() => {
    setOpen(streaming);
  }, [streaming]);

  return (
    <div className={`thinking${open ? " expanded" : ""}`}>
      <button
        type="button"
        className="thinking-summary"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span>{streaming ? "深度思考中…" : "已深度思考"}</span>
        <span className="chev" aria-hidden="true" />
      </button>
      {open ? <div className="thinking-body">{text}</div> : null}
    </div>
  );
}

export default function MessageItem({ message }: { message: Message }) {
  const [copied, setCopied] = useState(false);

  if (message.role === "user") {
    return (
      <div className="msg user">
        <div className="bubble">{message.content}</div>
      </div>
    );
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // 忽略
    }
  };

  return (
    <div className="msg assistant">
      {message.reasoning ? <ThinkingBlock text={message.reasoning} streaming={message.status === "streaming"} /> : null}

      {message.content ? (
        <div className="markdown">
          <Markdown content={message.content} />
          {message.status === "streaming" ? <span className="cursor" aria-hidden="true" /> : null}
        </div>
      ) : message.status === "streaming" ? (
        <div className="typing" aria-label="正在生成">
          <i />
          <i />
          <i />
        </div>
      ) : null}

      {message.status === "error" ? <div className="msg-error">{message.error ?? "生成失败，请稍后重试"}</div> : null}

      {message.status === "done" && message.content ? (
        <div className="msg-actions">
          <button type="button" className="icon-btn small" onClick={copy} aria-label="复制回复" title="复制">
            {copied ? <CheckIcon size={15} /> : <CopyIcon size={15} />}
          </button>
        </div>
      ) : null}
    </div>
  );
}
