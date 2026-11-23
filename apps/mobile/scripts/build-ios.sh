#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "xcodebuild not found. Install Xcode 16+ from the Mac App Store, then run: sudo xcode-select -s /Applications/Xcode.app" >&2
  exit 1
fi

if [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi

export DREAM_API_ORIGIN="${DREAM_API_ORIGIN:-https://dream.pum.org.cn}"
npm run build:web
npx cap sync ios

echo "Resolving Swift packages..."
xcodebuild -project ios/App/App.xcodeproj -scheme App -resolvePackageDependencies

echo "Building for iOS Simulator..."
xcodebuild \
  -project ios/App/App.xcodeproj \
  -scheme App \
  -configuration Debug \
  -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath build \
  CODE_SIGNING_ALLOWED=NO \
  build

echo
echo "Build finished. Open the simulator:"
echo "  open -a Simulator"
echo "Then install the app from build/Build/Products/Debug-iphonesimulator/App.app"
