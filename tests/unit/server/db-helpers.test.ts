import { beforeEach, describe, expect, it } from "vitest";
import {
  createAnnouncement,
  deleteAnnouncement,
  db,
  deleteFile,
  getAppSetting,
  getContextSummary,
  getFiles,
  listAnnouncements,
  listFiles,
  latestAnnouncement,
  putClientError,
  putContextSummary,
  putFile,
  setAppSetting,
  updateAnnouncement,
} from "../../../apps/server/src/db.js";
import { createTestUser } from "../../helpers/fixtures.js";

const BASE_FILE = {
  id: "f1",
  user_id: "u1",
  name: "note.txt",
  bytes: 5,
  chars: 5,
  content: "hello",
  created_at: "2026-01-01T00:00:00.000Z",
};

async function userId(): Promise<string> {
  const { user } = await createTestUser();
  return user.id;
}

beforeEach(() => {
  db.exec("DELETE FROM announcements; DELETE FROM app_settings; DELETE FROM files; DELETE FROM client_errors;");
});

describe("上下文摘要缓存", () => {
  it("写入后可读，重复写入覆盖旧值", () => {
    expect(getContextSummary("missing")).toBeNull();
    putContextSummary("k1", "第一版");
    expect(getContextSummary("k1")).toBe("第一版");
    putContextSummary("k1", "第二版");
    expect(getContextSummary("k1")).toBe("第二版");
  });
});

describe("文件表", () => {
  it("按用户隔离，列表按时间倒序", async () => {
    const owner = await userId();
    const other = await userId();
    putFile({ ...BASE_FILE, id: "old", user_id: owner, created_at: "2026-01-01T00:00:00.000Z" });
    putFile({ ...BASE_FILE, id: "new", user_id: owner, created_at: "2026-01-02T00:00:00.000Z" });
    putFile({ ...BASE_FILE, id: "other", user_id: other });

    expect(listFiles(owner).map((row) => row.id)).toEqual(["new", "old"]);
    expect(listFiles(other).map((row) => row.id)).toEqual(["other"]);
    expect(getFiles(owner, ["old", "other"])).toHaveLength(1);
    expect(getFiles(owner, [])).toEqual([]);
  });

  it("删除只影响自己的文件", async () => {
    const owner = await userId();
    const other = await userId();
    putFile({ ...BASE_FILE, user_id: owner });
    expect(deleteFile(other, "f1")).toBe(false);
    expect(deleteFile(owner, "f1")).toBe(true);
    expect(deleteFile(owner, "f1")).toBe(false);
  });
});

describe("公告", () => {
  it("创建/更新/删除与 active 过滤", () => {
    const first = createAnnouncement("维护", "今晚 22 点维护", true);
    expect(first).toMatchObject({ title: "维护", body: "今晚 22 点维护", active: 1 });
    expect(listAnnouncements().map((row) => row.id)).toEqual([first.id]);
    expect(latestAnnouncement()?.id).toBe(first.id);

    const off = createAnnouncement("下线", "已结束", false);
    expect(latestAnnouncement()?.id).toBe(first.id);

    const updated = updateAnnouncement(off.id, "上线", "重新上线", true);
    expect(updated).toMatchObject({ title: "上线", active: 1 });
    expect(latestAnnouncement()?.id).toBe(off.id);

    expect(updateAnnouncement(9999, "x", "y", true)).toBeNull();
    expect(deleteAnnouncement(off.id)).toBe(true);
    expect(deleteAnnouncement(off.id)).toBe(false);
    expect(listAnnouncements()).toHaveLength(1);
  });
});

describe("应用设置", () => {
  it("set/get 覆盖写入", () => {
    expect(getAppSetting("model.temperature")).toBeUndefined();
    setAppSetting("model.temperature", "0.3");
    expect(getAppSetting("model.temperature")?.value).toBe("0.3");
    setAppSetting("model.temperature", "1.2");
    expect(getAppSetting("model.temperature")?.value).toBe("1.2");
  });
});

describe("客户端错误上报", () => {
  it("截断超长字段后入库", () => {
    putClientError({
      userId: null,
      username: "alice",
      kind: "k".repeat(100),
      message: "m".repeat(2000),
      detail: "d".repeat(9000),
      userAgent: "ua".repeat(600),
    });
    const row = db.prepare("SELECT * FROM client_errors").get() as Record<string, string>;
    expect(row.message).toHaveLength(1000);
    expect(row.detail).toHaveLength(4000);
    expect(row.user_agent).toHaveLength(500);
    expect(row.username).toBe("alice");
  });
});
