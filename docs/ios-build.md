# iOS 1.7.6 构建与签名

当前仓库的 `develop` 分支包含 1.7.6/29 的 iOS 源码；Linux 无法运行 `xcodebuild`，所以本仓库不直接产出 IPA。

## 方式 A：GitHub Actions（推荐）

GitHub 网页需要先允许工作流文件。由于当前 `gh` OAuth token 没有 `workflow` scope，工作流文件不能通过 CLI 推送。

1. 在 GitHub 仓库 `alex-emo/drem` 的 `develop` 分支新建文件 `.github/workflows/ios-unsigned.yml`，内容复制 `docs/ios-unsigned-workflow.yml`。
2. 在 Actions 页面运行 `iOS unsigned IPA`（workflow_dispatch）。
3. 运行结束后下载 artifact `Dream-iOS-unsigned`，里面是未签名 IPA 和 SHA-256。

未签名 IPA 不能直接装真机，必须用 Sideloadly/AltStore/Xcode 以你的 Apple ID 重签。

## 方式 B：Mac 本地构建

```bash
cd apps/mobile
npm ci
DREAM_API_ORIGIN=https://dream.pum.org.cn npm run build:web
npx cap sync ios
cd ios/App
xcodebuild -project App.xcodeproj -scheme App -configuration Release -sdk iphoneos \
  -destination 'generic/platform=iOS' -derivedDataPath build \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" DEVELOPMENT_TEAM=""
cd ..
rm -rf Payload Dream-iOS-unsigned.ipa && mkdir Payload
cp -R build/Build/Products/Release-iphoneos/App.app Payload/
zip -qry Dream-iOS-unsigned.ipa Payload
shasum -a 256 Dream-iOS-unsigned.ipa
```

## 方式 C：已有签名团队

在 Xcode 打开 `apps/mobile/ios/App/App.xcodeproj`，选择 Team 后 Archive/Export；也可以用 `apps/mobile/scripts/export-ios.sh`。

## 版本

- 1.7.6 / 29
- MARKETING_VERSION 1.7.6
- CURRENT_PROJECT_VERSION 29
- API origin https://dream.pum.org.cn
