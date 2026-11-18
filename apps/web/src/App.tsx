import { useEffect, useState } from "react";
import ChatView from "./components/ChatView";
import Sidebar from "./components/Sidebar";
import { useChat } from "./hooks/useChat";
import type { HealthInfo, Theme } from "./lib/types";

function initialTheme(): Theme {
  try {
    return localStorage.getItem("dream-theme") === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export default function App() {
  const chat = useChat();
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 820);
  const [health, setHealth] = useState<HealthInfo | null>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "dark" ? "#151517" : "#ffffff");
    try {
      localStorage.setItem("dream-theme", theme);
    } catch {
      // 忽略隐私模式下的存储错误
    }
  }, [theme]);

  useEffect(() => {
    let alive = true;
    fetch("/api/health")
      .then((response) => response.json())
      .then((data: HealthInfo) => {
        if (alive) setHealth(data);
      })
      .catch(() => {
        if (alive) setHealth({ ok: false, mock: false, hasKey: false });
      });
    return () => {
      alive = false;
    };
  }, []);

  const closeOnMobile = () => {
    if (window.innerWidth <= 820) setSidebarOpen(false);
  };

  return (
    <div className="app">
      <Sidebar
        conversations={chat.conversations}
        activeId={chat.activeId}
        open={sidebarOpen}
        theme={theme}
        onClose={() => setSidebarOpen(false)}
        onNew={() => {
          chat.newChat();
          closeOnMobile();
        }}
        onSelect={(id) => {
          void chat.openConversation(id);
          closeOnMobile();
        }}
        onDelete={(id) => {
          if (window.confirm("确定删除这个对话吗？删除后无法恢复。")) {
            void chat.removeConversation(id);
          }
        }}
        onToggleTheme={() => setTheme((value) => (value === "dark" ? "light" : "dark"))}
      />
      {sidebarOpen ? <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} /> : null}
      <ChatView chat={chat} health={health} onToggleSidebar={() => setSidebarOpen((value) => !value)} />
    </div>
  );
}
