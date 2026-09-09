---
name: ohos-native-share
description: >-
  Use when users want to add HarmonyOS-native cross-device sharing (碰一碰/一碰传/knockShare/tap-to-share)
  to a Qt application already migrated to HarmonyOS. Covers Share Kit knock mode (harmonyShare.on('knockShare'))
  for text (TEXT UTD), links (HYPERLINK UTD), files and images (FILE/JPEG/PNG UTD), plus discover mode
  (systemShare.ShareController.show) and RECEIVE side (module.json5 skills + newWantReceived).
  Triggered by: 碰一碰, 一碰传, 一碰连, tap-to-share, knockShare, 跨设备分享, 跨设备传文件/链接, share kit,
  harmonyShare, systemShare, SharableTarget.
---

# HarmonyOS Native Share (碰一碰 / knockShare) for Qt Apps

## Overview

This skill provides knowledge for integrating HarmonyOS-native cross-device sharing ("碰一碰" / "一碰传" / knockShare)
into Qt applications that have already been migrated to HarmonyOS/OpenHarmony.

**Core thesis**: HarmonyOS "碰一碰" at the application layer = `@kit.ShareKit` `harmonyShare.on('knockShare', cb)`,
**NOT** Qt NFC (unavailable on OHOS) and **NOT** `@ohos.nfc.*`. The system handles NFC internally; the app only
arms data and calls `sharableTarget.share(sharedData)` in the knock callback.

## Loading Sequence

When this skill is triggered, load pages in this order:

```
① semantic/qt-harmonyos-tap-to-share.md           → Mechanism + UTD type lookup table + SEND/RECEIVE split
② semantic/qt-harmonyos-tap-to-share-code-patterns.md → K1-K8 Before/After code patterns
```

## Task Routing

| User says... | Load |
|---|---|
| 碰一碰/一碰传/跨设备分享 | `semantic/qt-harmonyos-tap-to-share` + `semantic/qt-harmonyos-tap-to-share-code-patterns` |
| 传文本/传链接/传文件/传图片 | Same — UTD type lookup table in tap-to-share.md decides TEXT/HYPERLINK/JPEG/PNG/FILE |
| 接收分享文件 | `semantic/qt-harmonyos-tap-to-share-code-patterns` §K7/K8 (module.json5 skills + newWantReceived) |

## Key Decision

```
收到"碰一碰"任务
    │
    ├─ Qt 应用是什么类型？
    │   ├─ 文本编辑类（TeXworks/记事本）  → UTD: TEXT，传 content（选中文本）
    │   ├─ 浏览器/链接类                   → UTD: HYPERLINK，传 content（URL）
    │   ├─ 图片查看类                      → UTD: JPEG/PNG，传 uri（文件路径）
    │   └─ 文件管理类                      → UTD: FILE/ARCHIVE，传 uri（文件路径）
    │
    ├─ 要发出（SEND）？
    │   ├─ 真"碰一碰"（knock 自动触发）  → 路径 A：ArkTS bridge + harmonyShare.on('knockShare')（K1-K4, K6）
    │   └─ 接受"分享面板"（discover）     → QtOhosExtras::shareDataWithShareKit（零 bridge，K5 C++ 等价）
    │
    └─ 要接收（RECEIVE）？
        ├─ module.json5 skills 已声明？    → K7 检查；无则补 ohos.want.action.sendData + file + UTD
        └─ C++ 取传入数据                  → K7 newWantReceived / K8 tryGetSharedRecordsFromShareKit
```

## Critical Rules

- **T1**: HarmonyOS 碰一碰 = `@kit.ShareKit` `harmonyShare.on('knockShare', cb)`, **NOT** Qt NFC (unavailable on OHOS). `QtOhosExtras::ShareKit` only covers the discover panel (`shareDataWithShareKit`); knock mode needs an ArkTS-side bridge. Construct `SharedData` by Qt app type: TEXT for text apps (content), HYPERLINK for link apps (content), JPEG/PNG/FILE for file/image apps (uri) — share app user content, not app/engine info.
- **T2**: `SharableTarget` is only valid inside the knock callback (JS main thread). `sharableTarget.share(...)` must be called inside the callback; C++ cannot hold `SharableTarget`, only pass app user content (text/URL/file path) via bridge.

## References

- Official HarmonyOS sample: `share-kit_-sample-code_-clientdemo_-arkts` (KnockShareApi.ets / TextScenario.ets / LinkScenario.ets / ImageScenario.ets / ZipScenario.ets / module.json5)
- BitFun bridge pattern: `src/apps/ohos/entry/src/main/ets/entryability/EntryAbility.ets` (registerArktsFunction bridge mode only, not sendOnlyCallback business logic)
