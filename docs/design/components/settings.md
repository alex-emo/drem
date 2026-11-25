# 组件规格 · Settings（设置）

Owner: settings-motion

## 1. 目标

一个克制、分组清晰、可扩展的设置页。P0 只有主题 + 关于。

## 2. 分组

```text
[ 顶栏 “设置” + 返回 ]
外观
  ├─ 主题：System / 深色 / 浅色（segmented，3 段）
关于
  ├─ 版本：1.7.12 (35)
  └─ 重构分支：feat/flutter-mobile-rewrite（可复制）
```

- 每行 ≥44pt，labelLarge 14/500，右侧 value textSecondary。
- 分组之间 1px 结构线 + section 标题 labelMedium。
- 主题用 segmented 控件，当前值高亮 `brandSoft`；改动立即生效并持久化。

## 3. 行为

- 主题切换 280ms；写 SharedPreferences（`theme_controller`）。
- System 模式跟随系统亮度；深/浅强制。
- 版本号取自 `pubspec.yaml` 常量（`__APP_VERSION__` 定义于 main，或硬编码常量与构建注入对齐）。

## 4. 状态

- 三档主题 + 选中态
- 深/浅/减少动效/大字号

## 5. 验收（单测）

- 点击三档，`theme_controller` 值与持久化一致。
- 版本行显示 `1.7.12 (35)`。
- 返回可达；大字号不截断。
