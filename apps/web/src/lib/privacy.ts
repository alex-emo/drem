/** 通过配额特征判断是否可能处于无痕/隐私模式（Chrome 无痕通常只有约 120MB 配额）。 */
export async function detectPrivateMode(): Promise<boolean> {
  try {
    if (!navigator.storage?.estimate) return false;
    const { quota } = await navigator.storage.estimate();
    if (!quota || quota <= 0) return true;
    return quota < 200 * 1024 * 1024;
  } catch {
    // 浏览器拒绝 estimate 时通常意味着隐私模式或受限环境，按“可能无痕”处理。
    return true;
  }
}
