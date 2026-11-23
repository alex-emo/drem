import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiClient } from "./helpers/api.js";
import { startTestServer, type TestServer } from "./helpers/server.js";

let server: TestServer;
let client: ApiClient;

beforeAll(async () => {
  // 独立服务器：全局限流调成每窗口 3 次，便于断言。
  server = await startTestServer({ DREAM_RL_GLOBAL: "3" });
  client = new ApiClient(server.baseUrl);
});

afterAll(async () => {
  await server.stop();
});

describe("IP 全局限流", () => {
  it("超过窗口配额返回 429 + Retry-After，健康检查不受限", async () => {
    for (let index = 0; index < 3; index += 1) {
      expect((await client.get("/api/v1/models")).status).toBe(200);
      expect((await client.get("/api/v1/health")).status).toBe(200);
    }
    const limited = await client.get("/api/v1/models");
    expect(limited.status).toBe(429);
    expect(limited.body.error).toMatchObject({ code: "RATE_LIMITED", hex: "0x3003" });
    expect(limited.body.error.details?.[0]).toEqual({ field: "ip", reason: "global" });
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await client.get("/api/v1/health")).status).toBe(200);
  });
});
