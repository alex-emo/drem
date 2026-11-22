import { useEffect, useRef, useState, type ChangeEvent } from "react";
import type { ImportOutcome } from "../hooks/useChat";
import { ImportError, parseDeepSeekArchive } from "../lib/importArchive";
import { formatBytes, readStorageInfo, requestPersistentStorage, type StorageInfo } from "../lib/storage";
import type { HealthState, Theme } from "../lib/types";
import { CloseIcon, DatabaseIcon, SettingsIcon } from "./Icons";

type Tab = "general" | "data";

type ImportState =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "ok"; text: string }
  | { kind: "error"; text: string };

interface SettingsDialogProps {
  open: boolean;
  theme: Theme;
  contentWidth: number;
  onContentWidthChange: (width: number) => void;
  health: HealthState;
  onClose: () => void;
  onThemeChange: (theme: Theme) => void;
  onImport: (archive: Awaited<ReturnType<typeof parseDeepSeekArchive>>) => Promise<ImportOutcome>;
  onImportShare: (url: string) => Promise<ImportOutcome>;
  onImportArchiveUrl: (
    url: string,
    onProgress?: (progress: { conversations: number; messages: number }) => void,
  ) => Promise<ImportOutcome>;
}

function serverState(health: HealthState): string {
  if (health.kind === "loading") return "正在检查…";
  if (health.kind === "error") return "未连接本地服务端";
  if (health.info.mock) return "演示模式（本地模拟）";
  if (!health.info.hasApiKey) return "Dream 模型服务暂不可用，请联系管理员";
  return "Dream 模型服务 · 已连接";
}

function storageText(info: StorageInfo): string {
  if (!info.supported) return "当前浏览器不支持持久化存储申请。";
  if (info.persisted) return "已持久化：浏览器在空间不足时也不会自动清理本站数据。";
  return "未持久化：浏览器在空间不足或清理站点数据时可能删除聊天记录。";
}

