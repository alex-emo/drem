import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KeyPool, cooldownForStatus, isRetryableStatus } from "../../../apps/server/src/keys.js";

describe("KeyPool 轮询", () => {
  it("空池返回 null", () => {
    const pool = new KeyPool([]);
    expect(pool.size).toBe(0);
    expect(pool.available).toBe(0);
    expect(pool.acquire()).toBeNull();
    expect(pool.acquireIgnoringCooldown()).toBeNull();
  });

  it("按顺序轮询并回绕", () => {
    const pool = new KeyPool(["a", "b", "c"]);
    expect(pool.acquire()?.value).toBe("a");
    expect(pool.acquire()?.value).toBe("b");
    expect(pool.acquire()?.value).toBe("c");
    expect(pool.acquire()?.value).toBe("a");
  });

  it("id 从 1 开始，支持 idOffset", () => {
    const pool = new KeyPool(["a", "b"], 100);
    expect(pool.acquire()?.id).toBe(101);
    expect(pool.acquire()?.id).toBe(102);
  });

  it("exclude 跳过指定 Key", () => {
    const pool = new KeyPool(["a", "b", "c"]);
    const first = pool.acquire()!;
    const second = pool.acquire(new Set([first.id]))!;
    expect(second.id).not.toBe(first.id);
  });

  it("全部被 exclude 时返回 null", () => {
    const pool = new KeyPool(["a", "b"]);
    const all = new Set([1, 2]);
    expect(pool.acquire(all)).toBeNull();
  });
});

describe("KeyPool 冷却", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("markFailure 后 available 下降，冷却结束后恢复", () => {
    const pool = new KeyPool(["a", "b"]);
    const key = pool.acquire()!;
    pool.markFailure(key, 60_000);
    expect(pool.available).toBe(1);
    expect(pool.acquire()?.value).toBe("b");
    vi.advanceTimersByTime(60_001);
    expect(pool.available).toBe(2);
  });

  it("markSuccess 提前解除冷却", () => {
    const pool = new KeyPool(["a"]);
    const key = pool.acquire()!;
    pool.markFailure(key, 60_000);
    expect(pool.available).toBe(0);
    pool.markSuccess(key);
    expect(pool.available).toBe(1);
  });

  it("acquireIgnoringCooldown 在全部冷却时仍返回 Key", () => {
    const pool = new KeyPool(["a"]);
    const key = pool.acquire()!;
    pool.markFailure(key, 60_000);
    expect(pool.acquire()).toBeNull();
    expect(pool.acquireIgnoringCooldown()?.value).toBe("a");
  });

  it("details() 不暴露密钥内容，只给 id/状态", () => {
    const pool = new KeyPool(["secret-a", "secret-b"]);
    const key = pool.acquire()!;
    pool.markFailure(key, 30_000);
    const details = pool.details();
    expect(JSON.stringify(details)).not.toContain("secret");
    expect(details[0]).toMatchObject({ id: 1, available: false });
    expect(typeof details[0].cooldownUntil).toBe("number");
    expect(details[1]).toMatchObject({ id: 2, available: true, cooldownUntil: null });
  });
});

describe("上游状态判定", () => {
  it("可重试状态覆盖鉴权/限流/服务端错误", () => {
    for (const status of [401, 402, 403, 408, 409, 425, 429, 500, 502, 503]) {
      expect(isRetryableStatus(status)).toBe(true);
    }
    for (const status of [200, 400, 404, 422]) {
      expect(isRetryableStatus(status)).toBe(false);
    }
  });

  it("冷却时长按状态分级", () => {
    expect(cooldownForStatus(401)).toBe(60 * 60_000);
    expect(cooldownForStatus(402)).toBe(30 * 60_000);
    expect(cooldownForStatus(403)).toBe(30 * 60_000);
    expect(cooldownForStatus(429)).toBe(60_000);
    expect(cooldownForStatus(503)).toBe(30_000);
    expect(cooldownForStatus(undefined)).toBe(30_000);
    expect(cooldownForStatus(400)).toBe(30_000);
  });
});
