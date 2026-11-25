# 02 · 动效与交互

## 1. 原则

1. **功能优先**：动效解释“发生了什么 / 结果在哪”，不做过场。
2. **短而确定**：所有时长在 120–320ms，进入短于退出。
3. **可打断**：过渡可被下一次输入打断；长列表滚动期间不播进入动画。
4. **一致**：同一语义（聚焦、发送、错误）全 App 用同一时长/曲线。
5. **可关闭**：`MediaQuery.disableAnimations` 时位移/缩放/透明度过渡一律 0，只做状态突变。

## 2. 时长与曲线

| 语义 | 时长 | 曲线 |
|---|---|---|
| 按压反馈 | 120ms | `cubic(0.2,0,0,1)` |
| 快（选中、聚焦、开关） | 180ms | `cubic(0.2,0,0,1)` |
| 页面进入 | 280ms | `cubic(0.2,0,0,1)` |
| 页面退出 | 220ms | `cubic(0.4,0,1,1)` |
| 气泡进入 | 260ms | `cubic(0.2,0,0,1)` |
| 主题切换 | 280ms | linear（实现用 DreamMotion.standard，见下方 token 表） |
| 骨架闪烁 | 1200ms 循环 | easeInOut |
| 流式光标呼吸 | 600ms 循环 | linear |
| 错误横幅淡入 | 220ms | `cubic(0.2,0,0,1)` |

标准曲线 token：`DreamMotion.standard = cubic(0.2,0,0,1)`。

## 3. 组件编排

- **按压**：按下 scale 0.97，抬起回弹，120ms；禁用不缩放只变透明度。
- **聚焦**：边框 180ms 从 border→brand（1.5px），不位移。
- **页面进入**：透明度 0→1 + 位移 4%（Y +12pt→0），280ms；退出反向 220ms。
- **空态建议**：依次淡入+上移 6pt，间隔 45ms，最多 5 项；仅首屏播一次。
- **气泡进入**：透明度 0→1 + Y +6pt→0，260ms；用户气泡从右，助手从左，位移 ≤8pt；流式打字不加动画。
- **发送**：按钮在 canSend 翻转时 180ms 变色；发送后内容清空不播动画。
- **错误态**：错误横幅 220ms 淡入，不弹跳；重试按钮 120ms 按压。
- **弹层**：iOS 底部、Android 底部，交给系统 sheet，不自定义曲线。
- **流式**：光标用 `brand` 1.5pt 竖条 600ms 呼吸；文本只追加不重排已有行。

## 4. 触感

- 轻触选择：`HapticFeedback.selectionClick()`。
- 发送成功 / 主确认：`HapticFeedback.mediumImpact()`。
- 错误：`HapticFeedback.lightImpact()`，不震动长。
- 滚动、逐字、空态不进触感。

## 5. 性能规则

- 只动画 `opacity` / `transform`；禁止在滚动列表里动画 `layout`（宽高/边距）。
- 列表项用 `RepaintBoundary` 隔离；气泡文本不做逐帧重排。
- 120Hz 设备动画仍按 60fps 预算，宁可更稳不快。
- 避免大面积 `BackdropFilter`；输入区不用模糊。
- 流式追加用 `AnimatedSize`/局部重建，不用整列 `ListView.builder` 重建。

## 6. 减少动效

`MediaQuery.disableAnimations == true` 时：

- 所有 `Duration` 归 0；`scale`/`offset` 直接到终值。
- 保留状态突变（canSend 变色、焦点边框、错误显示），去掉闪烁和呼吸。
- 不因减少动效而少显示内容或步骤。

## 7. 测试

- widget test 断言：按压可交互、焦点态存在、错误态可达。
- 动效时长不写进断言；用 `pumpAndSettle` 或固定 `pump(duration)` 推进。
- 减少动效路径单独一个用例：`MediaQuery(disableAnimations:true)` 下交互可达。
