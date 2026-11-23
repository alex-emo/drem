export interface ApiResponse<T = any> {
  status: number;
  headers: Headers;
  body: T;
}

export class ApiClient {
  constructor(readonly baseUrl: string) {}

  async request<T = any>(
    method: string,
    path: string,
    options: { token?: string; body?: unknown; headers?: Record<string, string>; rawBody?: BodyInit } = {},
  ): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = { ...(options.headers ?? {}) };
    if (options.token) headers.authorization = `Bearer ${options.token}`;
    let body: BodyInit | undefined = options.rawBody;
    if (options.body !== undefined) {
      headers["content-type"] ??= "application/json";
      body = JSON.stringify(options.body);
    }
    const response = await fetch(`${this.baseUrl}${path}`, { method, headers, body });
    const text = await response.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // 非 JSON（SSE / 二进制）保留原文
    }
    return { status: response.status, headers: response.headers, body: parsed as T };
  }

  get<T = any>(path: string, options?: { token?: string; headers?: Record<string, string> }) {
    return this.request<T>("GET", path, options);
  }

  post<T = any>(path: string, body?: unknown, options?: { token?: string; headers?: Record<string, string> }) {
    return this.request<T>("POST", path, { ...options, body });
  }

  put<T = any>(path: string, body?: unknown, options?: { token?: string; headers?: Record<string, string> }) {
    return this.request<T>("PUT", path, { ...options, body });
  }

  delete<T = any>(path: string, options?: { token?: string; headers?: Record<string, string> }) {
    return this.request<T>("DELETE", path, options);
  }
}

let userCounter = 0;

export async function registerTestUser(
  client: ApiClient,
  prefix = "it",
): Promise<{ token: string; user: { id: string; username: string; isAdmin: boolean } }> {
  userCounter += 1;
  const username = `${prefix}_${Date.now().toString(36).slice(-6)}_${userCounter}`.slice(0, 32);
  const response = await client.post("/api/v1/auth/register", { username, password: "password123" });
  if (response.status !== 201) {
    throw new Error(`注册失败: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return response.body;
}
