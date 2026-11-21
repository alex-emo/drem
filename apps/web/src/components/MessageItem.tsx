import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { VersionInfo } from "../lib/branches";
import type { Message } from "../lib/types";
import BranchSwitcher from "./BranchSwitcher";
import { CheckIcon, CopyIcon, EditIcon } from "./Icons";
import Markdown from "./Markdown";

/** 把服务端返回的 [n] 引用编号转成可点击的站内链接，代码块内不转换。 */
function linkCitations(text: string): string {
  const segments = text.split(/(```[\s\S]*?```|`[^`]*`)/g);
  return segments
    .map((segment, index) => {
      if (index % 2 === 1) return segment;
      return segment.replace(/\[(\d+)\]/g, (_match, n: string) => `[[${n}]](#source-${n})`);
    })
    .join("");
}

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

interface MessageItemProps {
  message: Message;
  versions?: VersionInfo;
  streaming: boolean;
  onEdit: (messageId: string, content: string) => Promise<boolean>;
  onSelectVersion: (messageId: string) => void;
}

export default function MessageItem({
  message,
  versions,
  streaming,
  onEdit,
  onSelectVersion,
}: MessageItemProps) {
  const displayContent = linkCitations(message.content);
  const contentRef = useRef(displayContent);
  contentRef.current = displayContent;
  const [streamText, setStreamText] = useState(displayContent);
  const sourcesRef = useRef<HTMLDetailsElement>(null);

  const jumpToSource = (index: number) => {
    const details = sourcesRef.current;
    if (!details) return;
    details.open = true;
    window.setTimeout(() => {
      const target = document.getElementById(`source-${index}`);
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
      target?.classList.add("source-flash");
      window.setTimeout(() => target?.classList.remove("source-flash"), 1200);
    }, 30);
  };
  useEffect(() => {
    setStreamText(displayContent);
    if (message.status !== "streaming") return;
    const timer = window.setInterval(() => setStreamText(contentRef.current), 120);
    return () => window.clearInterval(timer);
  }, [message.id, message.status]);

  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!editing || !textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 202)}px`;
    textarea.focus();
  }, [editing, draft]);

  useEffect(() => {
    if (streaming) setEditing(false);
  }, [streaming]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // 忽略
    }
  };

  const save = async () => {
    if (!draft.trim() || saving) return;
    setSaving(true);
    try {
      const ok = await onEdit(message.id, draft);
      if (ok) setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  if (message.role === "user") {
    return (
      <div className="msg user">
        {editing ? (
          <div className="msg-editor">
            <textarea
              ref={textareaRef}
              className="msg-editor-input"
              aria-label="编辑消息"
              rows={1}
              value={draft}
              disabled={saving}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if (event.key === "Escape") {
                  setEditing(false);
                } else if (event.key === "Enter" && !event.shiftKey && window.innerWidth > 700) {
                  event.preventDefault();
                  void save();
                }
              }}
            />
            <div className="msg-editor-actions">
              <button type="button" className="btn ghost small" onClick={() => setEditing(false)}>
                取消
              </button>
              <button
                type="button"
                className="btn primary small"
                disabled={!draft.trim() || saving}
                onClick={() => void save()}
              >
                {saving ? "发送中…" : "发送"}
              </button>
            </div>
          </div>
        ) : (
          <>
            {message.files && message.files.length > 0 ? (
              <div className="msg-files">
                {message.files.map((file) => (
                  <span className="file-chip" key={file.id} title={`${file.chars} 字符`}>
                    {file.name}
                  </span>
                ))}
              </div>
            ) : null}
            <div className="bubble">{message.content}</div>
            <div className="msg-actions">
              <button
                type="button"
                className="icon-btn small"
                onClick={() => void copy()}
                aria-label="复制消息"
                title="复制"
              >
                {copied ? <CheckIcon size={15} /> : <CopyIcon size={15} />}
              </button>
              <button
                type="button"
                className="icon-btn small"
                onClick={() => {
                  setDraft(message.content);
                  setEditing(true);
                }}
                aria-label="编辑消息"
                title="编辑消息"
                disabled={streaming}
              >
                <EditIcon size={15} />
              </button>
            </div>
            {versions && versions.ids.length > 1 ? (
              <BranchSwitcher versions={versions} disabled={streaming} onSelect={onSelectVersion} />
            ) : null}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="msg assistant">
      {message.reasoning ? <ThinkingBlock text={message.reasoning} streaming={message.status === "streaming"} /> : null}

      {message.content ? (
        <div className="markdown">
          {message.status === "streaming" ? (
            <>
              <Markdown content={streamText} onCitationClick={jumpToSource} />
              <span className="cursor" aria-hidden="true" />
            </>
          ) : (
            <Markdown content={displayContent} onCitationClick={jumpToSource} />
          )}
        </div>
      ) : message.status === "streaming" ? (
        <div className="typing" aria-label="正在生成">
          <i />
          <i />
          <i />
        </div>
      ) : null}

      {message.status === "error" ? (
        <div className="msg-error">
          <div>{message.error ?? "生成失败，请稍后重试"}</div>
          {message.errorRequestId ? (
            <div className="msg-error-meta">
              {message.errorCode ? `${message.errorCode} · ` : ""}
              错误编号：{message.errorRequestId}
            </div>
          ) : null}
        </div>
      ) : null}

      {message.sources && message.sources.length > 0 ? (
        <details className="msg-sources" ref={sourcesRef}>
          <summary className="msg-sources-title">参考来源 · {message.sources.length}</summary>
          <div className="msg-sources-list">
          {message.sources.map((source) => (
            <a
              key={`${source.index}-${source.url}`}
              id={`source-${source.index}`}
              className="source-item"
              href={source.url}
              target="_blank"
              rel="noreferrer noopener"
            >
              <span className="source-index">{source.index}</span>
              <span className="source-title">{source.title}</span>
              {source.siteName ? <span className="source-site">{source.siteName}</span> : null}
            </a>
          ))}
          </div>
        </details>
      ) : null}

      {(message.status === "done" || message.status === "refused") && message.content ? (
        <div className="msg-actions">
          <button type="button" className="icon-btn small" onClick={() => void copy()} aria-label="复制回复" title="复制">
            {copied ? <CheckIcon size={15} /> : <CopyIcon size={15} />}
          </button>
          {versions && versions.ids.length > 1 ? (
            <BranchSwitcher versions={versions} disabled={streaming} onSelect={onSelectVersion} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
