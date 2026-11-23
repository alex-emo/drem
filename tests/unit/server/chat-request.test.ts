import { describe, expect, it } from "vitest";
import { parseChatRequest } from "../../../apps/server/src/deepseek.js";
import { ApiError } from "../../../apps/server/src/protocol.js";

const user = (content: string) => ({ role: "user", content });
const assistant = (content: string) => ({ role: "assistant", content });

function expectApiError(fn: () => unknown, code: string, status: number): ApiError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.code).toBe(code);
    expect(apiError.status).toBe(status);
    return apiError;
  }
  throw new Error("expected throw");
}

describe("parseChatRequest 正常路径", () => {
  it("解析最小请求并填充默认值", () => {
    const parsed = parseChatRequest({ messages: [user("你好")] });
    expect(parsed).toEqual({
      messages: [{ role: "user", content: "你好" }],
      thinking: false,
      webSearch: false,
      files: [],
    });
  });

  it("thinking / webSearch 只接受布尔 true", () => {
    const parsed = parseChatRequest({ messages: [user("hi")], thinking: true, webSearch: true });
    expect(parsed.thinking).toBe(true);
    expect(parsed.webSearch).toBe(true);
  });

  it("files 去重且保留顺序", () => {
    const parsed = parseChatRequest({ messages: [user("hi")], files: ["f1", "f1", "f2"] });
    expect(parsed.files).toEqual(["f1", "f2"]);
  });

  it("requireLastUser: false 允许最后一条是 assistant（context/warm 使用）", () => {
    const parsed = parseChatRequest({ messages: [user("hi"), assistant("hello")] }, { requireLastUser: false });
    expect(parsed.messages).toHaveLength(2);
  });
});

describe("parseChatRequest 参数校验", () => {
  it.each([null, undefined, [], "string", 42])("拒绝非对象请求体：%s", (body) => {
    expectApiError(() => parseChatRequest(body), "INVALID_ARGUMENT", 400);
  });

  it("thinking 非布尔值", () => {
    expectApiError(() => parseChatRequest({ messages: [user("hi")], thinking: "yes" }), "INVALID_ARGUMENT", 400);
  });

  it("webSearch 非布尔值", () => {
    expectApiError(() => parseChatRequest({ messages: [user("hi")], webSearch: 1 }), "INVALID_ARGUMENT", 400);
  });

  it("files 非字符串数组", () => {
    expectApiError(() => parseChatRequest({ messages: [user("hi")], files: [1] }), "INVALID_ARGUMENT", 400);
  });

  it("files 超过 8 个", () => {
    const files = Array.from({ length: 9 }, (_, index) => `f${index}`);
    const error = expectApiError(() => parseChatRequest({ messages: [user("hi")], files }), "INVALID_ARGUMENT", 400);
    expect(error.details?.[0]).toEqual({ field: "files", reason: "too_many" });
  });

  it("messages 为空或缺失", () => {
    expectApiError(() => parseChatRequest({}), "INVALID_ARGUMENT", 400);
    expectApiError(() => parseChatRequest({ messages: [] }), "INVALID_ARGUMENT", 400);
  });

  it("消息元素不是对象", () => {
    expectApiError(() => parseChatRequest({ messages: ["hi"] }), "INVALID_ARGUMENT", 400);
  });

  it("role 不在枚举内", () => {
    const error = expectApiError(
      () => parseChatRequest({ messages: [{ role: "tool", content: "x" }] }),
      "INVALID_ARGUMENT",
      400,
    );
    expect(error.details?.[0]).toEqual({ field: "messages[0].role", reason: "enum" });
  });

  it("content 为空或全空白", () => {
    expectApiError(() => parseChatRequest({ messages: [user("")] }), "INVALID_ARGUMENT", 400);
    expectApiError(() => parseChatRequest({ messages: [user("   ")] }), "INVALID_ARGUMENT", 400);
  });

  it("content 超过 200000 字符", () => {
    expectApiError(
      () => parseChatRequest({ messages: [user("a".repeat(200_001))] }),
      "INVALID_ARGUMENT",
      400,
    );
  });

  it("缺少 user 消息", () => {
    const error = expectApiError(
      () => parseChatRequest({ messages: [assistant("hi")] }),
      "INVALID_ARGUMENT",
      400,
    );
    expect(error.details?.[0]).toEqual({ field: "messages", reason: "missing_user" });
  });

  it("最后一条必须是 user（默认）", () => {
    const error = expectApiError(
      () => parseChatRequest({ messages: [user("hi"), assistant("hello")] }),
      "INVALID_ARGUMENT",
      400,
    );
    expect(error.details?.[0]).toEqual({ field: "messages", reason: "last_must_be_user" });
  });
});
