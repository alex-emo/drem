import { useEffect, useRef, useState } from "react";
import ChatView from "./components/ChatView";
import LoginScreen from "./components/LoginScreen";
import SettingsDialog from "./components/SettingsDialog";
import NoticeDialog from "./components/NoticeDialog";
import Sidebar from "./components/Sidebar";
import { useChat } from "./hooks/useChat";
import { ChatApiError, fetchMe, logoutAccount } from "./lib/api";
import { clearSession, getStoredUser, getToken } from "./lib/auth";
import { downloadBackup } from "./lib/backup";
import { detectPrivateMode } from "./lib/privacy";
import { lockAccount, maybePushCloudBackup, pushCloudBackup, unlockAccount, type UnlockResult } from "./lib/cloudSync";
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
    const onUnauthorized = () => {
      lockAccount();
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

  return <AuthedShell user={auth.user} onLogout={() => void logout()} />;
}

function AuthedShell({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  const [state, setState] = useState<
    { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; cloud: UnlockResult }
  >({ kind: "loading" });

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      controller.abort();
    }, 45_000);
    void unlockAccount(user.id, controller.signal)
      .then((cloud) => {
        if (alive) setState({ kind: "ready", cloud });
      })
      .catch((error: unknown) => {
        if (alive) {
          setState({
            kind: "error",
            message: controller.signal.aborted
              ? "同步超时，请检查网络后重试。"
              : error instanceof Error
                ? error.message
                : "无法获取聊天记录密钥。",
          });
        }
      })
      .finally(() => window.clearTimeout(timer));
    return () => {
      alive = false;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, []);

  if (state.kind === "loading") {
    return (
      <div className="auth-screen">
        <p className="auth-muted">正在解密并同步聊天记录…</p>
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <h1>无法解锁聊天记录</h1>
          <p className="auth-muted">{state.message}</p>
          <button type="button" className="btn primary" onClick={() => window.location.reload()}>
            重试
          </button>
          <button type="button" className="btn ghost" onClick={onLogout}>
            退出登录
          </button>
        </div>
      </div>
    );
  }
  return <ChatShell user={user} onLogout={onLogout} cloud={state.cloud} />;
}

function initialTheme(): Theme {
  try {
    return localStorage.getItem("dream-theme") === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function ChatShell({ user, onLogout, cloud }: { user: AuthUser; onLogout: () => void; cloud: UnlockResult }) {
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
  const [privateMode, setPrivateMode] = useState(false);
  const [showCloudPrompt, setShowCloudPrompt] = useState(false);
  const [cloudMessage, setCloudMessage] = useState(cloud.pullError ?? "");

  useEffect(() => {
    let alive = true;
    void detectPrivateMode().then((isPrivate) => {
      if (!alive || !isPrivate) return;
      if (sessionStorage.getItem("dream-private-dismissed") === "1") return;
      setPrivateMode(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!cloud.hadCloudBackup) return;
    const timer = window.setTimeout(() => {
      if (localStorage.getItem("dream-cloud-upload-declined") === "1") return;
      if (localStorage.getItem("dream-cloud-upload-pending") === "1") return;
      void pushCloudBackup().catch(() => undefined);
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [cloud]);
  useEffect(() => {
    if (cloud.hadCloudBackup || cloud.localConversations === 0) return;
    if (localStorage.getItem("dream-cloud-upload-declined") === "1") return;
    localStorage.setItem("dream-cloud-upload-pending", "1");
    setShowCloudPrompt(true);
  }, [cloud]);
  useEffect(() => {
    const timer = window.setInterval(() => void maybePushCloudBackup(), 60 * 1000);
    let debounce = 0;
    const onDirty = () => {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(() => {
        if (localStorage.getItem("dream-cloud-upload-declined") === "1") return;
        if (localStorage.getItem("dream-cloud-upload-pending") === "1") return;
        void pushCloudBackup().catch(() => undefined);
      }, 2500);
    };
    window.addEventListener("dream:backup-dirty", onDirty);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(debounce);
      window.removeEventListener("dream:backup-dirty", onDirty);
    };
  }, []);

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
        onLogout={() => {
          lockAccount();
          onLogout();
        }}
      />
      {sidebarOpen ? <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} /> : null}
      <ChatView chat={chat} health={health} onToggleSidebar={() => setSidebarOpen((value) => !value)} />
      {privateMode ? (
        <NoticeDialog
          title="可能处于无痕/隐私模式"
          onClose={() => {
            sessionStorage.setItem("dream-private-dismissed", "1");
            setPrivateMode(false);
          }}
          actions={[
            {
              label: "先导出备份",
              onClick: () => {
                void downloadBackup().catch(() => undefined);
                sessionStorage.setItem("dream-private-dismissed", "1");
                setPrivateMode(false);
              },
            },
            {
              label: "我知道了",
              primary: true,
              onClick: () => {
                sessionStorage.setItem("dream-private-dismissed", "1");
                setPrivateMode(false);
              },
            },
          ]}
        >
          <p>关闭窗口、刷新或清理站点数据后，当前聊天记录可能被浏览器清空。</p>
          <p>建议退出无痕模式，或先导出一份备份；正式使用请安装 Dream 到桌面/主屏幕。</p>
        </NoticeDialog>
      ) : null}
      {showCloudPrompt ? (
        <NoticeDialog
          title="上传聊天记录到服务器？"
          actions={[
            {
              label: "暂不上传",
              onClick: () => {
                localStorage.setItem("dream-cloud-upload-declined", "1");
                localStorage.removeItem("dream-cloud-upload-pending");
                setShowCloudPrompt(false);
              },
            },
            {
              label: "上传",
              primary: true,
              onClick: () => {
                localStorage.removeItem("dream-cloud-upload-pending");
                setShowCloudPrompt(false);
                void pushCloudBackup()
                  .then(() => {
                    localStorage.removeItem("dream-cloud-upload-declined");
                    setCloudMessage("已上传并加密保存到服务器。");
                  })
                  .catch((error: unknown) => {
                    setCloudMessage(error instanceof Error ? error.message : "上传失败。");
                  });
              },
            },
          ]}
        >
          <p>检测到本机已有 {cloud.localConversations} 个对话。上传后会压缩并用你的账号密钥加密，之后登录会与云端记录按时间合并。</p>
          <p>聊天记录会保存在服务器上；不上传则仅保留在本机。</p>
        </NoticeDialog>
      ) : null}
      {cloudMessage ? (
        <div className="cloud-toast" role="status" onClick={() => setCloudMessage("")}>
          {cloudMessage}
        </div>
      ) : null}
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
