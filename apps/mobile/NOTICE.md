# 第三方源码说明

本目录 `apps/mobile` 的 UI 基座来自 DeepSeek 官方开源项目 **chat-demo**：

- 仓库：https://github.com/deepseek-ai/chat-demo
- 许可证：MIT（见同目录 `LICENSE`，版权归 DeepSeek）
- 用途：复用其聊天界面、消息树/分支、Markdown/KaTeX/Mermaid 渲染、设置与移动端布局。
- 修改：接入了 Dream 账号登录、Dream 服务端 `/api/v1/chat` SSE 适配、Capacitor 打包配置；原 API Key 入口改为 Dream 账号。

DeepSeek 手机 App 本身闭源，`chat.deepseek.com` 的线上 bundle 为混淆产物，未在本项目中使用。
