import { readFileSync } from "node:fs";

const mobile = JSON.parse(readFileSync("apps/mobile/package.json", "utf8")).version;
const gradle = readFileSync("apps/mobile/android/app/build.gradle", "utf8").match(/versionName\s+"([^"]+)"/)?.[1];
const server = readFileSync("apps/server/src/config.ts", "utf8").match(/DREAM_APP_VERSION\s*\?\?\s*"([^"]+)"/)?.[1];

const versions = { "apps/mobile/package.json": mobile, "build.gradle versionName": gradle, "server appVersion": server };
const unique = new Set(Object.values(versions));
if (unique.size !== 1) {
  console.error("版本号不一致：", versions);
  process.exit(1);
}
console.log(`版本一致：${mobile}`);
