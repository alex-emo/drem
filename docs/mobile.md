# Dream 移动端（Android / iOS）

移动端以 DeepSeek 官方开源项目 [chat-demo](https://github.com/deepseek-ai/chat-demo)（MIT）为 UI 基座，
替换认证与模型调用后，用 Capacitor 打包成原生 App。源码在 `apps/mobile/`。

> DeepSeek 手机 App 本身闭源；线上 `chat.deepseek.com` 是混淆 bundle，无法直接复用。
> 这里复用的是其官方开源的客户端实现，界面、消息树、Markdown 渲染与交互与 DeepSeek 客户端保持一致。

## 已接入

- Dream 账号登录 / 注册 / 退出（`src/services/dream/auth.ts`），不再使用 API Key。
- Dream 服务端 `POST /api/v1/chat` SSE 适配（`src/services/dream/api.ts`），支持深度思考、停止生成、内容安全 refusal。
- 会话与消息仍保存在本机 IndexedDB；服务端只做转发与鉴权。
- Capacitor 壳：`capacitor.config.ts`，appId `cn.pum.dream`，默认 API 源 `https://dream.pum.org.cn`。

## 开发与构建

```bash
# 本地开发（API 指向本地服务端）
DREAM_API_ORIGIN=http://127.0.0.1:8787 npm run mobile:dev

# 生产构建（默认 https://dream.pum.org.cn）
npm run mobile:build

# 同步 Web 产物到原生工程
npm run mobile:sync
```

### Android

```bash
export ANDROID_HOME="$PWD/.android-sdk"
export JAVA_HOME="$PWD/.android-sdk/jdk-21.0.13+9"
export GRADLE_USER_HOME="$PWD/.gradle"

cd apps/mobile/android
./gradlew assembleDebug
```

产物：`apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`。

本仓库的 Gradle wrapper 使用腾讯云镜像下载 Gradle 8.14.3（`services.gradle.org` 在部分网络下会超时）。
SDK 需要 platform 36、build-tools 36.0.0；本机环境已装在 `.android-sdk/`，该目录与 `.gradle/` 均已 gitignore。

### iOS

`apps/mobile/ios/App/App.xcodeproj` 已生成，Web 产物已 sync 到 `ios/App/App/public`。
构建需要 macOS + Xcode：

```bash
cd apps/mobile
npx cap open ios
```

在 Xcode 中选择签名 Team 后 Archive 即可。本 Linux 环境只能生成工程，无法签名构建。

### iOS Codex 同步包

每次 Android 发版后，同步生成 iOS 源码包，结构与本仓库 `apps/mobile` 一致（排除 `android/`），并附带已构建的 `dist/` 与 `ios/App/App/public`：

```bash
# 产物
release/Dream-iOS-<版本>.zip
release/Dream-iOS-<版本>.zip.sha256
```

当前：`release/Dream-iOS-1.7.3.zip`（`MARKETING_VERSION=1.7.3`、`CURRENT_PROJECT_VERSION=26`、Bundle ID `cn.pum.dream`）。包内 `CODEX_SYNC.md` 是给 Codex 的验收清单，`BUILDING_IOS.md` 是 Mac 构建/排错说明。

## 分发下载

网页端登录页与侧边栏提供「下载 Android App」入口，指向：

```text
https://dream.pum.org.cn/download/dream-android.apk
```

服务端从 `DREAM_DOWNLOAD_DIR`（默认 `downloads/`，相对进程工作目录）读取该文件，
以 `application/vnd.android.package-archive` + `Content-Disposition: attachment` 返回。
部署时把 APK 放到 `/srv/blog/dream/downloads/dream-android.apk` 即可，Web 静态资源发布不会覆盖该目录。

## v1 限制

- 已支持：联网搜索、纯文本文件上传（txt/md/csv/json/代码）；
- 支持「从导出链接导入」：粘贴 DeepSeek App 的华为云 OBS 链接，App 经 Dream Server 流式解压并写入本地 IndexedDB；
- 图片、PDF、Word 等附件暂不支持，上传会返回可读错误；

- 联网搜索、文件上传按钮已隐藏（服务端尚未实现对应工具，避免点了报错）。
- Mermaid 图表暂不渲染（依赖体积大，移动端 v1 未打包）；普通 Markdown、代码高亮、KaTeX 正常。
- 语音输入依赖 WebView 的 SpeechRecognition 支持，Android WebView 通常不可用（按钮会禁用）。
- 暂无推送、深色/浅色跟随系统由 chat-demo 的设置实现。

## 流式观感

APK 内置客户端文本节拍器：即使 Cloudflare 隧道把 SSE 攒包，回复也会按约 30ms/小段连续出现。


## 本地加密与云端同步（1.6+）

- 登录后先用 `/api/v1/backup` 取密钥，`chat-demo` 的会话与标题用 AES-GCM 加密后写入 IndexedDB；未解锁不初始化聊天。
- 云端备份为 gzip + AES-GCM；App 上传同时包含 `sessions`（保留分支）与 `conversations/messages`（供 Web 读取）。
- 首次登录、云端无备份且本机有会话时弹窗询问是否上传；拒绝后不再自动上传。
- 旧 10 位密钥账号自动迁移：旧密钥解密云端 → 转 App 会话 → 新 32 字节密钥重加密并上传，服务端清除旧密钥。


## Dream 自有加密导出（1.6.2+）

- 「设置 → 数据管理 → 导出所有历史对话」现在下载 `dream-export-*.dream`：gzip + AES-GCM，使用当前账号密钥加密，不再只导出 DeepSeek ZIP。
- 导入时自动识别 `.dream`：加密文件用账号密钥解密后合并；旧 `dream-backup` JSON / 未加密 `dream-export` 直接导入；旧 DeepSeek ZIP 仍走原导入流程。
- `.dream` 同时包含 `sessions` 与 `conversations/messages`，可在 Web 与 App 之间互相恢复。
