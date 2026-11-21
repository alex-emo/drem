import { useEffect, useRef, useState } from "react";
import { SendIcon, SparkleIcon, StopIcon } from "./Icons";

interface ComposerProps {
  streaming: boolean;
  thinking: boolean;
  onToggleThinking: () => void;
  onSend: (text: string) => void;
  onStop: () => void;
}

export default function Composer({ streaming, thinking, onToggleThinking, onSend, onStop }: ComposerProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 200)}px`;
  }, [value]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const submit = () => {
    const text = value.trim();
    if (!text || streaming) return;
    onSend(text);
    setValue("");
  };

  return (
    <div className="composer">
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

        {streaming ? (
          <button type="button" className="send-btn stop" onClick={onStop} aria-label="停止生成" title="停止生成">
            <StopIcon size={16} />
          </button>
        ) : (
          <button
            type="button"
            className="send-btn"
            onClick={submit}
            disabled={!value.trim()}
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