export default function SettingsDialog({
  open,
  theme,
  contentWidth,
  onContentWidthChange,
  health,
  onClose,
  onThemeChange,
  onImport,
  onImportShare,
  onImportArchiveUrl,
}: SettingsDialogProps) {
  const [tab, setTab] = useState<Tab>("data");
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [storageBusy, setStorageBusy] = useState(false);
  const [state, setState] = useState<ImportState>({ kind: "idle" });
  const [shareUrl, setShareUrl] = useState("");
  useEffect(() => {
    if (!open) return;
    void readStorageInfo().then(setStorage).catch(() => undefined);
  }, [open]);

  const [shareState, setShareState] = useState<ImportState>({ kind: "idle" });
  const [archiveUrl, setArchiveUrl] = useState("");
  const [archiveState, setArchiveState] = useState<ImportState>({ kind: "idle" });
  const [archiveProgress, setArchiveProgress] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      setState({ kind: "idle" });
      setShareState({ kind: "idle" });
      setShareUrl("");
      setArchiveState({ kind: "idle" });
      setArchiveUrl("");
      setArchiveProgress("");
      setTab("data");
    }
  }, [open]);

  if (!open) return null;

  const pickFile = () => {
    if (state.kind === "working") return;
    inputRef.current?.click();
  };

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setState({ kind: "working" });
    try {
      const archive = await parseDeepSeekArchive(file);
      const outcome = await onImport(archive);
      if (outcome.added === 0 && outcome.skipped > 0) {
        setState({
          kind: "ok",
          text: `这 ${outcome.skipped} 个对话之前已经导入过，无需重复导入。`,
        });
        return;
      }
      const extra: string[] = [];
      if (outcome.skipped > 0) extra.push(`跳过 ${outcome.skipped} 个已存在的对话`);
      if (outcome.skippedMessages > 0) extra.push(`${outcome.skippedMessages} 条仅含附件/工具调用的消息未导入`);
      if (outcome.attachments > 0) extra.push(`${outcome.attachments} 个附件暂不导入`);
      setState({
        kind: "ok",
        text: `已导入 ${outcome.added} 个对话、${outcome.messages} 条消息${extra.length ? `；${extra.join("，")}` : ""}。`,
      });
    } catch (error) {
      const message =
        error instanceof ImportError
          ? error.message
          : error instanceof Error
            ? error.message
            : "导入失败，请稍后重试。";
      setState({ kind: "error", text: message });
    }
  };

  const handleImportShare = async () => {
    const url = shareUrl.trim();
    if (!url || shareState.kind === "working") return;
    setShareState({ kind: "working" });
    try {
      const outcome = await onImportShare(url);
      if (outcome.added === 0) {
        setShareState({ kind: "ok", text: "这个分享之前已经导入过，无需重复导入。" });
        return;
      }
      const extra: string[] = [];
      if (outcome.skippedMessages > 0)
        extra.push(`${outcome.skippedMessages} 条仅含工具调用的消息未导入`);
      if (outcome.attachments > 0) extra.push(`${outcome.attachments} 个附件暂不导入`);
      setShareState({
        kind: "ok",
        text: `已从分享导入 1 个对话、${outcome.messages} 条消息${extra.length ? `；${extra.join("，")}` : ""}。`,
      });
    } catch (error) {
      setShareState({
        kind: "error",
        text: error instanceof Error ? error.message : "导入失败，请稍后重试。",
      });
    }
  };

  const handleImportArchiveUrl = async () => {
    const url = archiveUrl.trim();
    if (!url) return;
    setArchiveState({ kind: "working" });
    setArchiveProgress("正在连接导出文件…");
    try {
      const outcome = await onImportArchiveUrl(url, (progress) => {
        setArchiveProgress(`已导入 ${progress.conversations} 个会话 / ${progress.messages} 条消息`);
      });
      setArchiveState({
        kind: "ok",
        text: `已导入 ${outcome.added} 个对话、${outcome.messages} 条消息；跳过 ${outcome.skipped} 个已存在会话、${outcome.skippedMessages} 条空消息。`,
      });
    } catch (error) {
      setArchiveState({
        kind: "error",
        text: error instanceof Error ? error.message : "导入失败，请稍后重试。",
      });
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="settings"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="settings-head">
          <h2 id="settings-title">设置</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭设置">
            <CloseIcon size={18} />
          </button>
        </header>

        <div className="settings-body">
          <nav className="settings-nav" aria-label="设置分类">
            <button
              type="button"
              className={`settings-tab${tab === "general" ? " active" : ""}`}
              onClick={() => setTab("general")}
            >
              <SettingsIcon size={16} />
              <span>通用设置</span>
            </button>
            <button
              type="button"
              className={`settings-tab${tab === "data" ? " active" : ""}`}
              onClick={() => setTab("data")}
            >
              <DatabaseIcon size={16} />
              <span>数据管理</span>
            </button>
          </nav>

          <div className="settings-pane">
            {tab === "general" ? (
              <>
                <section className="settings-section">
                  <h3>外观</h3>
                  <div className="segmented" role="group" aria-label="主题">
                    <button
                      type="button"
                      className={theme === "light" ? "active" : ""}
                      aria-pressed={theme === "light"}
                      onClick={() => onThemeChange("light")}
                    >
                      浅色
                    </button>
                    <button
                      type="button"
                      className={theme === "dark" ? "active" : ""}
                      aria-pressed={theme === "dark"}
                      onClick={() => onThemeChange("dark")}
                    >
                      深色
                    </button>
                  </div>
                </section>

                <section className="settings-section settings-width">
                  <h3>阅读宽度</h3>
                  <p className="settings-note">调整消息与输入框的最大宽度，适合宽屏阅读；手机端自动铺满屏幕。</p>
                  <div className="width-control">
                    <input
                      type="range"
                      min={560}
                      max={1100}
                      step={20}
                      value={contentWidth}
                      aria-label="阅读宽度"
                      onChange={(event) => onContentWidthChange(Number(event.target.value))}
                    />
                    <span className="width-value">{contentWidth}px</span>
                    <button type="button" className="btn ghost small" onClick={() => onContentWidthChange(760)}>
                      恢复默认
                    </button>
                  </div>
                </section>

                <section className="settings-section">
                  <h3>数据存储</h3>
                  <p className="settings-note">
                    对话记录只保存在当前浏览器的 IndexedDB 中，不会上传到 Dream 服务端。发送消息时，内容会经本地服务端转发给 Dream 模型服务。
                  </p>
                  {storage ? (
                    <div className="storage-status">
                      <p className={"settings-note" + (storage.persisted ? "" : " storage-warn")}>{storageText(storage)}</p>
                      <p className="settings-note">
                        已用 {formatBytes(storage.usage)} / 浏览器配额 {formatBytes(storage.quota)}
                        {storage.persisted ? "" : "；建议点击下方按钮申请持久化，或安装到桌面/主屏幕后使用。"}
                      </p>
                      {!storage.persisted ? (
                        <button
                          type="button"
                          className="btn ghost small"
                          disabled={storageBusy}
                          onClick={async () => {
                            setStorageBusy(true);
                            await requestPersistentStorage();
                            setStorage(await readStorageInfo());
                            setStorageBusy(false);
                          }}
                        >
                          {storageBusy ? "申请中…" : "申请本地持久化"}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </section>

                <section className="settings-section">
                  <h3>服务状态</h3>
                  <p className="settings-note">{serverState(health)}</p>
                </section>
              </>
            ) : (
              <section className="settings-section">
                <h3>导入历史对话</h3>
                <p className="settings-note">
                  支持 DeepSeek 客户端导出的 <code>deepseek_data-*.zip</code>。会导入提问、回答和深度思考内容；
                  图片与文件附件暂不支持。导入不会删除现有对话，重复导入同一会话会自动跳过。
                </p>

                <div className="settings-action">
                  <button
                    type="button"
                    className="btn primary"
                    onClick={pickFile}
                    disabled={state.kind === "working"}
                  >
                    {state.kind === "working" ? "正在解析…" : "选择 ZIP 文件"}
                  </button>
                  <span className="settings-hint">在 DeepSeek App 的「设置 → 数据管理」中导出聊天记录</span>
                </div>

                <input
                  ref={inputRef}
                  type="file"
                  accept=".zip,application/zip"
                  className="visually-hidden"
                  onChange={(event) => void handleFile(event)}
                />

                {state.kind === "ok" ? (
                  <p className="import-status ok" role="status">
                    {state.text}
                  </p>
                ) : null}
                {state.kind === "error" ? (
                  <p className="import-status error" role="alert">
                    {state.text}
                  </p>
                ) : null}

                <hr className="settings-divider" />

                <h3>从导出链接导入</h3>
                <p className="settings-note">
                  粘贴 DeepSeek App「设置 → 数据管理 → 导出所有历史对话」生成的链接。服务端会流式下载并解压，
                  适合几百 MB 的大导出；只导入文本提问、回答与深度思考。
                </p>
                <div className="share-import-row">
                  <input
                    type="url"
                    className="share-import-input"
                    placeholder="https://…myhuaweicloud.com/…zip?…"
                    value={archiveUrl}
                    onChange={(event) => setArchiveUrl(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void handleImportArchiveUrl();
                    }}
                    disabled={archiveState.kind === "working"}
                  />
                  <button
                    type="button"
                    className="btn primary"
                    onClick={() => void handleImportArchiveUrl()}
                    disabled={!archiveUrl.trim() || archiveState.kind === "working"}
                  >
                    {archiveState.kind === "working" ? "导入中…" : "导入链接"}
                  </button>
                </div>
                {archiveState.kind === "working" && archiveProgress ? (
                  <p className="import-status" role="status">{archiveProgress}</p>
                ) : null}
                {archiveState.kind === "ok" ? (
                  <p className="import-status ok" role="status">{archiveState.text}</p>
                ) : null}
                {archiveState.kind === "error" ? (
                  <p className="import-status error" role="alert">{archiveState.text}</p>
                ) : null}

                <hr className="settings-divider" />

                <h3>从分享链接导入</h3>
                <p className="settings-note">
                  在 DeepSeek 中打开对话，点击分享并复制链接，粘贴到这里。会导入提问、回答和深度思考；
                  图片与文件附件暂不支持。
                </p>
                <div className="share-import-row">
                  <input
                    type="url"
                    className="share-import-input"
                    placeholder="https://chat.deepseek.com/share/…"
                    value={shareUrl}
                    onChange={(event) => setShareUrl(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void handleImportShare();
                    }}
                    disabled={shareState.kind === "working"}
                  />
                  <button
                    type="button"
                    className="btn primary"
                    onClick={() => void handleImportShare()}
                    disabled={!shareUrl.trim() || shareState.kind === "working"}
                  >
                    {shareState.kind === "working" ? "导入中…" : "导入分享"}
                  </button>
                </div>
                {shareState.kind === "ok" ? (
                  <p className="import-status ok" role="status">
                    {shareState.text}
                  </p>
                ) : null}
                {shareState.kind === "error" ? (
                  <p className="import-status error" role="alert">
                    {shareState.text}
                  </p>
                ) : null}
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
