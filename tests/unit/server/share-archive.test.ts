import { describe, expect, it } from "vitest";
import { parseShareId } from "../../../apps/server/src/share.js";
import { validateArchiveUrl } from "../../../apps/server/src/archiveImport.js";

describe("parseShareId", () => {
  const id = "abcDEF123456789_-xyz";

  it("接受裸 id（16–64 位 URL 安全字符）", () => {
    expect(parseShareId(id)).toBe(id);
    expect(parseShareId(`  ${id}  `)).toBe(id);
  });

  it("接受 chat.deepseek.com 分享链接（含尾斜杠）", () => {
    expect(parseShareId(`https://chat.deepseek.com/share/${id}`)).toBe(id);
    expect(parseShareId(`http://chat.deepseek.com/share/${id}/`)).toBe(id);
  });

  it("拒绝过短/过长/非法字符与其它域名", () => {
    expect(parseShareId("short")).toBeNull();
    expect(parseShareId("a".repeat(65))).toBeNull();
    expect(parseShareId("abc!@#$%^&*()_+abcd")).toBeNull();
    expect(parseShareId(`https://evil.com/share/${id}`)).toBeNull();
    expect(parseShareId(`https://chat.deepseek.com/chat/${id}`)).toBeNull();
    expect(parseShareId("")).toBeNull();
  });
});

describe("validateArchiveUrl", () => {
  const ok = "https://deepseek-export.obs.cn-north-4.myhuaweicloud.com/archive.zip?sig=1";

  it("接受华为云 OBS 的 https 链接", () => {
    expect(validateArchiveUrl(ok).hostname).toBe("deepseek-export.obs.cn-north-4.myhuaweicloud.com");
  });

  it("拒绝 http", () => {
    expect(() => validateArchiveUrl(ok.replace("https://", "http://"))).toThrowError(/https/);
  });

  it("拒绝非华为云域名（含伪装后缀）", () => {
    for (const url of [
      "https://evil.com/archive.zip",
      "https://myhuaweicloud.com.evil.com/archive.zip",
      "https://notmyhuaweicloud.com/archive.zip",
    ]) {
      expect(() => validateArchiveUrl(url)).toThrowError(/华为云|myhuaweicloud/);
    }
  });

  it("接受子域名且大小写不敏感", () => {
    expect(validateArchiveUrl("https://A.OBS.MYHUAWEICLOUD.COM/x.zip").hostname).toBe(
      "a.obs.myhuaweicloud.com",
    );
  });

  it("拒绝非法 URL", () => {
    expect(() => validateArchiveUrl("not a url")).toThrowError(/格式/);
  });
});
