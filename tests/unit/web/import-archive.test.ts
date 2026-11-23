import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { ImportError, parseDeepSeekArchive } from "@web/lib/importArchive";

/** 用一个内存 ZIP 构造 DeepSeek 导出包，避免在仓库里塞二进制 fixture。 */
function archive(files: Record<string, unknown | string>): File {
  const entries: Record<string, Uint8Array> = {};
  for (const [path, content] of Object.entries(files)) {
    entries[path] = typeof content === "string" ? strToU8(content) : strToU8(JSON.stringify(content));
  }
  const bytes = zipSync(entries);
  return new File([bytes as unknown as BlobPart], "deepseek_data-2026-01-01.zip", { type: "application/zip" });
}

const MANIFEST = { export_format_version: 3, exported_at: "2026-01-01T00:00:00Z" };
const INDEX = (ids: string[]) => ids.map((id) => ({ id }));

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: "sess-1",
    title: "如何写测试",
    current_message_id: 2,
    inserted_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:10:00Z",
    messages: [
      {
        id: 1,
        parent_id: null,
        role: "USER",
        status: "FINISHED",
        inserted_at: "2026-01-01T00:00:00Z",
        fragments: [{ type: "REQUEST", content: "怎么给项目写测试？" }],
      },
      {
        id: 2,
        parent_id: 1,
        role: "ASSISTANT",
        status: "FINISHED",
        inserted_at: "2026-01-01T00:00:05Z",
        fragments: [
          { type: "THINK", content: "先看目录结构" },
          { type: "RESPONSE", content: "从单元测试开始。" },
        ],
      },
    ],
    ...overrides,
  };
}

function build(sessions: Array<[string, unknown]>, indexed: string[], extra: Record<string, unknown> = {}) {
  const files: Record<string, unknown> = {
    "manifest.json": MANIFEST,
    "chat_session_index.json": INDEX(indexed),
    ...extra,
  };
  for (const [id, value] of sessions) files[`chat_sessions/${id}.json`] = value;
  return archive(files);
}

