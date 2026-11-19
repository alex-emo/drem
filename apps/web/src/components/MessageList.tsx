import { useEffect, useRef } from "react";
import type { VersionInfo } from "../lib/branches";
import type { Message } from "../lib/types";
import MessageItem from "./MessageItem";

interface MessageListProps {
  messages: Message[];
  versions: Map<string, VersionInfo>;
  streaming: boolean;
  onEdit: (messageId: string, content: string) => Promise<boolean>;
  onSelectVersion: (messageId: string) => void;
}

export default function MessageList({
  messages,
  versions,
  streaming,
  onEdit,
  onSelectVersion,
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    if (pinnedRef.current) {
      element.scrollTop = element.scrollHeight;
    }
  }, [messages]);

  return (
    <div
      className="chat-scroll"
      ref={scrollRef}
      onScroll={(event) => {
        const element = event.currentTarget;
        pinnedRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 120;
      }}
    >
      <div className="chat-inner">
        {messages.map((message) => (
          <MessageItem
            key={message.id}
            message={message}
            versions={versions.get(message.id)}
            streaming={streaming}
            onEdit={onEdit}
            onSelectVersion={onSelectVersion}
          />
        ))}
      </div>
    </div>
  );
}
