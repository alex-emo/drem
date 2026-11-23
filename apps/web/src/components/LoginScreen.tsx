import { useState, type FormEvent } from "react";
import { loginAccount, registerAccount } from "../lib/api";
import { saveSession } from "../lib/auth";
import { useDownloadUrl } from "../lib/download";
import type { AuthUser } from "../lib/types";
import { BrandMark } from "./BrandMark";
import { DownloadIcon } from "./Icons";

interface LoginScreenProps {
  onAuthenticated: (user: AuthUser) => void;
}

type Mode = "login" | "register";

export default function LoginScreen({ onAuthenticated }: LoginScreenProps) {
  const downloadUrl = useDownloadUrl();
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);

    try {
      const result =
        mode === "login"
          ? await loginAccount({ username, password })
          : await registerAccount({ username, password, displayName: displayName.trim() || undefined });
      saveSession(result);
      onAuthenticated(result.user);
    } catch (err) {
      setError((err as Error).message || "登录失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-brand">
          <span className="brand-logo"><BrandMark /></span>
          <span className="auth-title">Dream</span>
        </div>
        <p className="auth-subtitle">
          {mode === "login" ? "登录后继续对话" : "创建账号，开始使用 Dream"}
        </p>

        <label className="auth-field">
          <span>用户名</span>
          <input
            type="text"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="3–32 位字母、数字、下划线或中文"
            autoComplete="username"
            autoFocus
            required
          />
        </label>

        {mode === "register" ? (
          <label className="auth-field">
            <span>昵称（可选）</span>
            <input
              type="text"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="显示名称"
              autoComplete="nickname"
              maxLength={40}
            />
          </label>
        ) : null}

        <label className="auth-field">
          <span>密码</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={mode === "register" ? "至少 8 位" : "请输入密码"}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            minLength={8}
            required
          />
        </label>

        {error ? <p className="auth-error">{error}</p> : null}

        <button type="submit" className="auth-submit" disabled={busy}>
          {busy ? "请稍候…" : mode === "login" ? "登录" : "注册并登录"}
        </button>

        <button
          type="button"
          className="auth-switch"
          onClick={() => {
            setMode((value) => (value === "login" ? "register" : "login"));
            setError(null);
          }}
        >
          {mode === "login" ? "还没有账号？注册一个" : "已有账号？去登录"}
        </button>

        <p className="auth-note">聊天记录只保存在当前设备，不会上传到服务器。</p>

        <a
          className="auth-download"
          href={downloadUrl}
          download
          aria-label="下载 Android App（APK）"
        >
          <DownloadIcon size={15} />
          <span>下载 Android App（APK）</span>
        </a>
      </form>
    </div>
  );
}
