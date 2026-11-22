import { useEffect, useRef, useState } from "react";
import ChatView from "./components/ChatView";
import LoginScreen from "./components/LoginScreen";
import SettingsDialog from "./components/SettingsDialog";
import Sidebar from "./components/Sidebar";
import { useChat } from "./hooks/useChat";
import { ChatApiError, fetchMe, logoutAccount } from "./lib/api";
import { clearSession, getStoredUser, getToken } from "./lib/auth";
import type { AuthUser, HealthInfo, HealthState, Theme } from "./lib/types";

type AuthState =
  | { kind: "checking" }
  | { kind: "anon" }
  | { kind: "authed"; user: AuthUser };

export default function App() {
  const [auth, setAuth] = useState<AuthState>(() => {
    if (!getToken()) return { kind: "anon" };
    // 有本地用户时先进入聊天界面，避免弱网刷新时一直停在“检查登录状态”。
    const cached = getStoredUser();
    return cached ? { kind: "authed", user: cached } : { kind: "checking" };
  });

  useEffect(() => {
    if (!getToken()) return;
    let alive = true;
    fetchMe()
      .then((user) => {
        if (alive) setAuth({ kind: "authed", user });
      })
      .catch((error: unknown) => {
        if (!alive) return;
        // 只有 401 才代表凭证失效；网络超时保留本地登录态，避免刷新黑屏。
        if (error instanceof ChatApiError && error.status === 401) {
          clearSession();
          setAuth({ kind: "anon" });
        } else if (!getStoredUser()) {
          setAuth({ kind: "anon" });
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    void navigator.storage?.persist?.().catch(() => undefined);
  }, []);

  useEffect(() => {
    const onUnauthorized = () => {
      clearSession();
      setAuth({ kind: "anon" });
    };
    window.addEventListener("dream:unauthorized", onUnauthorized);
    return () => window.removeEventListener("dream:unauthorized", onUnauthorized);
  }, []);

  const logout = async () => {
    await logoutAccount();
    clearSession();
    setAuth({ kind: "anon" });
  };

  if (auth.kind === "checking") {
    return (
      <div className="auth-screen">
        <p className="auth-muted">正在检查登录状态…</p>
      </div>
    );
  }

  if (auth.kind === "anon") {
    return <LoginScreen onAuthenticated={(user) => setAuth({ kind: "authed", user })} />;
  }

  return <ChatShell user={auth.user} onLogout={() => void logout()} />;
}

function initialTheme(): Theme {
  try {
    return localStorage.getItem("dream-theme") === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function ChatShell({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  const chat = useChat();
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [contentWidth, setContentWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem("dream-content-width"));
    return Number.isFinite(saved) && saved >= 560 && saved <= 1100 ? saved : 760;
  });
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 820);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const sidebarOpenRef = useRef(sidebarOpen);
  sidebarOpenRef.current = sidebarOpen;
  const [health, setHealth] = useState<HealthState>({ kind: "loading" });

  // 移动浏览器：左缘右滑打开、抽屉内左滑关闭，贴合原生 App 手势
  useEffect(() => {
    let startX = 0;
    let startY = 0;
    let tracking: "open" | "close" | null = null;
    const onStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return;
      const touch = event.touches[0];
      const target = event.target as Element | null;
      // 全屏右滑也能打开侧栏；但代码块、输入框、可编辑区域优先保留自己的手势
      if (
        target?.closest(
          "pre, code, textarea, input, select, [contenteditable='true'], .code-block",
        )
      ) {
        tracking = null;
        return;
      }
      tracking = sidebarOpenRef.current ? "close" : "open";
      startX = touch.clientX;
      startY = touch.clientY;
    };
    const onMove = (event: TouchEvent) => {
      if (!tracking || event.touches.length !== 1) return;
      const touch = event.touches[0];
      const dx = touch.clientX - startX;
      const dy = Math.abs(touch.clientY - startY);
      if (dy > 48) return;
      if (tracking === "open" && dx > 56) {
        tracking = null;
        setSidebarOpen(true);
      } else if (tracking === "close" && dx < -56) {
        tracking = null;
        setSidebarOpen(false);
      }
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", () => (tracking = null), { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
    };
  }, []);

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
    document.documentElement.style.setProperty("--content-width", `${contentWidth}px`);
    localStorage.setItem("dream-content-width", String(contentWidth));
  }, [contentWidth]);

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
        user={user}
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
        onLogout={onLogout}
      />
      {sidebarOpen ? <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} /> : null}
      <ChatView chat={chat} health={health} onToggleSidebar={() => setSidebarOpen((value) => !value)} />
      <SettingsDialog
        open={settingsOpen}
        theme={theme}
        contentWidth={contentWidth}
        onContentWidthChange={setContentWidth}
        health={health}
        onClose={() => setSettingsOpen(false)}
        onThemeChange={setTheme}
        onImport={chat.importHistory}
        onImportShare={chat.importShare}
        onImportArchiveUrl={chat.importArchiveUrl}
      />
    </div>
  );
}
