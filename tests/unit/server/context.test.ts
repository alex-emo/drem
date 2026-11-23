import { beforeEach, describe, expect, it, vi } from "vitest";

// 摘要请求在单测里不联网：默认成功返回固定摘要，个别用例改成抛错。
const summarizeMock = vi.hoisted(() => vi.fn());
vi.mock("../../../apps/server/src/deepseek.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../apps/server/src/deepseek.js")>();
  return { ...actual, requestUpstreamJson: summarizeMock };
});

import {
  COMPRESS_MESSAGE_THRESHOLD,
  COMPRESS_TOKEN_THRESHOLD,
  clipText,
  compressContext,
  estimateMessagesTokens,
  estimateTokens,
  needsCompression,
} from "../../../apps/server/src/context.js";
import type { ChatMessage } from "../../../apps/server/src/deepseek.js";
import { db } from "../../../apps/server/src/db.js";

const user = (content: string): ChatMessage => ({ role: "user", content });
const assistant = (content: string): ChatMessage => ({ role: "assistant", content });

const summaryResponse = (content: string) => ({
  keyId: 1,
  usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
  data: { choices: [{ message: { content } }] },
});

beforeEach(() => {
  summarizeMock.mockReset();
  summarizeMock.mockResolvedValue(summaryResponse("【目标】测试摘要"));
  db.exec("DELETE FROM context_summaries;");
});

describe("token 估算", () => {
  it("中文按 1 token/字", () => {
    expect(estimateTokens("你好世界")).toBe(4);
  });

  it("英文/代码按 3.5 字符/token 并向上取整", () => {
    expect(estimateTokens("abcdefg")).toBe(2);
    expect(estimateTokens("")).toBe(0);
  });

  it("空字符串为 0", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("estimateMessagesTokens 给每条消息加 4 个结构 token", () => {
    expect(estimateMessagesTokens([user("你好"), assistant("abcd")])).toBe(2 + 4 + 2 + 4);
  });
});

describe("needsCompression", () => {
  it("消息条数超过阈值", () => {
    const messages = Array.from({ length: COMPRESS_MESSAGE_THRESHOLD + 1 }, (_, index) =>
      user(String(index)),
    );
    expect(needsCompression(messages)).toBe(true);
  });

  it("估算 token 超过阈值", () => {
    const messages = [user("字".repeat(COMPRESS_TOKEN_THRESHOLD + 1))];
    expect(needsCompression(messages)).toBe(true);
  });

  it("短对话不需要压缩", () => {
    expect(needsCompression([user("你好"), assistant("你好呀")])).toBe(false);
  });
});

describe("clipText", () => {
  it("未超预算时原样返回", () => {
    expect(clipText("你好", 10)).toBe("你好");
  });

  it("超预算时保留头尾并标注省略字符数", () => {
    const text = "A".repeat(10_000);
    const clipped = clipText(text, 100);
    expect(estimateTokens(clipped)).toBeLessThan(estimateTokens(text));
    expect(clipped).toMatch(/中间内容已省略 \d+ 字符/);
    expect(clipped.startsWith("A")).toBe(true);
    expect(clipped.endsWith("A")).toBe(true);
  });
});

describe("compressContext", () => {
  it("短对话不压缩，也不调用上游", async () => {
    const messages = [user("你好"), assistant("你好呀")];
    const result = await compressContext(messages);
    expect(result.compressed).toBe(false);
    expect(result.messages).toEqual(messages);
    expect(result.segments).toBe(0);
    expect(summarizeMock).not.toHaveBeenCalled();
  });

  it("单条超长消息被裁剪并标记 clippedMessages", async () => {
    const messages = [user("a".repeat(200_000))];
    const result = await compressContext(messages);
    expect(result.compressed).toBe(true);
    expect(result.clippedMessages).toBe(1);
    expect(result.messages[0].content).toContain("中间内容已省略");
    expect(result.estimatedTokens).toBeLessThan(20_000);
  });

  it("长对话压缩为 system 摘要 + 最近原文", async () => {
    const messages: ChatMessage[] = [];
    for (let index = 0; index < 120; index += 1) {
      messages.push(user(`第 ${index} 个问题：` + "内容".repeat(300)));
      messages.push(assistant(`第 ${index} 个回答：` + "回答".repeat(300)));
    }
    const result = await compressContext(messages);
    expect(result.compressed).toBe(true);
    expect(result.segments).toBeGreaterThan(0);
    expect(result.messages[0].role).toBe("system");
    expect(result.messages[0].content).toContain("【历史 1】");
    expect(result.originalMessages).toBe(messages.length);
    // 最近消息必须保留原文
    expect(result.messages.at(-1)).toEqual(messages.at(-1));
    expect(summarizeMock).toHaveBeenCalled();
  });

  it("摘要失败时退化为抽取式摘要，不抛错", async () => {
    summarizeMock.mockRejectedValue(new Error("upstream down"));
    const messages: ChatMessage[] = [];
    for (let index = 0; index < 200; index += 1) {
      messages.push(user(`问 ${index} ` + "x".repeat(1200)));
      messages.push(assistant(`答 ${index} ` + "y".repeat(1200)));
    }
    const result = await compressContext(messages);
    expect(result.compressed).toBe(true);
    expect(result.messages[0].content).toContain("【历史 1】");
    expect(result.messages[0].content).toContain("摘要服务失败");
  });

  it("摘要结果进入缓存后二次调用命中 cached", async () => {
    const messages: ChatMessage[] = [];
    for (let index = 0; index < 120; index += 1) {
      messages.push(user(`缓存 ${index} ` + "z".repeat(1200)));
      messages.push(assistant(`回复 ${index} ` + "w".repeat(1200)));
    }
    const first = await compressContext(messages);
    expect(first.cached).toBe(0);
    const calls = summarizeMock.mock.calls.length;
    const second = await compressContext(messages);
    expect(second.cached).toBeGreaterThan(0);
    expect(summarizeMock.mock.calls.length).toBeLessThanOrEqual(calls);
  });

  it("onUsage 透传摘要请求的 token 用量", async () => {
    const usages: unknown[] = [];
    const messages: ChatMessage[] = [];
    for (let index = 0; index < 200; index += 1) {
      messages.push(user(`用量 ${index} ` + "u".repeat(1200)));
    }
    await compressContext(messages, { onUsage: (usage) => usages.push(usage) });
    expect(usages.length).toBeGreaterThan(0);
    expect(usages[0]).toMatchObject({ totalTokens: 120 });
  });
});