describe("parseDeepSeekArchive", () => {
  it("转换标准 v3 导出：会话标题、消息 id、思考内容", async () => {
    const result = await parseDeepSeekArchive(build([["sess-1", session()]], ["sess-1"]));

    expect(result.stats).toMatchObject({ conversations: 1, messages: 2, skippedConversations: 0 });
    const [conversation] = result.conversations;
    expect(conversation).toMatchObject({
      id: "ds-sess-1",
      title: "如何写测试",
      createdAt: Date.parse("2026-01-01T00:00:00Z"),
      updatedAt: Date.parse("2026-01-01T00:10:00Z"),
    });
    expect(result.messages.map((message) => [message.id, message.role])).toEqual([
      ["ds-sess-1-1", "user"],
      ["ds-sess-1-2", "assistant"],
    ]);
    expect(result.messages[1]).toMatchObject({ content: "从单元测试开始。", reasoning: "先看目录结构", status: "done" });
  });

  it("只沿 current_message_id 的父链取当前分支，忽略其它版本", async () => {
    const branched = session({
      current_message_id: 4,
      messages: [
        ...session().messages,
        {
          id: 3,
          parent_id: 1,
          role: "ASSISTANT",
          status: "FINISHED",
          inserted_at: "2026-01-01T00:01:00Z",
          fragments: [{ type: "RESPONSE", content: "被放弃的版本" }],
        },
        {
          id: 4,
          parent_id: 1,
          role: "ASSISTANT",
          status: "FINISHED",
          inserted_at: "2026-01-01T00:02:00Z",
          fragments: [{ type: "RESPONSE", content: "选中的版本" }],
        },
      ],
    });
    const result = await parseDeepSeekArchive(build([["sess-1", branched]], ["sess-1"]));
    expect(result.messages.map((message) => message.content)).toEqual(["怎么给项目写测试？", "选中的版本"]);
  });

  it("current_message_id 失效时退回 id 最大的消息", async () => {
    const broken = session({ current_message_id: 999 });
    const result = await parseDeepSeekArchive(build([["sess-1", broken]], ["sess-1"]));
    expect(result.messages).toHaveLength(2);
  });

  it("失败的助手回复标记 error 并带说明", async () => {
    const failed = session({
      messages: [
        session().messages[0],
        { ...session().messages[1], status: "FAILED", fragments: [{ type: "RESPONSE", content: "半截" }] },
      ],
    });
    const result = await parseDeepSeekArchive(build([["sess-1", failed]], ["sess-1"]));
    expect(result.messages[1]).toMatchObject({ status: "error", content: "半截" });
    expect(result.messages[1].error).toContain("生成失败");
  });

  it("WIP/INCOMPLETE 视为用户主动停止，保留已生成内容", async () => {
    const wip = session({
      messages: [
        session().messages[0],
        { ...session().messages[1], status: "WIP", fragments: [{ type: "RESPONSE", content: "写到这里" }] },
      ],
    });
    const result = await parseDeepSeekArchive(build([["sess-1", wip]], ["sess-1"]));
    expect(result.messages[1].status).toBe("done");
  });

  it("跳过没有可见文字的消息，并统计附件数量", async () => {
    const withAttachment = session({
      title: null,
      messages: [
        {
          id: 1,
          parent_id: null,
          role: "USER",
          status: "FINISHED",
          inserted_at: "2026-01-01T00:00:00Z",
          fragments: [{ type: "FILE", content: "a.png" }],
        },
        {
          id: 2,
          parent_id: 1,
          role: "USER",
          status: "FINISHED",
          inserted_at: "2026-01-01T00:00:03Z",
          fragments: [{ type: "REQUEST", content: "看图" }],
        },
      ],
    });
    const result = await parseDeepSeekArchive(build([["sess-1", withAttachment]], ["sess-1"]));
    expect(result.stats).toMatchObject({ skippedMessages: 1, attachments: 1, messages: 1 });
    // 标题取第一个有内容的用户消息
    expect(result.conversations[0].title).toBe("看图");
  });

  it("索引里没有的会话被跳过", async () => {
    const orphan = session({ id: "sess-orphan", messages: [] });
    const result = await parseDeepSeekArchive(
      build([["sess-1", session()], ["sess-orphan", orphan]], ["sess-1"]),
    );
    expect(result.stats).toMatchObject({ conversations: 1, skippedConversations: 1 });
  });

  it("标题为空时用第一条提问生成标题", async () => {
    const untitled = session({ id: "sess-2", title: null });
    const result = await parseDeepSeekArchive(build([["sess-2", untitled]], ["sess-2"]));
    expect(result.conversations[0].title).toBe("怎么给项目写测试？");
  });

  it("拒绝非 .zip 文件", async () => {
    const file = new File([strToU8("hi") as unknown as BlobPart], "data.json");
    await expect(parseDeepSeekArchive(file)).rejects.toBeInstanceOf(ImportError);
    await expect(parseDeepSeekArchive(file)).rejects.toThrow("请选择 DeepSeek 导出的 .zip 文件");
  });

  it("拒绝损坏的 ZIP", async () => {
    const file = new File([strToU8("not a zip") as unknown as BlobPart], "broken.zip");
    await expect(parseDeepSeekArchive(file)).rejects.toThrow("无法解压这个 ZIP 文件");
  });

  it("缺少 manifest.json", async () => {
    const file = archive({ "chat_session_index.json": INDEX([]) });
    await expect(parseDeepSeekArchive(file)).rejects.toThrow("缺少 manifest.json");
  });

  it("导出格式版本不支持时给出明确提示", async () => {
    const file = archive({ "manifest.json": { export_format_version: 2 }, "chat_session_index.json": [] });
    await expect(parseDeepSeekArchive(file)).rejects.toThrow(/仅支持版本 3/);
  });

  it("会话文件 id 与文件名不一致视为损坏", async () => {
    const file = build([["sess-1", session({ id: "sess-other" })]], ["sess-1"]);
    await expect(parseDeepSeekArchive(file)).rejects.toThrow("id 不匹配");
  });

  it("没有任何可导入内容时报错", async () => {
    const empty = session({ id: "sess-empty", title: "", messages: [] });
    await expect(parseDeepSeekArchive(build([["sess-empty", empty]], ["sess-empty"]))).rejects.toThrow(
      "没有可导入的对话内容",
    );
  });
});
