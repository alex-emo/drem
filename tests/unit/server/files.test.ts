import { beforeAll, describe, expect, it } from "vitest";
import {
  MAX_FILE_BYTES,
  createTextFile,
  decodeText,
  deleteUserFile,
  expandFiles,
  extensionOf,
  isTextFileName,
  listUserFiles,
} from "../../../apps/server/src/files.js";
import { ApiError } from "../../../apps/server/src/protocol.js";
import { createTestUser } from "../../helpers/fixtures.js";

const bytesOf = (text: string) => new TextEncoder().encode(text);

describe("文件名判断", () => {
  it("extensionOf 取最后一段并转小写", () => {
    expect(extensionOf("a/b/Report.TXT")).toBe("txt");
    expect(extensionOf("archive.tar.gz")).toBe("gz");
    expect(extensionOf("noext")).toBe("");
  });

  it.each(["a.txt", "a.md", "a.TSX", "a.json", "a.py", "a.yaml"])("识别文本文件 %s", (name) => {
    expect(isTextFileName(name)).toBe(true);
  });

  it.each(["a.pdf", "a.docx", "a.png", "a.zip", "noext"])("拒绝非文本文件 %s", (name) => {
    expect(isTextFileName(name)).toBe(false);
  });
});

describe("decodeText", () => {
  it("解码 UTF-8", () => {
    expect(decodeText(bytesOf("你好 world"))).toBe("你好 world");
  });

  it("解码 UTF-16LE BOM", () => {
    const encoded = new TextEncoder().encode("hi");
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("hi", "utf16le")]);
    expect(utf16.length).toBeGreaterThan(encoded.length);
    expect(decodeText(new Uint8Array(utf16))).toBe("hi");
  });

  it("拒绝含零字节的二进制", () => {
    const binary = new Uint8Array([0x41, 0x00, 0x42]);
    expect(() => decodeText(binary)).toThrowError(/二进制/);
  });

  it("拒绝控制字符过多的内容", () => {
    const binary = new Uint8Array(Array.from({ length: 200 }, (_, i) => (i % 2 === 0 ? 0x01 : 0x41)));
    expect(() => decodeText(binary)).toThrowError(/二进制|无法识别/);
  });
});

describe("createTextFile / 持久化", () => {
  let userId = "";
  beforeAll(async () => {
    userId = (await createTestUser("files")).user.id;
  });

  it("保存文件并返回公开字段", async () => {
    const file = await createTextFile(userId, "notes.md", bytesOf("# 标题\n正文"));
    expect(file.id).toMatch(/^file_/);
    expect(file.name).toBe("notes.md");
    expect(file.chars).toBe(7);
    expect(file.preview).toContain("标题");
    expect(listUserFiles(userId).map((item) => item.id)).toContain(file.id);
  });

  it("空文件被拒绝", async () => {
    await expect(createTextFile(userId, "empty.txt", new Uint8Array())).rejects.toThrowError(/空的/);
  });

  it("超过 1 MiB 被拒绝（413）", async () => {
    const big = new Uint8Array(MAX_FILE_BYTES + 1).fill(0x41);
    try {
      await createTextFile(userId, "big.txt", big);
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe("PAYLOAD_TOO_LARGE");
      expect((error as ApiError).status).toBe(413);
    }
  });

  it("不支持的 .pdf 被拒绝", async () => {
    await expect(createTextFile(userId, "a.pdf", bytesOf("%PDF"))).rejects.toThrowError(/暂不支持/);
  });

  it("删除自己的文件返回 true", async () => {
    const file = await createTextFile(userId, "del.txt", bytesOf("bye"));
    expect(deleteUserFile(userId, file.id)).toBe(true);
    expect(deleteUserFile(userId, file.id)).toBe(false);
  });
});

describe("expandFiles", () => {
  let userId = "";
  beforeAll(async () => {
    userId = (await createTestUser("expand")).user.id;
  });

  it("无文件时原样返回", () => {
    const messages = [{ role: "user", content: "hi" }];
    const result = expandFiles(userId, [], messages);
    expect(result.messages).toEqual(messages);
    expect(result.files).toEqual([]);
  });

  it("把文件内容注入最后一条 user 消息", async () => {
    const file = await createTextFile(userId, "data.csv", bytesOf("a,b\n1,2"));
    const result = expandFiles(userId, [file.id], [
      { role: "user", content: "总结一下" },
      { role: "assistant", content: "好的" },
      { role: "user", content: "开始" },
    ]);
    const last = result.messages[2].content;
    expect(last).toContain('<file name="data.csv">');
    expect(last).toContain("a,b\n1,2");
    expect(last).toContain("开始");
    expect(result.messages[0].content).toBe("总结一下");
    expect(result.files).toHaveLength(1);
  });

  it("引用不存在的文件返回 404", () => {
    expect(() => expandFiles(userId, ["file_missing"], [{ role: "user", content: "x" }])).toThrowError(
      /不存在/,
    );
  });

  it("超过 8 个文件被拒绝", () => {
    const ids = Array.from({ length: 9 }, (_, index) => `f${index}`);
    expect(() => expandFiles(userId, ids, [{ role: "user", content: "x" }])).toThrowError(/最多引用/);
  });

  it("超出总 token 预算的文件被省略并给出提示", async () => {
    // 单文件被裁到 ~3000 tokens，4 个就会超过 12000 token 总预算。
    const big = "字".repeat(60_000);
    const files = await Promise.all(
      Array.from({ length: 5 }, (_, index) => createTextFile(userId, `big${index}.txt`, bytesOf(big))),
    );
    const result = expandFiles(userId, files.map((file) => file.id), [{ role: "user", content: "读一下" }]);
    expect(result.messages[0].content).toContain("因上下文预算不足未展开");
  });
});
