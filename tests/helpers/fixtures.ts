import { registerUser, type PublicUser } from "../../apps/server/src/auth.js";
import { db } from "../../apps/server/src/db.js";

let counter = 0;

/** 在测试库里注册一个真实用户（scrypt 哈希 + session），返回 token 与用户信息。 */
export async function createTestUser(prefix = "user"): Promise<{ token: string; user: PublicUser }> {
  counter += 1;
  const username = `${prefix}${Date.now().toString(36).slice(-6)}${counter}`.slice(0, 32);
  return registerUser({ username, password: "password123" });
}

/** 清空会跨用例干扰的表（每个测试文件使用独立临时库）。 */
export function resetTables(): void {
  db.exec("DELETE FROM sessions; DELETE FROM files; DELETE FROM context_summaries;");
}
