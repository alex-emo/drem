import type { Context } from "hono";
import { ApiError, errorBody } from "./protocol.js";
import { pushLog } from "./logs.js";

/**
 * 进程内固定窗口限流。
 *
 * 目标是挡住脚本化的注册/扫接口/聊天刷量，而不是做精确的计费级配额。
 * 单实例部署（当前 Cloudflare Tunnel → 单 Node 进程），内存计数够用；
 * 多实例时需换成 Redis/DB 共享计数。
 */
export type LimitRule = {
  name: string;
  /** 窗口内允许的次数 */
  limit: number;
  /** 窗口长度（毫秒） */
  windowMs: number;
  /** 超限后的封禁时长（毫秒） */
  blockMs: number;
};

type Bucket = {
  count: number;
  resetAt: number;
  blockedUntil: number;
};

const CLEANUP_INTERVAL_MS = 60_000;
const MAX_BUCKETS = 50_000;

export class IpRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor() {
    const timer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
    timer.unref?.();
  }

  /** 返回 retryAfter 秒；未超限返回 0。 */
  hit(ip: string, rule: LimitRule): number {
    const now = Date.now();
    const key = `${rule.name}:${ip}`;
    let bucket = this.buckets.get(key);

    if (!bucket) {
      if (this.buckets.size >= MAX_BUCKETS) {
        this.evictOne();
      }
      bucket = { count: 0, resetAt: now + rule.windowMs, blockedUntil: 0 };
      this.buckets.set(key, bucket);
    }

    if (bucket.blockedUntil > now) {
      return Math.max(1, Math.ceil((bucket.blockedUntil - now) / 1000));
    }

    if (now >= bucket.resetAt) {
      bucket.count = 0;
      bucket.resetAt = now + rule.windowMs;
      bucket.blockedUntil = 0;
    }

    bucket.count += 1;
    if (bucket.count > rule.limit) {
      bucket.blockedUntil = now + rule.blockMs;
      return Math.max(1, Math.ceil((bucket.blockedUntil - now) / 1000));
    }

    return 0;
  }

  /** 防止伪造 X-Forwarded-For 制造无限 bucket；优先淘汰已过期项。 */
  private evictOne(): void {
    const now = Date.now();
    for (const [key, bucket] of this.buckets) {
      if (now > bucket.resetAt && now > bucket.blockedUntil) {
        this.buckets.delete(key);
        return;
      }
    }
    const first = this.buckets.keys().next().value;
    if (first !== undefined) this.buckets.delete(first);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, bucket] of this.buckets) {
      if (now > bucket.resetAt && now > bucket.blockedUntil) {
        this.buckets.delete(key);
      }
    }
  }
}

export function clientIp(c: Context): string {
  // Cloudflare 会覆盖并设置 cf-connecting-ip；本地/直连时退回 x-real-ip / x-forwarded-for。
  const candidates = [
    c.req.header("cf-connecting-ip"),
    c.req.header("x-real-ip"),
    c.req.header("x-forwarded-for")?.split(",")[0],
  ];
  for (const candidate of candidates) {
    const ip = candidate?.trim();
    if (ip) return ip;
  }
  return "unknown";
}

const limiter = new IpRateLimiter();

/** 供 WebSocket upgrade 等非 Hono 场景复用同一计数桶。 */
export function hitRateLimit(ip: string, rule: LimitRule): number {
  return limiter.hit(ip, rule);
}

/** 命中限流时直接写 429 响应并返回 null；否则返回 undefined 继续。 */
export function enforceRateLimit(c: Context, rule: LimitRule): Response | undefined {
  const ip = clientIp(c);
  const retryAfter = limiter.hit(ip, rule);
  if (retryAfter <= 0) return undefined;

  const requestId = (c.get("requestId") as string | undefined) ?? "";
  const error = new ApiError(
    429,
    "RATE_LIMITED",
    `请求过于频繁，请 ${retryAfter} 秒后再试。`,
    [{ field: "ip", reason: rule.name }],
  );

  pushLog({
    level: "warn",
    requestId,
    method: c.req.method,
    path: c.req.path,
    status: 429,
    durationMs: 0,
    username: c.get("requestUser"),
    message: `rate limited ip=${ip} rule=${rule.name} retryAfter=${retryAfter}s`,
  });
  console.warn(`[rate-limit] ip=${ip} rule=${rule.name} retryAfter=${retryAfter}s path=${c.req.path}`);

  return c.json(errorBody(error, requestId), 429, {
    "retry-after": String(retryAfter),
  });
}
