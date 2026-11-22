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
