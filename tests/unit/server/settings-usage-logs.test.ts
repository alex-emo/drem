import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_IDENTITY_PROMPT,
  DEFAULT_TEMPERATURE,
  getModelSettings,
  updateModelSettings,
} from "../../../apps/server/src/settings.js";
import { normalizeUsage } from "../../../apps/server/src/usage.js";
import { listLogs, pushLog } from "../../../apps/server/src/logs.js";
import { withDreamIdentity } from "../../../apps/server/src/identity.js";
import { db } from "../../../apps/server/src/db.js";

beforeEach(() => {
  db.exec("DELETE FROM app_settings;");
});

describe("模型设置", () => {
  it("默认温度 0.7 与默认身份提示", () => {
    const settings = getModelSettings();
    expect(settings.temperature).toBe(DEFAULT_TEMPERATURE);
    expect(settings.identityPrompt).toBe(DEFAULT_IDENTITY_PROMPT);
    expect(settings.updatedAt).toBeNull();
  });

  it("保存后可读回，温度被限制在 0–2", () => {
    updateModelSettings({ temperature: 1.25, identityPrompt: "自定义身份" });
    expect(getModelSettings()).toMatchObject({ temperature: 1.25, identityPrompt: "自定义身份" });
    updateModelSettings({ temperature: 99, identityPrompt: "x" });
    expect(getModelSettings().temperature).toBe(2);
    db.exec("DELETE FROM app_settings");
    updateModelSettings({ temperature: -5, identityPrompt: "x" });
    expect(getModelSettings().temperature).toBe(0);
  });

  it("损坏的温度值回退默认", () => {
    db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)").run(
      "model.temperature",
      "not-a-number",
      new Date().toISOString(),
    );
    expect(getModelSettings().temperature).toBe(DEFAULT_TEMPERATURE);
  });
});

describe("withDreamIdentity", () => {
  it("在消息最前注入 system 身份提示", () => {
    updateModelSettings({ temperature: 0.7, identityPrompt: "你是 Dream 模型。" });
    const messages = [{ role: "user" as const, content: "你是谁" }];
    const result = withDreamIdentity(messages);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ role: "system", content: "你是 Dream 模型。" });
    expect(result[1]).toBe(messages[0]);
  });

  it("提示为空时原样返回", () => {
    updateModelSettings({ temperature: 0.7, identityPrompt: "" });
    const messages = [{ role: "user" as const, content: "hi" }];
    expect(withDreamIdentity(messages)).toBe(messages);
  });
});

describe("normalizeUsage", () => {
  it("支持 OpenAI / Anthropic 两种字段命名", () => {
    expect(normalizeUsage({ prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 })).toEqual({
      promptTokens: 10,
      completionTokens: 2,
      totalTokens: 12,
    });
    expect(normalizeUsage({ input_tokens: 3, output_tokens: 4 })).toEqual({
      promptTokens: 3,
      completionTokens: 4,
      totalTokens: 7,
    });
  });

  it("全为 0 或非对象返回 null", () => {
    expect(normalizeUsage(undefined)).toBeNull();
    expect(normalizeUsage({})).toBeNull();
    expect(normalizeUsage({ prompt_tokens: 0 })).toBeNull();
  });

  it("忽略负数与小数", () => {
    expect(normalizeUsage({ prompt_tokens: -5, completion_tokens: 2.9, total_tokens: 0 })).toEqual({
      promptTokens: 0,
      completionTokens: 2,
      totalTokens: 2,
    });
  });
});

describe("后台日志环形缓冲", () => {
  it("按级别与关键词过滤", () => {
    pushLog({ level: "info", requestId: "r1", method: "GET", path: "/api/v1/health", status: 200, durationMs: 3 });
    pushLog({ level: "error", requestId: "r2", method: "POST", path: "/api/v1/chat", status: 500, durationMs: 90 });
    const errors = listLogs({ level: "error" });
    expect(errors.items.every((entry) => entry.level === "error")).toBe(true);
    expect(errors.items.some((entry) => entry.requestId === "r2")).toBe(true);
    const byPath = listLogs({ search: "chat" });
    expect(byPath.items[0].path).toBe("/api/v1/chat");
  });

  it("limit 被限制在 1–500", () => {
    expect(listLogs({ limit: 0 }).items.length).toBeLessThanOrEqual(1);
    expect(listLogs({ limit: 10_000 }).items.length).toBeLessThanOrEqual(500);
  });

  it("支持按 duration/status/path 排序与升序", () => {
    pushLog({ level: "info", requestId: "a", method: "GET", path: "/b", status: 200, durationMs: 50 });
    pushLog({ level: "info", requestId: "b", method: "GET", path: "/a", status: 500, durationMs: 10 });
    const desc = listLogs({ sort: "duration" });
    expect(desc.items[0].durationMs).toBeGreaterThanOrEqual(desc.items.at(-1)!.durationMs);
    const asc = listLogs({ sort: "path", order: "asc" });
    expect([...asc.items].map((entry) => entry.path)).toEqual([...asc.items].map((e) => e.path).sort());
  });
});
