import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IpRateLimiter, type LimitRule } from "../../../apps/server/src/rateLimit.js";

const rule: LimitRule = { name: "test", limit: 3, windowMs: 60_000, blockMs: 120_000 };

describe("IpRateLimiter 固定窗口", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("窗口内前 limit 次放行", () => {
    const limiter = new IpRateLimiter();
    expect(limiter.hit("1.1.1.1", rule)).toBe(0);
    expect(limiter.hit("1.1.1.1", rule)).toBe(0);
    expect(limiter.hit("1.1.1.1", rule)).toBe(0);
  });

  it("超限后返回 retryAfter 秒并进入封禁", () => {
    const limiter = new IpRateLimiter();
    for (let index = 0; index < 3; index += 1) limiter.hit("1.1.1.1", rule);
    const retryAfter = limiter.hit("1.1.1.1", rule);
    expect(retryAfter).toBe(120);
    vi.advanceTimersByTime(119_000);
    expect(limiter.hit("1.1.1.1", rule)).toBeGreaterThan(0);
  });

  it("不同 IP 独立计数", () => {
    const limiter = new IpRateLimiter();
    for (let index = 0; index < 3; index += 1) limiter.hit("1.1.1.1", rule);
    expect(limiter.hit("2.2.2.2", rule)).toBe(0);
  });

  it("不同规则名独立计数", () => {
    const limiter = new IpRateLimiter();
    for (let index = 0; index < 3; index += 1) limiter.hit("1.1.1.1", rule);
    expect(limiter.hit("1.1.1.1", { ...rule, name: "other" })).toBe(0);
  });

  it("窗口滚动后计数清零", () => {
    const limiter = new IpRateLimiter();
    for (let index = 0; index < 3; index += 1) limiter.hit("1.1.1.1", rule);
    vi.advanceTimersByTime(60_001);
    expect(limiter.hit("1.1.1.1", rule)).toBe(0);
  });
});
