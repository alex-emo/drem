import type { ChatController } from "../hooks/useChat";
import type { HealthState } from "../lib/types";
import Composer from "./Composer";
import { SidebarIcon } from "./Icons";
import MessageList from "./MessageList";

interface ChatViewProps {
  chat: ChatController;
  health: HealthState;
  onToggleSidebar: () => void;
}

export default function ChatView({ chat, health, onToggleSidebar }: ChatViewProps) {
  const activeTitle = chat.conversations.find((conversation) => conversation.id === chat.activeId)?.title ?? "新对话";

  return (
    <main className="main">
      <header className="main-header">
        <button type="button" className="icon-btn" onClick={onToggleSidebar} aria-label="切换边栏" title="切换边栏">
          <SidebarIcon size={18} />
        </button>
        <h1 className="header-title">{activeTitle}</h1>
      </header>

      {health.kind === "error" ? (
        <div className="banner">
          无法连接本地服务端，请确认已运行 <code>pnpm dev:server</code>。
        </div>
      ) : null}
      {health.kind === "ok" && health.info.mock ? (
        <div className="banner">演示模式：当前回复由本地模拟生成，未调用上游模型。</div>
      ) : null}
      {health.kind === "ok" && !health.info.mock && !health.info.hasApiKey ? (
        <div className="banner">Dream 模型服务暂不可用，请联系管理员。</div>
      ) : null}

      {chat.messages.length === 0 ? (
        <div className="chat-scroll">
          <div className="chat-inner empty">
            <h1>今天有什么可以帮到你？</h1>
          </div>
        </div>
      ) : (
        <MessageList
          messages={chat.messages}
          versions={chat.versions}
          streaming={chat.streaming}
          onEdit={chat.editMessage}
          onRegenerate={chat.regenerate}
          onSelectVersion={chat.selectMessageVersion}
        />
      )}

      <div className="composer-wrap">
        <div className="composer-inner">
          <Composer
            streaming={chat.streaming}
            thinking={chat.thinking}
            onToggleThinking={() => chat.setThinking((value) => !value)}
            onSend={(text, files, webSearch) => {
              void chat.sendMessage(text, { files, webSearch });
            }}
            onStop={chat.stop}
          />
          <p className="disclaimer">内容由 AI 生成，请仔细甄别</p>
        </div>
      </div>
    </main>
  );
}
