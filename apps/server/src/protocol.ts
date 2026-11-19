/** Dream App ↔ Server 协议的公共定义（v1）。 */

export const API_VERSION = "v1";
export const SERVER_VERSION = "0.2.0";

/** 请求体上限：8 MiB。长对话（含代码块/长文）历史可能超过 1 MiB，但仍需限制单请求大小。 */
export const MAX_BODY_BYTES = 8 * 1024 * 1024;
export const MAX_BODY_MIB = 8;

/** 内容安全拒绝时返回给客户端的固定答复（与 DeepSeek 客户端一致）。 */
export const REFUSAL_MESSAGE = "你好，这个问题我暂时无法回答，让我们换个话题再聊聊吧。";

export type ApiErrorCode =
  | "INVALID_ARGUMENT"
  | "UNAUTHORIZED"
  | "INVALID_CREDENTIALS"
  | "USERNAME_TAKEN"
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

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    requestId: string;
    details?: ApiErrorDetail[];
  };
}

export function errorBody(error: ApiError, requestId: string): ApiErrorBody {
  return {
    error: {
      code: error.code,
      message: error.message,
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
