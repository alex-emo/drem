import { describe, expect, it, vi } from "vitest";

const fetchSharedChat = vi.hoisted(() => vi.fn());
vi.mock("@web/lib/api", () => ({ fetchSharedChat }));

import { buildShareImport } from "@web/lib/shareImport";

const remote = (overrides: Record<string, unknown> = {}) => ({
  shareId: "share123",
  title: "分享的标题",
  attachments: 2,
  messages: [
    { role: "user", content: "第一个问题", reasoning: "", status: "done", createdAt: 1000 },
    { role: "assistant", content: "回答", reasoning: "思考", status: "done", createdAt: 2000 },
    { role: "assistant", content: "失败的回答", reasoning: "", status: "error", createdAt: 3000 },
  ],
  ...overrides,
});

describe("buildShareImport", () => {
  it("转换为本地会话与消息，保留顺序和时间", async () => {
    fetchSharedChat.mockResolvedValue(remote());
    const result = await buildShareImport("https://chat.deepseek.com/share/share123");
    expect(fetchSharedChat).toHaveBeenCalledWith("https://chat.deepseek.com/share/share123");
    expect(result.conversation.id).toBe("ds-share-share123");
    expect(result.conversation.title).toBe("分享的标题");
    expect(result.messages.map((message) => message.id)).toEqual([
      "ds-share-share123-1",
      "ds-share-share123-2",
      "ds-share-share123-3",
    ]);
    expect(result.messages.every((message) => message.conversationId === "ds-share-share123")).toBe(true);
    expect(result.messages.map((message) => message.createdAt)).toEqual([1000, 1001, 1002]);
    expect(result.messages[1].reasoning).toBe("思考");
    expect(result.attachments).toBe(2);
  });

  it("失败消息补上中文错误说明", async () => {
    fetchSharedChat.mockResolvedValue(remote());
    const result = await buildShareImport("x");
    expect(result.messages[2].error).toContain("生成失败");
    expect(result.messages[0].error).toBeUndefined();
  });

  it("标题为占位符时用首条用户消息生成", async () => {
    fetchSharedChat.mockResolvedValue(remote({ title: "Shared Conversation" }));
    const result = await buildShareImport("x");
    expect(result.conversation.title).toBe("第一个问题");
  });

  it("标题和用户消息都为空时回退“分享对话”", async () => {
    fetchSharedChat.mockResolvedValue(
      remote({ title: "", messages: [{ role: "assistant", content: "hi", status: "done", createdAt: 5 }] }),
    );
    const result = await buildShareImport("x");
    expect(result.conversation.title).toBe("分享对话");
  });
});
