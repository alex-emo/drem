import { describe, expect, it } from "vitest";
import {
  buildVersions,
  getVisibleMessages,
  normalizeMessages,
  selectVersion,
  siblingsOf,
} from "@web/lib/branches";
import type { Message } from "@web/lib/types";

const message = (id: string, createdAt: number, extra: Partial<Message> = {}): Message => ({
  id,
  conversationId: "c1",
  role: createdAt % 2 === 0 ? "assistant" : "user",
  content: id,
  status: "done",
  createdAt,
  ...extra,
});

describe("normalizeMessages", () => {
  it("空数组返回空", () => {
    expect(normalizeMessages([])).toEqual({ messages: [], rootId: null, changed: false });
  });

  it("线性消息补成单分支树", () => {
    const input = [message("m2", 200), message("m1", 100)];
    const result = normalizeMessages(input);
    expect(result.changed).toBe(true);
    expect(result.rootId).toBe("m1");
    const byId = new Map(result.messages.map((item) => [item.id, item]));
    expect(byId.get("m1")!.parentId).toBeNull();
    expect(byId.get("m1")!.selectedChildId).toBe("m2");
    expect(byId.get("m2")!.parentId).toBe("m1");
    expect(byId.get("m2")!.selectedChildId).toBeNull();
  });

  it("已有树结构时只排序不改写", () => {
    const input = [
      message("m2", 200, { parentId: "m1", selectedChildId: null }),
      message("m1", 100, { parentId: null, selectedChildId: "m2" }),
    ];
    const result = normalizeMessages(input);
    expect(result.changed).toBe(false);
    expect(result.rootId).toBe("m1");
    expect(result.messages.map((item) => item.id)).toEqual(["m1", "m2"]);
  });

  it("同时存在多个根时取最早的一个", () => {
    const input = [
      message("root2", 200, { parentId: null }),
      message("root1", 100, { parentId: null }),
    ];
    expect(normalizeMessages(input).rootId).toBe("root1");
  });
});

describe("getVisibleMessages / 版本切换", () => {
  // m1(user) → m2(a1) → m3(user2) → m4(a2)
  //          ↘ m5(a1 的另一个版本)
  const tree: Message[] = [
    message("m1", 100, { role: "user", parentId: null, selectedChildId: "m2" }),
    message("m2", 200, { parentId: "m1", selectedChildId: "m3" }),
    message("m3", 300, { role: "user", parentId: "m2", selectedChildId: "m4" }),
    message("m4", 400, { parentId: "m3", selectedChildId: null }),
    message("m5", 250, { parentId: "m1", selectedChildId: "m3" }),
  ];

  it("沿 selectedChildId 还原当前分支", () => {
    expect(getVisibleMessages(tree, "m1").map((item) => item.id)).toEqual(["m1", "m2", "m3", "m4"]);
  });

  it("子节点缺失时回退到最早的兄弟", () => {
    const broken = tree.map((item) =>
      item.id === "m1" ? { ...item, selectedChildId: "missing" } : item,
    );
    expect(getVisibleMessages(broken, "m1").map((item) => item.id)).toEqual(["m1", "m2", "m3", "m4"]);
  });

  it("rootId 不存在时使用第一个根节点", () => {
    expect(getVisibleMessages(tree, "nope")[0].id).toBe("m1");
  });

  it("buildVersions 标注同父节点的版本序号", () => {
    const versions = buildVersions(tree);
    expect(versions.get("m2")).toEqual({ ids: ["m2", "m5"], index: 0 });
    expect(versions.get("m5")).toEqual({ ids: ["m2", "m5"], index: 1 });
    expect(versions.get("m1")).toEqual({ ids: ["m1"], index: 0 });
  });

  it("siblingsOf 返回同一父节点下的全部版本（按时间）", () => {
    const m5 = tree.find((item) => item.id === "m5")!;
    expect(siblingsOf(tree, m5).map((item) => item.id)).toEqual(["m2", "m5"]);
  });

  it("selectVersion 切换非根版本时更新父节点 selectedChildId", () => {
    const result = selectVersion(tree, "m5", "m1");
    expect(result.rootId).toBe("m1");
    expect(result.messages.find((item) => item.id === "m1")!.selectedChildId).toBe("m5");
    expect(getVisibleMessages(result.messages, result.rootId).map((item) => item.id)).toEqual([
      "m1",
      "m5",
      "m3",
      "m4",
    ]);
  });

  it("selectVersion 切换根版本时更换 rootId", () => {
    const withRoots = [message("r1", 100, { parentId: null }), message("r2", 200, { parentId: null })];
    const result = selectVersion(withRoots, "r2", "r1");
    expect(result.rootId).toBe("r2");
  });

  it("selectVersion 目标不存在时原样返回", () => {
    const result = selectVersion(tree, "missing", "m1");
    expect(result.messages).toBe(tree);
    expect(result.rootId).toBe("m1");
  });
});
