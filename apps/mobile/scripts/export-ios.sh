#!/usr/bin/env bash
set -euo pipefail
# 需要先在 Xcode 的 Signing & Capabilities 里选择 Team。
# 用法：TEAM_ID=ABCDE12345 BUNDLE_ID=cn.pum.dream bash scripts/export-ios.sh
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
: "${TEAM_ID:?请设置 TEAM_ID（Apple Developer Team ID）}"
BUNDLE_ID="${BUNDLE_ID:-cn.pum.dream}"
xcodebuild \
  -project ios/App/App.xcodeproj \
  -scheme App \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath build/Dream.xcarchive \
  -allowProvisioningUpdates \
  DEVELOPMENT_TEAM="$TEAM_ID" \
  PRODUCT_BUNDLE_IDENTIFIER="$BUNDLE_ID" \
  archive
cat > build/ExportOptions.plist <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>development</string>
  <key>teamID</key><string>$TEAM_ID</string>
  <key>signingStyle</key><string>automatic</string>
  <key>stripSwiftSymbols</key><true/>
</dict>
</plist>
PLIST
xcodebuild -exportArchive -archivePath build/Dream.xcarchive -exportPath build/export -exportOptionsPlist build/ExportOptions.plist -allowProvisioningUpdates
echo "IPA: build/export/"
