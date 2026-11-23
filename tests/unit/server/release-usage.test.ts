import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { config } from "../../../apps/server/src/config.js";
import { getRelease } from "../../../apps/server/src/release.js";
import { db } from "../../../apps/server/src/db.js";
import { getAdminStats, recordError, recordModeration, recordUsage } from "../../../apps/server/src/usage.js";
import { createTestUser } from "../../helpers/fixtures.js";

const apk = () => join(config.downloadDir, "dream-android.apk");

beforeEach(() => {
  db.exec("DELETE FROM usage_events; DELETE FROM moderation_events; DELETE FROM error_events;");
  mkdirSync(config.downloadDir, { recursive: true });
  rmSync(apk(), { force: true });
});

afterEach(() => {
  rmSync(apk(), { force: true });
});

describe("getRelease", () => {
  it("没有安装包时返回 null", async () => {
    await expect(getRelease("https://dream.test")).resolves.toBeNull();
  });

  it("有安装包时返回版本、大小与 SHA-256 下载地址", async () => {
    const bytes = Buffer.from("fake-apk-bytes");
    writeFileSync(apk(), bytes);

    const release = await getRelease("https://dream.test");
    expect(release).toMatchObject({
      version: config.appVersion,
      versionCode: config.appVersionCode,
      size: bytes.length,
    });
    expect(release?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(release?.apkUrl).toContain(`/download/dream-android.apk?v=${config.appVersion}`);
    expect(release?.apkUrl).toContain(`h=${release?.sha256.slice(0, 12)}`);
    expect(release?.notes).toContain("发布通道");
  });

  it("同一个安装包复用 SHA-256 缓存", async () => {
    writeFileSync(apk(), Buffer.from("same-bytes"));
    const first = await getRelease("https://dream.test");
    const second = await getRelease("https://dream.test");
    expect(second?.sha256).toBe(first?.sha256);
    expect(second?.size).toBe(first?.size);
  });
});

describe("getAdminStats", () => {
  const isAdmin = (username: string) => username === "admin_test";

  it("聚合请求数、token 与错误/审核事件", async () => {
    const { user } = await createTestUser("stats");
    recordUsage({
      userId: user.id,
      username: user.username,
      keyId: 1,
      model: "deepseek-chat",
      kind: "chat",
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    });
    recordUsage({
      userId: user.id,
      username: user.username,
      keyId: 1,
      model: "deepseek-chat",
      kind: "chat",
      usage: null,
    });
    recordModeration({
      userId: user.id,
      username: user.username,
      requestId: "req_1",
      provider: "deepseek",
      model: "deepseek-chat",
      stage: "primary",
      messageCount: 3,
      detail: "risky input",
    });
    recordError({ requestId: "req_2", method: "POST", path: "/api/v1/chat", status: 502, code: "UPSTREAM_ERROR", message: "boom" });

    const stats = getAdminStats(isAdmin);
    expect(stats.components).toMatchObject({
      api: "v1",
      provider: "deepseek",
      model: config.model,
      database: "ok",
    });
    expect(stats.totals.requests).toBe(2);
    expect(stats.totals.promptTokens).toBe(10);
    expect(stats.totals.completionTokens).toBe(5);
    expect(stats.totals.totalTokens).toBe(15);
    expect(stats.totals.moderationEvents).toBe(1);
    expect(stats.totals.moderationUsers).toBe(1);
    expect(stats.totals.errorEvents).toBe(1);

    const row = stats.users.find((item) => item.id === user.id);
    expect(row).toMatchObject({ requests: 2, totalTokens: 15, moderationCount: 1 });
    expect(row?.isAdmin).toBe(false);

    expect(stats.keys[0]).toMatchObject({ id: 1 });
    // days 只列出有请求的日期，不会补零到 7 天
    expect(stats.days.length).toBeGreaterThanOrEqual(1);
    expect(stats.days[0].requests).toBe(2);
    expect(stats.moderation[0].detail).toBe("risky input");
    expect(stats.errors[0]).toMatchObject({ code: "UPSTREAM_ERROR", status: 502 });
  });

  it("没有任何数据时返回零值而不是崩溃", () => {
    const stats = getAdminStats(isAdmin);
    expect(stats.totals.requests).toBe(0);
    expect(stats.totals.totalTokens).toBe(0);
    expect(stats.users.every((item) => item.requests === 0)).toBe(true);
    expect(stats.days).toEqual([]);
  });
});
