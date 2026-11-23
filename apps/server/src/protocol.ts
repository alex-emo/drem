/** Dream App ↔ Server 协议的公共定义（v1）。 */

export const API_VERSION = "v1";
export const SERVER_VERSION = "0.2.0";

/** 请求体上限：8 MiB。长对话（含代码块/长文）历史可能超过 1 MiB，但仍需限制单请求大小。 */
export const MAX_BODY_BYTES = 16 * 1024 * 1024;
export const MAX_BODY_MIB = 16;

/** 内容安全拒绝时返回给客户端的固定答复（与 DeepSeek 客户端一致）。 */
export const REFUSAL_MESSAGE = "你好，这个问题我暂时无法回答，让我们换个话题再聊聊吧。";

export type ApiErrorCode =
  | "INVALID_ARGUMENT"
  | "UNAUTHORIZED"
  | "INVALID_CREDENTIALS"
  | "USERNAME_TAKEN"
  | "ACCOUNT_DISABLED"
  | "ACCOUNT_UNVERIFIED"
  | "SESSION_REVOKED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "METHOD_NOT_ALLOWED"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "RATE_LIMITED"
  | "CONTENT_FILTERED"
  | "INTERNAL"
  | "UPSTREAM_AUTH_FAILED"
  | "UPSTREAM_ERROR"
  | "UPSTREAM_NOT_CONFIGURED"
  | "UPSTREAM_TIMEOUT"
  | "REQUEST_ABORTED";

export interface ApiErrorDetail {
  field?: string;
  reason?: string;
  [key: string]: unknown;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly details?: ApiErrorDetail[];

  constructor(status: number, code: ApiErrorCode, message: string, details?: ApiErrorDetail[]) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const ERROR_HEX_CODES: Record<ApiErrorCode | "STREAM_TIMEOUT", string> = {
  INVALID_ARGUMENT: "0x1001",
  UNSUPPORTED_MEDIA_TYPE: "0x1002",
  PAYLOAD_TOO_LARGE: "0x1003",
  CONTENT_FILTERED: "0x1004",
  UNAUTHORIZED: "0x2001",
  INVALID_CREDENTIALS: "0x2002",
  USERNAME_TAKEN: "0x2003",
  ACCOUNT_DISABLED: "0x2004",
  ACCOUNT_UNVERIFIED: "0x2005",
  SESSION_REVOKED: "0x2006",
  FORBIDDEN: "0x2007",
  NOT_FOUND: "0x3001",
  METHOD_NOT_ALLOWED: "0x3002",
  RATE_LIMITED: "0x3003",
  UPSTREAM_AUTH_FAILED: "0x4001",
  UPSTREAM_ERROR: "0x4002",
  UPSTREAM_NOT_CONFIGURED: "0x4003",
  UPSTREAM_TIMEOUT: "0x4004",
  REQUEST_ABORTED: "0x4005",
  INTERNAL: "0x5001",
  STREAM_TIMEOUT: "0x5002",
};

/**
 * 对外错误文案目录：按错误码返回固定中文，不拼接上游原始报错。
 * 上游细节只写入服务端日志 / error_events，供排查，不返回给客户端。
 */
export const USER_ERROR_MESSAGES: Record<ApiErrorCode | "STREAM_TIMEOUT", string> = {
  INVALID_ARGUMENT: "请求内容不正确，请检查后重试。",
  UNSUPPORTED_MEDIA_TYPE: "不支持这种文件类型。",
  PAYLOAD_TOO_LARGE: "内容过长，请精简后重试。",
  CONTENT_FILTERED: "这个话题暂时无法回答，请换一个话题。",
  UNAUTHORIZED: "登录已失效，请重新登录。",
  INVALID_CREDENTIALS: "用户名或密码不正确。",
  USERNAME_TAKEN: "这个用户名已被使用。",
  ACCOUNT_DISABLED: "账号暂时不可用，请联系管理员。",
  ACCOUNT_UNVERIFIED: "账号暂时不可用，请联系管理员。",
  SESSION_REVOKED: "账号已在其他设备登录，请重新登录。",
  FORBIDDEN: "没有权限执行这个操作。",
  NOT_FOUND: "请求的内容不存在。",
  METHOD_NOT_ALLOWED: "请求方式不正确。",
  RATE_LIMITED: "操作过于频繁，请稍后再试。",
  UPSTREAM_AUTH_FAILED: "模型服务暂时不可用，请稍后重试。",
  UPSTREAM_ERROR: "模型服务暂时不可用，请稍后重试。",
  UPSTREAM_NOT_CONFIGURED: "模型服务尚未配置，请联系管理员。",
  UPSTREAM_TIMEOUT: "响应超时，请稍后重试。",
  REQUEST_ABORTED: "请求已取消。",
  INTERNAL: "服务内部错误，请稍后重试。",
  STREAM_TIMEOUT: "生成超时，请稍后重试。",
};

export function errorHex(code: ApiErrorCode | "STREAM_TIMEOUT"): string {
  return ERROR_HEX_CODES[code] ?? "0x5001";
}

export function userErrorMessage(code: ApiErrorCode | "STREAM_TIMEOUT"): string {
  return USER_ERROR_MESSAGES[code] ?? USER_ERROR_MESSAGES.INTERNAL;
}

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    hex: string;
    message: string;
    requestId: string;
    details?: ApiErrorDetail[];
  };
}

export function errorBody(error: ApiError, requestId: string): ApiErrorBody {
  return {
    error: {
      code: error.code,
      hex: errorHex(error.code),
      // 只返回目录里的固定中文；原始 error.message 仅用于日志/后台排查。
      message: userErrorMessage(error.code),
      requestId,
      ...(error.details && error.details.length > 0 ? { details: error.details } : {}),
    },
  };
}

/** 编码一个 Dream SSE 事件。 */
export function sseEncode(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function sseHeaders(requestId: string): Record<string, string> {
  return {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
    "x-request-id": requestId,
    "x-api-version": API_VERSION,
  };
}
