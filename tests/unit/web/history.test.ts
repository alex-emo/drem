import { describe, expect, it } from "vitest";
import { historyFor } from "../../../apps/web/src/lib/history";
import type { Message } from "../../../apps/web/src/lib/types";

function message(overrides: Partial<Message> & Pick<Message, "role" | "content">): Message {
  return {
    id: crypto.randomUUID(),
    conversationId: "c1",
    status: "done",
    createdAt: 0,
    ...overrides,
  } as Message;
}

describe("historyFor", () => {
  it("drops messages excluded after moderation", () => {
    const history = historyFor([
      message({ role: "user", content: "正常问题" }),
      message({ role: "assistant", content: "正常回答" }),
      message({ role: "user", content: "敏感内容", excludeFromContext: true }),
      message({ role: "assistant", content: "拒绝回答", status: "refused", excludeFromContext: true }),
    ]);
    expect(history).toEqual([
      { role: "user", content: "正常问题" },
      { role: "assistant", content: "正常回答" },
    ]);
  });

  it("keeps a newly edited message without the exclusion flag", () => {
    const history = historyFor([
      message({ role: "user", content: "编辑后的新问题" }),
      message({ role: "assistant", content: "回答" }),
    ]);
    expect(history).toHaveLength(2);
  });
});
