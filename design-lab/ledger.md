# 抓取台账

> 每一条进入研究文件的来源都在这里登记：URL、抓取日期、结果、可信度、落在哪一节。
> 可信度定义见 [research/README.md](research/README.md)。结论只允许建立在 A / B 级来源上。

## 2026-11-25

| # | 来源 | URL | 结果 | 等级 | 落点 |
|---|---|---|---|---|---|
| 1 | NN/g · Accelerators | https://www.nngroup.com/articles/accelerators/ | 200，正文 | A（一级研究机构 + 明确作者） | 01 §2 |
| 2 | NN/g · Hamburger Menus and Hidden Navigation Hurt UX Metrics | https://www.nngroup.com/articles/hamburger-menus/ | 200，正文 | A | 01 §3 |
| 3 | NN/g · Recognition and Recall in UX | https://www.nngroup.com/articles/recognition-and-recall/ | 200，正文 | A | 01 §4、A §2 |
| 4 | NN/g · Progressive Disclosure | https://www.nngroup.com/articles/progressive-disclosure/ | 200，正文 | A | A §4 |
| 5 | Calm Technology · The Coming Age of Calm Technology（Weiser & Brown, 1996-10-05） | https://calmtech.com/papers/coming-age-calm-technology | 200，正文 | A（原始论文） | 01 §5 |
| 6 | Apple HIG · Onboarding | https://developer.apple.com/design/human-interface-guidelines/onboarding | 200，JS 渲染需等待 | A（平台官方） | A §1 |
| 7 | NN/g · Mobile Instructional Overlays | https://www.nngroup.com/articles/mobile-instructional-overlay/ | 200，正文 | A | A §3 |
| 8 | NN/g · Onboarding Tutorials vs. Contextual Help | https://www.nngroup.com/articles/onboarding-tutorials/ | 200，正文 | A | A §5 |
| 9 | NN/g · Mobile Tutorials: Screen Bloat | https://www.nngroup.com/articles/mobile-tutorials/ | 200，正文 | A | A §6 |
| 10 | HCI.TOP · 手势与触控手册 C3.20.1 / C3.20.2 / C3.20.4 | https://hci.top/zh/handbook/C3.20.1 · https://hci.top/zh/handbook/C3.20.2 · https://hci.top/zh/handbook/C3.20.4 | 200，三条正文 | B（二手汇编，但每条标注了原始文献） | 01 §6 |
| 11 | MUI X Chat · Date divider | https://mui.com/x/react-chat/display/date-divider/ | 200，正文；同日复查由浏览器读到全文 | B（组件库规范，非平台官方） | B §二·来源 8、0002 §3 |
| 12 | Slack 日期分隔实测（slack.green） | https://slack.green/en/blog/slack-jump-to-date | 200，正文 | B（第三方实测，非官方） | B §二·来源 9 |
| 13 | iMessage 时间戳教程（techbloat） | https://www.techbloat.com/how-to-check-the-timestamp-of-messages-on-iphone.html | 200，正文 | B（教程站，非官方） | B §二·来源 10 |
| 14 | 腾讯云 IM UIKit · TimeDividerConfig.timeInterval | https://pub.dev/documentation/tencent_cloud_chat_uikit/2.7.2/ui_views_TIMUIKitChat_tim_uikit_chat_config/TimeDividerConfig/timeInterval.html | 200，正文；默认值 300 秒已逐字核对 | A（官方 API 文档） | B §二·来源 11、0002 §3 |
| 15 | Apple HIG · Gestures / Context menus | https://developer.apple.com/design/human-interface-guidelines/gestures · https://developer.apple.com/design/human-interface-guidelines/context-menus | 200，正文 | A（平台官方） | B §一 |
| 16 | Material 3 · Gestures / State layers | https://m3.material.io/foundations/interaction/gestures · https://m3.material.io/foundations/interaction/states/state-layers | 200，JS 渲染；B 标注 B 级使用 | B | B §一 |
| 17 | Things 3 手势支持 / Linear 设计刷新 | https://culturedcode.com/things/support/articles/2803582/ · https://linear.app/now/behind-the-latest-design-refresh | 200 | B（产品方自述） | B §一 |
| 18 | W3C · WCAG 2.1 Understanding SC 1.4.3 Contrast (Minimum) | https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html | 200，正文（含 4.5:1 / 3:1 / 不四舍五入原文） | A（标准制定方） | 0003 §3 |
| 19 | Apple 支持 · 在 iPhone 上听写文本（中文页） | https://support.apple.com/guide/iphone/dictate-text-iph2c0651d2/ios | 200，正文（轻点麦克风开始/停止、键盘保持打开） | A（平台官方） | 0005 §2.1 |
| 20 | 微信帮助中心 · How to Send a Voice Message | https://cs.help.wechat.com/hc/en-us/articles/11915240382863-How-to-Send-a-Voice-Message | 200，正文（先点语音键切「按住说话」、60 秒、左上滑取消） | A（平台官方） | 0005 §2.2 |
| 21 | Material 3 · Interaction / touch target 48dp | 经 `design-lab/reference/omd-reference.md:146` 转引，未独立抓 M3 原页 | 转引 | B（转引）→ 见 02 §1.1 | 0006 §3、02 §1.1 |
| 22 | W3C · WCAG 2.2 SC 2.5.1 Pointer Gestures | 经 omd 语料转引（单指针/非路径替代） | 转引，未独立抓原文 | B（转引） | 0006 §2、02 §1.1 |
| 23 | oh-my-design-cli · omd-feel skill（reference / SKILL / provenance） | https://unpkg.com/oh-my-design-cli@2.0.0/skills/omd-feel/ | 200 ×3，整包落盘 | C（二次合成；含 A/DS/CONV/OP/FOLK 分级） | reference/、02 |

## 失败与改道（已写入各研究文件「抓取记录」）

| 尝试 | 结果 | 改道 |
|---|---|---|
| https://www.nngroup.com/articles/coach-marks/ | 404 | 改用 `mobile-instructional-overlay`（真实存在） |
| https://www.nngroup.com/articles/onboarding-tutorials-vs-contextual-help/ | 404 | 改用 `onboarding-tutorials` |
| NN/g 站内搜索页 | 200 但只渲染导航、不返回结果 | 先用 web_search 定位真实 URL，再在浏览器逐条打开验证正文 |
| Calm Technology `.html` 后缀 | 301/重定向 | 改用无后缀规范 URL |

## 规则

- 同一 URL 只登记一次；内容更新时在「结果」里追加复抓日期。
- 引用原文必须能在本机缓存或来源页面复核；不记得原文的句子不写进研究文件。
- 来源打不开时保留「失败」记录，不要假装读过。
