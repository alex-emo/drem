import type { AuthUser, Conversation, Theme } from "../lib/types";
import {
  LogoutIcon,
  MoonIcon,
  PlusIcon,
  SettingsIcon,
  SidebarIcon,
  SunIcon,
  TrashIcon,
} from "./Icons";

interface SidebarProps {
  conversations: Conversation[];
  activeId: string | null;
  open: boolean;
  theme: Theme;
  user: AuthUser;
  onClose: () => void;
  onNew: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onToggleTheme: () => void;
  onOpenSettings: () => void;
  onLogout: () => void;
}

export default function Sidebar({
  conversations,
  activeId,
  open,
  theme,
  user,
  onClose,
  onNew,
  onSelect,
  onDelete,
  onToggleTheme,
  onOpenSettings,
  onLogout,
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
        <div className="sidebar-user">
          <span className="avatar" aria-hidden="true">
            {(user.displayName || user.username).slice(0, 1).toUpperCase()}
          </span>
          <span className="sidebar-user-name" title={user.displayName || user.username}>
            {user.displayName || user.username}
          </span>
          <button
            type="button"
            className="icon-btn"
            onClick={onLogout}
            aria-label="退出登录"
            title="退出登录"
          >
            <LogoutIcon size={16} />
          </button>
        </div>
        <div className="sidebar-foot-row">
          <div className="sidebar-foot-actions">
            <button
            type="button"
            className="theme-toggle"
            onClick={onToggleTheme}
            aria-label={theme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
          >
            {theme === "dark" ? <SunIcon size={16} /> : <MoonIcon size={16} />}
            <span>{theme === "dark" ? "浅色模式" : "深色模式"}</span>
          </button>
          <button
            type="button"
            className="theme-toggle"
            onClick={onOpenSettings}
            aria-label="打开设置"
            title="设置"
          >
            <SettingsIcon size={16} />
              <span>设置</span>
            </button>
          </div>
          {user.isAdmin ? (
            <a className="admin-entry" href="/admin" title="管理后台">
              后台
            </a>
          ) : null}
          <span className="version">v0.2</span>
        </div>
      </div>
    </aside>
  );
}
