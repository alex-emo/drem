import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { fetchMyFeedback, submitFeedback, type FeedbackReport } from "../lib/api";

type Reproducible = FeedbackReport["reproducible"];

interface Detected {
  platform: "web" | "app";
  os: string;
  osVersion: string;
}

function detectEnvironment(): Detected {
  const ua = navigator.userAgent;
  const capacitor = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string } })
    .Capacitor;
  const platform: "web" | "app" =
    capacitor?.isNativePlatform?.() || (capacitor?.getPlatform && capacitor.getPlatform() !== "web") ? "app" : "web";

  let os = "未知系统";
  let osVersion = "";
  let match: RegExpMatchArray | null;
  if ((match = ua.match(/Android\s([\d.]+)/i))) {
    os = "Android";
    osVersion = match[1];
  } else if ((match = ua.match(/iPhone OS\s([\d_]+)/i))) {
    os = "iOS";
    osVersion = match[1].replace(/_/g, ".");
  } else if ((match = ua.match(/iPad; CPU OS\s([\d_]+)/i))) {
    os = "iPadOS";
    osVersion = match[1].replace(/_/g, ".");
  } else if ((match = ua.match(/Windows NT\s([\d.]+)/i))) {
    os = "Windows";
    osVersion = match[1];
  } else if ((match = ua.match(/Mac OS X\s([\d_.]+)/i))) {
    os = "macOS";
    osVersion = match[1].replace(/_/g, ".");
  } else if (/Linux/i.test(ua)) {
    os = "Linux";
  }

  return { platform, os, osVersion };
}

const REPRODUCIBLE_LABEL: Record<Reproducible, string> = {
  always: "每次都必现",
  sometimes: "偶尔出现",
  once: "只出现过一次",
  unknown: "不确定",
};

const STATUS_LABEL: Record<FeedbackReport["status"], string> = {
  open: "待处理",
  replied: "已回复",
  closed: "已关闭",
};

interface FeedbackSectionProps {
  appVersion?: string;
}

export default function FeedbackSection({ appVersion = "" }: FeedbackSectionProps) {
  const [detected] = useState(detectEnvironment);
  const [version, setVersion] = useState(appVersion);
  const [description, setDescription] = useState("");
  const [reproducible, setReproducible] = useState<Reproducible>("always");
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [reports, setReports] = useState<FeedbackReport[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetchMyFeedback()
      .then((items) => {
        if (alive) setReports(items);
      })
      .catch(() => {
        // 历史列表失败不影响提交，提交时会再次暴露错误。
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    if (!appVersion) {
      fetch("/api/v1/release", { cache: "no-store" })
        .then((response) => (response.ok ? response.json() : null))
        .then((data: { version?: string } | null) => {
          if (alive && data?.version) setVersion(data.version);
        })
        .catch(() => undefined);
    }
    return () => {
      alive = false;
    };
  }, [appVersion]);

  useEffect(() => {
    if (!screenshot) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(screenshot);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [screenshot]);

  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (file && file.size > 5 * 1024 * 1024) {
      setMessage({ kind: "error", text: "截图不能超过 5 MiB。" });
      return;
    }
    setScreenshot(file);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (description.trim().length < 5) {
      setMessage({ kind: "error", text: "请至少用 5 个字描述问题。" });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const report = await submitFeedback({
        platform: detected.platform,
        os: detected.os,
        osVersion: detected.osVersion,
        appVersion: version,
        description: description.trim(),
        reproducible,
        screenshot,
      });
      setReports((current) => [report, ...current]);
      setDescription("");
      setScreenshot(null);
      setReproducible("always");
      setMessage({ kind: "ok", text: "已提交，管理员回复后会显示在下方。" });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "提交失败，请稍后重试。" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="settings-section feedback-section">
      <h3>反馈与报错</h3>
      <p className="feedback-hint">
        遇到错误或想反馈问题，请尽量附上截图和复现方式。我们会在这里回复你。
      </p>

      <form className="feedback-form" onSubmit={submit}>
        <div className="feedback-meta">
          <span>{detected.platform === "app" ? "App" : "网页端"}</span>
          <span>{detected.os}{detected.osVersion ? ` ${detected.osVersion}` : ""}</span>
          <span>v{version || "未知"}</span>
        </div>

        <label className="feedback-field">
          <span>问题描述</span>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="例如：发送消息后一直显示生成中，点停止没有反应。"
            rows={4}
            maxLength={4000}
            disabled={busy}
          />
        </label>

        <label className="feedback-field">
          <span>是否稳定触发</span>
          <select
            value={reproducible}
            onChange={(event) => setReproducible(event.target.value as Reproducible)}
            disabled={busy}
          >
            {(Object.keys(REPRODUCIBLE_LABEL) as Reproducible[]).map((value) => (
              <option key={value} value={value}>{REPRODUCIBLE_LABEL[value]}</option>
            ))}
          </select>
        </label>

        <div className="feedback-field">
          <span>截图（可选，≤5 MiB）</span>
          <div className="feedback-upload">
            <label className="feedback-file">
              选择图片
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={onFile} disabled={busy} />
            </label>
            {screenshot ? <span className="feedback-file-name">{screenshot.name}</span> : null}
          </div>
          {preview ? <img className="feedback-preview" src={preview} alt="截图预览" /> : null}
        </div>

        {message ? (
          <p className={message.kind === "ok" ? "feedback-ok" : "feedback-error"} role="status">{message.text}</p>
        ) : null}

        <button type="submit" className="feedback-submit" disabled={busy}>
          {busy ? "提交中…" : "提交反馈"}
        </button>
      </form>

      <div className="feedback-history">
        <h4>我的反馈</h4>
        {loading ? <p className="feedback-hint">加载中…</p> : null}
        {!loading && reports.length === 0 ? <p className="feedback-hint">还没有提交过反馈。</p> : null}
        {reports.map((report) => (
          <article key={report.id} className="feedback-item">
            <header>
              <span>{STATUS_LABEL[report.status]}</span>
              <time>{new Date(report.createdAt).toLocaleString()}</time>
            </header>
            <p className="feedback-item-desc">{report.description}</p>
            <p className="feedback-item-meta">
              {report.platform === "app" ? "App" : "网页端"} · {report.os}
              {report.osVersion ? ` ${report.osVersion}` : ""} · v{report.appVersion || "未知"} ·{" "}
              {REPRODUCIBLE_LABEL[report.reproducible]}
            </p>
            {report.adminReply ? (
              <div className="feedback-reply">
                <strong>管理员回复</strong>
                <p>{report.adminReply}</p>
                {report.repliedAt ? <time>{new Date(report.repliedAt).toLocaleString()}</time> : null}
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
