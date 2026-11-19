import { config } from "./config.js";

export interface PooledKey {
  /** 1-based 序号，仅用于日志与统计，不暴露密钥内容。 */
  id: number;
  value: string;
}

/**
 * 上游 API Key 池：轮询选择 + 失败冷却。
 *
 * 多个 Key 通常属于不同工作空间/配额，轮询可以摊平限流；
 * 401/402/403/429/5xx 会临时冷却该 Key，让后续请求优先使用其它 Key。
 */
export class KeyPool {
  private readonly keys: PooledKey[];
  private cursor = 0;
  private readonly cooldownUntil = new Map<number, number>();

  constructor(values: string[], idOffset = 0) {
    this.keys = values.map((value, index) => ({ id: idOffset + index + 1, value }));
  }

  get size(): number {
    return this.keys.length;
  }

  get total(): number {
    return this.keys.length;
  }

  get available(): number {
    const now = Date.now();
    return this.keys.filter((key) => (this.cooldownUntil.get(key.id) ?? 0) <= now).length;
  }

  acquire(exclude: Set<number> = new Set()): PooledKey | null {
    const now = Date.now();
    for (let offset = 0; offset < this.keys.length; offset += 1) {
      const key = this.keys[(this.cursor + offset) % this.keys.length];
      if (exclude.has(key.id)) continue;
      if ((this.cooldownUntil.get(key.id) ?? 0) > now) continue;
      this.cursor = (this.cursor + offset + 1) % this.keys.length;
      return key;
    }
    return null;
  }

  /** 所有 Key 都在冷却时，仍允许最后尝试一遍，避免直接 503。 */
  acquireIgnoringCooldown(exclude: Set<number> = new Set()): PooledKey | null {
    for (let offset = 0; offset < this.keys.length; offset += 1) {
      const key = this.keys[(this.cursor + offset) % this.keys.length];
      if (exclude.has(key.id)) continue;
      this.cursor = (this.cursor + offset + 1) % this.keys.length;
      return key;
    }
    return null;
  }

  markFailure(key: PooledKey, cooldownMs: number): void {
    this.cooldownUntil.set(key.id, Date.now() + cooldownMs);
  }

  markSuccess(key: PooledKey): void {
    this.cooldownUntil.delete(key.id);
  }

  stats(): { total: number; available: number } {
    return { total: this.total, available: this.available };
  }

  /** 管理后台用：每个 Key 的可用状态与冷却截止时间（不含密钥内容）。 */
  details(): Array<{ id: number; available: boolean; cooldownUntil: number | null }> {
    const now = Date.now();
    return this.keys.map((key) => {
      const until = this.cooldownUntil.get(key.id) ?? 0;
      return { id: key.id, available: until <= now, cooldownUntil: until > now ? until : null };
    });
  }
}

export const keyPool = new KeyPool(config.apiKeys);
/** DeepSeek 回退池；ID 从 101 开始，避免与主 Key 池统计混淆。 */
export const fallbackKeyPool = config.fallback ? new KeyPool(config.fallback.keys, 100) : null;

export function isRetryableStatus(status: number): boolean {
  return (
    status === 401 ||
    status === 402 ||
    status === 403 ||
    status === 408 ||
    status === 409 ||
    status === 425 ||
    status === 429 ||
    status >= 500
  );
}

export function cooldownForStatus(status?: number): number {
  if (status === 401) return 60 * 60_000;
  if (status === 402) return 30 * 60_000;
  if (status === 403) return 30 * 60_000;
  if (status === 429) return 60_000;
  if (status !== undefined && status >= 500) return 30_000;
  return 30_000;
}
