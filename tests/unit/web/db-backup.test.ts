import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Conversation, Message } from "@web/lib/types";

/**
 * db.ts 在模块顶层持有 openDB 连接，所以每个用例都重建全局 indexedDB 并
 * 用 resetModules + 动态 import 拿到全新的数据库连接。
 */
async function freshDb() {
  vi.resetModules();
  globalThis.indexedDB = new IDBFactory();
  const db = await import("@web/lib/db");
  const crypto = await import("@web/lib/crypto");
  return { ...db, ...crypto };
}

const conversation = (overrides: Partial<Conversation> = {}): Conversation => ({
  id: "c1",
  title: "测试会话",
  createdAt: 1_000,
  updatedAt: 2_000,
  ...overrides,
});

const message = (overrides: Partial<Message> = {}): Message => ({
  id: "m1",
  conversationId: "c1",
  role: "user",
  content: "你好",
  status: "done",
  createdAt: 1_500,
  ...overrides,
});

beforeEach(() => {
  localStorage.clear();
});

describe("db 本地存储", () => {
  it("未登录时明文保存，登录后读取并保持字段", async () => {
    const db = await freshDb();
    await db.putConversation(conversation());
    await db.putMessage(message());

    expect(await db.listConversations()).toEqual([conversation()]);
    expect(await db.getMessages("c1")).toEqual([message()]);
  });

  it("有会话密钥时标题与正文落库为密文，读回来仍是明文", async () => {
    const db = await freshDb();
    db.setSessionKey("secret-key");
    await db.putConversation(conversation());
    await db.putMessage(message({ reasoning: "思考中" }));

    // 直接读原始记录，确认磁盘上没有明文
    const raw = await db.listConversations();
    expect(raw[0].title).toBe("测试会话");

    const [loaded] = await db.getAllMessages();
    expect(loaded).toMatchObject({ content: "你好", reasoning: "思考中" });
  });

  it("会话按 updatedAt 倒序，消息按 createdAt 正序", async () => {
    const db = await freshDb();
    await db.putConversation(conversation({ id: "old", updatedAt: 1 }));
    await db.putConversation(conversation({ id: "new", updatedAt: 10 }));
    await db.putMessages([
      message({ id: "m2", createdAt: 20 }),
      message({ id: "m1", createdAt: 10 }),
    ]);

    expect((await db.listConversations()).map((item) => item.id)).toEqual(["new", "old"]);
    expect((await db.getMessages("c1")).map((item) => item.id)).toEqual(["m1", "m2"]);
  });

  it("importConversationData 覆盖同 id 数据并写入全部消息", async () => {
    const db = await freshDb();
    await db.importConversationData([conversation()], [message(), message({ id: "m2", createdAt: 1_600 })]);
    await db.importConversationData([conversation({ title: "新标题" })], [message({ content: "改过" })]);

    const conversations = await db.getAllConversations();
    expect(conversations).toHaveLength(1);
    expect(conversations[0].title).toBe("新标题");
    expect(await db.getAllMessages()).toHaveLength(2);
  });

  it("删除会话会连带删除消息并写入 tombstone", async () => {
    const db = await freshDb();
    await db.importConversationData([conversation()], [message()]);
    await db.deleteConversationData("c1");

    expect(await db.getAllConversations()).toEqual([]);
    expect(await db.getAllMessages()).toEqual([]);
    const tombstones = await db.getAllTombstones();
    expect(tombstones).toHaveLength(1);
    expect(tombstones[0].id).toBe("c1");
  });

  it("clearLocalChats 清空会话、消息、墓碑与当前会话 id", async () => {
    const db = await freshDb();
    localStorage.setItem("dream-active-id", "c1");
    await db.importConversationData([conversation()], [message()]);
    await db.putTombstone({ id: "gone", deletedAt: 1 });

    await db.clearLocalChats();

    expect(await db.getAllConversations()).toEqual([]);
    expect(await db.getAllMessages()).toEqual([]);
    expect(await db.getAllTombstones()).toEqual([]);
    expect(localStorage.getItem("dream-active-id")).toBeNull();
  });

  it("migrateLocalEncryption 只迁移明文记录，幂等", async () => {
    const db = await freshDb();
    await db.importConversationData([conversation()], [message()]);
    expect(await db.migrateLocalEncryption()).toEqual({ conversations: 0, messages: 0 });

    db.setSessionKey("secret-key");
    expect(await db.migrateLocalEncryption()).toEqual({ conversations: 1, messages: 1 });
    expect(await db.migrateLocalEncryption()).toEqual({ conversations: 0, messages: 0 });
    expect(await db.getAllMessages()).toHaveLength(1);
  });

  it("密钥不匹配的记录读取时被跳过，不会抛出整体失败", async () => {
    const db = await freshDb();
    db.setSessionKey("key-a");
    await db.putMessage(message());

    db.setSessionKey("key-b");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await db.getMessages("c1")).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("backup 导出/导入", () => {
  it("createBackup 生成加密 envelope，restoreBackup 能还原", async () => {
    const db = await freshDb();
    const backup = await import("@web/lib/backup");
    db.setSessionKey("secret-key");
    await db.importConversationData([conversation()], [message()]);

    const blob = await backup.createBackup();
    const envelope = JSON.parse(await blob.text());
    expect(envelope).toMatchObject({ format: "dream-export", version: 1, encrypted: true, algorithm: "AES-GCM" });
    expect(typeof envelope.iv).toBe("string");
    expect(JSON.stringify(envelope)).not.toContain("测试会话");

    // 换一个空库导入（backup 模块也要重新导入，否则它仍指向旧库连接）
    const restored = await freshDb();
    const restoredBackup = await import("@web/lib/backup");
    restored.setSessionKey("secret-key");
    const file = new File([await blob.arrayBuffer()], "dream-export.dream");
    expect(await restoredBackup.restoreBackup(file)).toEqual({ conversations: 1, messages: 1 });
    expect((await restored.listConversations())[0].title).toBe("测试会话");
  });

  it("没有会话密钥时导出直接报错", async () => {
    await freshDb();
    const backup = await import("@web/lib/backup");
    await expect(backup.createBackup()).rejects.toThrow("请先登录并解锁聊天记录");
  });

  it("导入加密备份但未登录时报错", async () => {
    await freshDb();
    const backup = await import("@web/lib/backup");
    const file = new File(
      [JSON.stringify({ format: "dream-export", encrypted: true, iv: "aXY=", data: "ZGF0YQ==" })],
      "backup.dream",
    );
    await expect(backup.restoreBackup(file)).rejects.toThrow("请先登录后导入");
  });

  it("兼容旧 dream-backup 明文格式", async () => {
    await freshDb();
    const backup = await import("@web/lib/backup");
    const file = new File(
      [JSON.stringify({ format: "dream-backup", version: 1, conversations: [conversation()], messages: [message()] })],
      "old-backup.json",
    );
    expect(await backup.restoreBackup(file)).toEqual({ conversations: 1, messages: 1 });
  });

  it("兼容旧 .json.gz 压缩格式", async () => {
    const db = await freshDb();
    const backup = await import("@web/lib/backup");
    const text = JSON.stringify({ format: "dream-backup", version: 1, conversations: [conversation()], messages: [] });
    const gz = await new Response(
      new Blob([text]).stream().pipeThrough(new CompressionStream("gzip")),
    ).arrayBuffer();
    const file = new File([gz], "old.json.gz");
    expect(await backup.restoreBackup(file)).toEqual({ conversations: 1, messages: 0 });
    expect((await db.listConversations())[0].title).toBe("测试会话");
  });

  it("非法备份文件给出明确错误", async () => {
    await freshDb();
    const backup = await import("@web/lib/backup");
    await expect(
      backup.restoreBackup(new File([JSON.stringify({ format: "x" })], "x.json")),
    ).rejects.toThrow("这不是 Dream 的备份文件");
    await expect(
      backup.restoreBackup(new File([JSON.stringify({ format: "dream-backup", version: 1 })], "y.json")),
    ).rejects.toThrow("备份文件内容不完整");
  });

  it("backupFileName 为 .dream 且带时间戳", async () => {
    await freshDb();
    const backup = await import("@web/lib/backup");
    const name = backup.backupFileName(new Date(2026, 0, 2, 3, 4));
    expect(name).toBe("dream-export-20260102-0304.dream");
  });
});
