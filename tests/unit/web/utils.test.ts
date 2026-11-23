import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatRelativeTime, makeTitle, newId } from "@web/lib/utils";

describe("makeTitle", () => {
  it("折叠空白并截断到 24 字符加省略号", () => {
    expect(makeTitle("  你好   世界  ")).toBe("你好 世界");
    expect(makeTitle("a".repeat(24))).toBe("a".repeat(24));
    expect(makeTitle("a".repeat(25))).toBe(`${"a".repeat(24)}…`);
  });

  it("空内容回退“新对话”", () => {
    expect(makeTitle("")).toBe("新对话");
    expect(makeTitle("   \n\t ")).toBe("新对话");
  });
});

describe("newId", () => {
  it("优先使用 crypto.randomUUID", () => {
    const spy = vi.spyOn(crypto, "randomUUID").mockReturnValue("uuid-1" as `${string}-${string}-${string}-${string}-${string}`);
    expect(newId()).toBe("uuid-1");
    spy.mockRestore();
  });

  it("没有 randomUUID 时退化为时间戳+随机串", () => {
    // 模拟旧 WebView：crypto 存在但没有 randomUUID
    vi.stubGlobal("crypto", { getRandomValues: (array: Uint8Array) => array });
    try {
      expect(newId()).toMatch(/^[0-9a-z]+-[0-9a-z]+$/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("生成不重复的 id", () => {
    const ids = new Set(Array.from({ length: 50 }, () => newId()));
    expect(ids.size).toBe(50);
  });
});

describe("formatRelativeTime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  const now = () => Date.now();

  it("一分钟内是“刚刚”", () => {
    expect(formatRelativeTime(now() - 59_000)).toBe("刚刚");
  });

  it("分钟 / 小时 / 天", () => {
    expect(formatRelativeTime(now() - 5 * 60_000)).toBe("5 分钟前");
    expect(formatRelativeTime(now() - 3 * 3_600_000)).toBe("3 小时前");
    expect(formatRelativeTime(now() - 2 * 86_400_000)).toBe("2 天前");
  });

  it("超过 7 天显示月日", () => {
    const result = formatRelativeTime(now() - 10 * 86_400_000);
    expect(result).toMatch(/^\d{1,2}月\d{1,2}日$/);
  });
});
