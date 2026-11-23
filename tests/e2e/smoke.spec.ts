import { expect, test } from "@playwright/test";

/**
 * 端到端冒烟用例：注册 → 新建对话 → 发送消息（服务端 DREAM_MOCK=1）。
 * 只覆盖"页面能跑通主流程"，细节逻辑交给单元/集成测试。
 */
test.describe("Dream 冒烟流程", () => {
  const username = `e2e_${Date.now().toString(36)}`;
  const password = "password123";

  test("注册后可以登录并完成一次对话", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /Dream/ })).toBeVisible({ timeout: 20_000 });

    // 注册（表单文案不确定时按输入框占位符定位，避免绑定到具体 layout）
    await page.getByRole("button", { name: /注册/ }).first().click();
    await page.getByPlaceholder(/用户名/).fill(username);
    await page.getByPlaceholder(/密码/).fill(password);
    await page.getByRole("button", { name: /注册|创建账号/ }).last().click();

    // 进入主界面后发一条消息
    const composer = page.getByRole("textbox").last();
    await expect(composer).toBeVisible({ timeout: 20_000 });
    await composer.fill("你好");
    await composer.press("Enter");

    await expect(page.getByText(/你好/).first()).toBeVisible({ timeout: 30_000 });
  });

  test("健康检查接口可访问", async ({ request }) => {
    const response = await request.get("/api/v1/health");
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body).toMatchObject({ apiVersion: "v1", mock: true });
  });
});
