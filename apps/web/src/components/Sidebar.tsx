import type { Conversation, Theme } from "../lib/types";
import { MoonIcon, PlusIcon, SidebarIcon, SunIcon, TrashIcon } from "./Icons";

interface SidebarProps {
  conversations: Conversation[];
  activeId: string | null;
  open: boolean;
  theme: Theme;
  onClose: () => void;
  onNew: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onToggleTheme: () => void;
}

export default function Sidebar({
  conversations,
  activeId,
  open,
  theme,
  onClose,
  onNew,
  onSelect,
  onDelete,
  onToggleTheme,
}: SidebarProps) {
  return (
    <aside className={`sidebar${open ? " open" : ""}`} aria-label="会话列表">
      <div className="sidebar-head">
        <div className="brand">
          <span className="brand-logo">D</span>
          <span className="brand-name">Dream</span>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="收起边栏" title="收起边栏">
          <SidebarIcon size={18} />
        </button>
      </div>

      <button type="button" className="new-chat" onClick={onNew} aria-label="开启新对话">
        <PlusIcon size={18} />
        <span>开启新对话</span>
      </button>

      <nav className="conv-list">
        {conversations.length === 0 ? (
          <p className="conv-empty">还没有对话记录</p>
        ) : (
          conversations.map((conversation) => (
            <div
              key={conversation.id}
              className={`conv-item${conversation.id === activeId ? " active" : ""}`}
              role="button"
              tabIndex={0}
              aria-label={conversation.title}
              title={conversation.title}
              onClick={() => onSelect(conversation.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(conversation.id);
                }
              }}
            >
              <span className="conv-title">{conversation.title}</span>
              <button
                type="button"
                className="conv-del"
                aria-label="删除对话"
                title="删除对话"
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete(conversation.id);
                }}
              >
                <TrashIcon size={15} />
              </button>
            </div>
          ))
        )}
      </nav>

      <div className="sidebar-foot">
        <button
          type="button"
          className="theme-toggle"
          onClick={onToggleTheme}
          aria-label={theme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
        >
          {theme === "dark" ? <SunIcon size={16} /> : <MoonIcon size={16} />}
          <span>{theme === "dark" ? "浅色模式" : "深色模式"}</span>
        </button>
        <span className="version">v0.1</span>
      </div>
    </aside>
  );
}
