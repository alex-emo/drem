import { useEffect, useState } from "react";
import ChatView from "./components/ChatView";
import SettingsDialog from "./components/SettingsDialog";
import Sidebar from "./components/Sidebar";
import { useChat } from "./hooks/useChat";
import type { HealthInfo, HealthState, Theme } from "./lib/types";

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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [health, setHealth] = useState<HealthState>({ kind: "loading" });

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
    fetch("/api/v1/health")
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return (await response.json()) as HealthInfo;
      })
      .then((info) => {
        if (alive) setHealth({ kind: "ok", info });
      })
      .catch(() => {
        if (alive) setHealth({ kind: "error" });
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
        onOpenSettings={() => {
          setSettingsOpen(true);
          closeOnMobile();
        }}
      />
      {sidebarOpen ? <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} /> : null}
      <ChatView chat={chat} health={health} onToggleSidebar={() => setSidebarOpen((value) => !value)} />
      <SettingsDialog
        open={settingsOpen}
        theme={theme}
        health={health}
        onClose={() => setSettingsOpen(false)}
        onThemeChange={setTheme}
        onImport={chat.importHistory}
      />
    </div>
  );
}
