import { useEffect, useRef, useState } from "react";
import { uploadFile } from "../lib/api";
import type { FileAttachment } from "../lib/types";
import { CloseIcon, FileIcon, GlobeIcon, PaperclipIcon, SendIcon, SparkleIcon, StopIcon } from "./Icons";

const ACCEPT = ".txt,.md,.markdown,.csv,.json,.jsonl,.log,.yaml,.yml,.xml,.html,.css,.js,.jsx,.ts,.tsx,.py,.java,.go,.rs,.c,.h,.cpp,.hpp,.cs,.rb,.php,.swift,.kt,.sh,.sql,.toml,.ini,.conf,.tex,.srt";
const MAX_FILES = 5;

interface ComposerProps {
  streaming: boolean;
  thinking: boolean;
  onToggleThinking: () => void;
  onSend: (text: string, files: FileAttachment[], webSearch: boolean) => void;
  onStop: () => void;
}

export default function Composer({ streaming, thinking, onToggleThinking, onSend, onStop }: ComposerProps) {
  const [value, setValue] = useState("");
  const [files, setFiles] = useState<FileAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [webSearch, setWebSearch] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 200)}px`;
  }, [value]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const uploadSelected = async (selected: FileList | null) => {
    if (!selected || selected.length === 0) return;
    setUploadError("");
    setUploading(true);
    try {
      const next = [...files];
      for (const file of Array.from(selected)) {
        if (next.length >= MAX_FILES) {
          setUploadError(`一次最多上传 ${MAX_FILES} 个文件`);
          break;
        }
        if (file.size > 10 * 1024 * 1024) {
          setUploadError(`「${file.name}」超过 10 MiB`);
          continue;
        }
        const uploaded = await uploadFile(file);
        next.push(uploaded);
      }
      setFiles(next);
    } catch (error) {
      setUploadError((error as Error).message || "上传失败");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const submit = () => {
    const text = value.trim();
    if ((!text && files.length === 0) || streaming || uploading) return;
    onSend(text || "请阅读并总结我上传的文件。", files, webSearch);
    setValue("");
    setFiles([]);
  };

  return (
    <div className="composer">
      {files.length > 0 && (
        <div className="composer-files">
          {files.map((file) => (
            <span className="file-chip" key={file.id} title={`${file.name} · ${file.chars} 字符`}>
              <FileIcon size={14} />
              <span className="file-chip-name">{file.name}</span>
              <button
                type="button"
                className="file-chip-remove"
                aria-label={`移除 ${file.name}`}
                onClick={() => setFiles((prev) => prev.filter((item) => item.id !== file.id))}
              >
                <CloseIcon size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      {uploadError && <div className="composer-error">{uploadError}</div>}
      <textarea
        ref={textareaRef}
        value={value}
        rows={1}
        placeholder="给 Dream 发送消息"
        aria-label="输入消息"
        enterKeyHint="send"
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            submit();
          }
        }}
      />
      <div className="composer-bar">
        <div className="composer-tools">
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            multiple
            hidden
            onChange={(event) => void uploadSelected(event.target.files)}
          />
          <button
            type="button"
            className="icon-btn"
            onClick={() => inputRef.current?.click()}
            disabled={uploading || streaming}
            aria-label="上传文本文件"
            title="上传文本文件（txt / md / csv / json / 代码）"
          >
            <PaperclipIcon size={18} />
          </button>
          <button
            type="button"
            className={`chip${thinking ? " active" : ""}`}
            onClick={onToggleThinking}
            aria-pressed={thinking}
            aria-label="深度思考"
            title="展示模型思考过程"
          >
            <SparkleIcon size={15} />
            <span>深度思考</span>
          </button>
          <button
            type="button"
            className={`chip${webSearch ? " active" : ""}`}
            onClick={() => setWebSearch((prev) => !prev)}
            aria-pressed={webSearch}
            aria-label="联网搜索"
            title="搜索互联网后再回答"
          >
            <GlobeIcon size={15} />
            <span>联网搜索</span>
          </button>
          {uploading && <span className="composer-hint">上传中…</span>}
        </div>

        {streaming ? (
          <button type="button" className="send-btn stop" onClick={onStop} aria-label="停止生成" title="停止生成">
            <StopIcon size={16} />
          </button>
        ) : (
          <button
            type="button"
            className="send-btn"
            onClick={submit}
            disabled={(!value.trim() && files.length === 0) || uploading}
            aria-label="发送"
            title="发送"
          >
            <SendIcon size={18} />
          </button>
        )}
      </div>
    </div>
  );
}
