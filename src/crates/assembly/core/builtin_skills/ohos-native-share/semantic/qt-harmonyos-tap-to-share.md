---
id: semantic-qt-harmonyos-tap-to-share
type: semantic
domain: tech
tags: [qt, harmonyos, ohos, tap-to-share, knockshare, yipengchuan, sharekit, harmonyshare, systemshare, cross-device, nfc-unavailable, send, receive, utd]
created: 2026-09-07
updated: 2026-09-09
status: active
audience: public
refs: [semantic-qt-ohos-extras, semantic-qt-ohos-js-thread-gateway, semantic-qt-harmonyos-tap-to-share-code-patterns, semantic-qt-harmonyos-lifecycle, semantic-qt-harmonyos-project-structure]
summary: >
  HarmonyOS"碰一碰/一碰传"应用层 = @kit.ShareKit 的 harmonyShare.on('knockShare', cb)，
  不是 Qt NFC（OHOS 不可用）也不是 @ohos.nfc。系统底层 NFC 由 OS 处理，应用只做 arm 数据 +
  在 knock 回调里 sharableTable.share(sharedData)。按 Qt 应用类型选择 UTD（TEXT/HYPERLINK/JPEG/PNG/FILE/ARCHIVE）
  构造 SharedData——文本类传 content、文件/图片类传 uri。收发两侧：SEND 靠 ArkTS 注册 knockShare 监听器
  （QtOhosExtras::ShareKit 仅 discover 系统面板，未暴露 knock 监听器 → Qt 应用必须在 ArkTS 胶水写
  bridge）；RECEIVE 靠 module.json5 skills 声明 ohos.want.action.sendData + newWantReceived 信号
  / tryGetSharedRecordsFromShareKit。参考官方示例工程 + BitFun bridge 模式。Qt5 公开 API；Qt6 QtOhosExtras 私有化。
---

# Qt for HarmonyOS 碰一碰（knockShare）跨设备分享

## 核心结论（先读这段）

HarmonyOS"碰一碰 / 一碰传"在**应用层**通过 `@kit.ShareKit` 的 `harmonyShare.on('knockShare', cb)` 实现：

- **不是** Qt NFC 模块（OHOS 不可用，见 [[episodic/postmortems/qt-opensource-apps-harmonyos-survey|Qt 开源应用鸿蒙化调研]]）
- **不是** 直接调 `@ohos.nfc.*`
- 系统底层 NFC 由 OS 处理；应用只做两件事：
  1. **准备要分享的数据**（应用内用户的文本/链接/文件，按 UTD 类型构造 `SharedData`）
  2. **在 knock 回调里调 `sharableTable.share(sharedData)`**

> **权威参考**：本页 API 与代码模式参考华为官方示例工程 `share-kit_-sample-code_-clientdemo_-arkts`（`KnockShareApi.ets` / `TextScenario.ets` / `LinkScenario.ets` / `ImageScenario.ets` / `ZipScenario.ets` / `module.json5`）。Bridge 注册机制参考 BitFun 仓库 `src/apps/ohos/entry/src/main/ets/entryability/EntryAbility.ets` 的 `RustModule.registerArktsFunction` 模式（不参考其 `sendOnlyCallback` 业务逻辑）。`@kit.ShareKit` 官方 kit 文档为准。

## UTD 类型 → Qt 应用类型速查表（核心）

碰一碰 knock 回调里都是 `sharableTarget.share(shareData)`，**区别只在 `SharedData` 构造的 UTD + content/uri**。按 Qt 应用类型选择：

| Qt 应用类型 | UTD 枚举 | `SharedData` 关键字段 | Qt C++ 取值方式 | 官方示例参考 |
|---|---|---|---|---|
| **文本类**（TeXworks 选中文本、记事本） | `UniformDataType.TEXT` | `content`（文本字符串）+ `title` + `description` + `thumbnail: new Uint8Array()` | `QTextEdit::textCursor().selectedText()` | `TextScenario.ets:16-22` |
| **链接类**（浏览器、PDF 超链接） | `UniformDataType.HYPERLINK` | `content`（URL 字符串）+ `title` + `description` | `QUrl::toString()` / `QDesktopServices` | `LinkScenario.ets:16-21` |
| **图片类**（图片查看器、截图工具） | `getUniformDataTypeByFilenameExtension('.jpg', IMAGE)` 或 `JPEG`/`PNG` | `uri`（file URI）+ `thumbnailUri` + `title` + `description` | `QFileInfo(filePath)` + 扩展名 | `ImageScenario.ets:21-28` + `KnockShareApi.ets:307-317` |
| **文件类**（TeXworks 传 .tex、文件管理器） | `getUniformDataTypeByFilenameExtension('.tex', FILE)` 或 `FILE`/`ARCHIVE` | `uri`（file URI）+ `title` + `description` | `QFileInfo(curFile)` + 扩展名 | `ZipScenario.ets:21-28` |

> **关键**：knock 回调里**直接根据 Qt 应用当前上下文构造 `SharedData`**——用户选中的文本、当前打开的文件路径、当前查看的图片路径。不要传"应用/工程信息"，要传"应用内用户内容"。

## HarmonyOS"碰一碰"应用层 API 表

| API | 用途 | 来源（已核实） |
|---|---|---|
| `harmonyShare.on('knockShare', cb)` | 注册碰一碰监听器 | 官方示例 `KnockShareApi.ets:321` / BitFun `EntryAbility.ets:808` |
| `harmonyShare.off('knockShare', cb)` | 注销监听器 | 官方示例 `KnockShareApi.ets:334` / BitFun `EntryAbility.ets:813` |
| 回调签名 `(sharableTarget: harmonyShare.SharableTarget) => void` | 碰一碰触发时的回调 | 官方示例 `KnockShareApi.ets:307` / BitFun `EntryAbility.ets:816` |
| `sharableTarget.share(shareData)` | 在回调内把数据发出 | 官方示例 `KnockShareApi.ets:316` / BitFun `EntryAbility.ets:825` |
| `new systemShare.SharedData({ utd, uri, content, title, description, thumbnail, thumbnailUri })` | 构造分享记录（文本/链接用 content，文件/图片用 uri） | 官方示例 `TextScenario.ets:16` / `LinkScenario.ets:16` / `ImageScenario.ets:23` / `ZipScenario.ets:23` |
| `new systemShare.ShareController(shareData)` + `.show(ctx, {previewMode, selectionMode})` + `.on/.off('dismiss', cb)` | discover 模式系统分享面板 | 官方示例 `TextScenario.ets:24-34` / BitFun `FileShareService.ets:186,212,226` |
| `uniformTypeDescriptor.UniformDataType.TEXT` | 纯文本 UTD | 官方示例 `TextScenario.ets:17` |
| `uniformTypeDescriptor.UniformDataType.HYPERLINK` | 链接 UTD | 官方示例 `LinkScenario.ets:17` / BitFun `EntryAbility.ets:835` |
| `uniformTypeDescriptor.UniformDataType.JPEG` / `.PNG` | 图片 UTD | 官方示例 `KnockShareApi.ets:312` |
| `uniformTypeDescriptor.UniformDataType.IMAGE` / `.FILE` / `.ARCHIVE` | 图片/文件/压缩包 UTD 基类 | 官方示例 `ImageScenario.ets:21` / `ZipScenario.ets:21` / BitFun `FileShareService.ets:284` |
| `utd.getUniformDataTypeByFilenameExtension(ext, baseUtd)` | 按扩展名解析 UTD | 官方示例 `ImageScenario.ets:21` / `ZipScenario.ets:21` / BitFun `FileShareService.ets:287` |
| `fileUri.getUriFromPath(path)` | 文件路径转 URI | 官方示例 `ImageScenario.ets:25` / BitFun `FileShareService.ets:269` |
| `sharableTarget.updateShareData({...})` | knock 回调内延迟更新分享数据（如缩略图） | 官方示例 `KnockShareApi.ets:375` |
| `sharableTarget.reject(errorCode)` | knock 回调内拒绝分享 | 官方示例 `KnockShareApi.ets:340` |
| `sharableTarget.clarifyNonShare({ message })` | knock 回调内提示不支持分享 | 官方示例 `KnockShareApi.ets:402` |

> 上述 API 均来自 `@kit.ShareKit`（`harmonyShare` / `systemShare`）、`@kit.ArkData`（`uniformTypeDescriptor`）、`@kit.CoreFileKit`（`fileUri`）。

## 两种模式：knock vs discover

| 模式 | 触发方式 | UI | 应用层 API |
|---|---|---|---|
| **knock**（碰一碰） | 两台设备 NFC 物理触碰 | 无面板，自动发出 | `harmonyShare.on('knockShare', cb)` + `sharableTarget.share(data)` |
| **discover**（分享面板） | 用户主动点"分享" | 系统弹出面板，用户选目标（含附近 HarmonyShare 设备） | `new systemShare.ShareController(data)` + `.show(ctx, opts)` |

> **关键**：用户说"碰一碰"通常指 **knock** 模式。discover 是"系统分享面板"，可作零 bridge 的简化 fallback（Qt C++ 可直接用 `QtOhosExtras::QOhosAbilityContext::shareDataWithShareKit`），但**不是**自动碰一碰。

## 收发两侧（必须区分）

| 侧 | 机制 | Qt 侧落点 |
|---|---|---|
| **SEND（碰一碰发出）** | ArkTS 注册 `harmonyShare.on('knockShare', cb)`，回调内按 UTD 类型构造 `SharedData` 并 `share()` | Qt C++ 经 bridge 把应用内用户内容（选中文本/URL/文件路径）传给 ArkTS |
| **RECEIVE（接收碰一碰/分享面板传入）** | `module.json5` skills 声明 `ohos.want.action.sendData` + `file` scheme + UTD | C++ 连接 `QOhosAbilityContext::newWantReceived` 信号 / `QOhosWantInfo::tryGetSharedRecordsFromShareKit()` |

### RECEIVE 侧（接收）— 已有 Qt 公开 API

声明 `module.json5` skills 后，系统把碰一碰/分享面板收到的 Want 路由到本 Ability：

- C++ 信号：`QOhosAbilityContext::newWantReceived(QOhosWant)` / `newWantInfoReceived(QSharedPointer<QOhosWantInfo>)`（已核实，见 [[qt-ohos-extras]] §WantInfo）
- `QOhosWantInfo::tryGetSharedRecordsFromShareKit()` 取 ShareKit 传入的分享记录
- `QOhosWantInfo::launchReason()` 区分 `StartAbility / Continuation / PrepareContinuation / Preload`
- 文件类从 `want.uri` / `want.parameters` / `want.fds` 取，写沙箱可写目录后打开

详见 [[qt-harmonyos-tap-to-share-code-patterns]] §K7 / K8。

### SEND 侧（碰一碰发出）— Qt 集成两路径

> **难点**：`QtOhosExtras::ShareKit`（`QOhosAbilityContext::shareDataWithShareKit`）仅覆盖 **discover** 系统面板，**未暴露** `harmonyShare.on('knockShare')` 监听器。Qt C++ 应用要实现 knock 模式必须在 ArkTS 侧写 bridge。

#### 路径 A（推荐）：ArkTS 侧 bridge，参考 BitFun bridge 注册模式

在 Qt OHOS 模板的 ArkTS 胶水中（如 TeXworks 的 `HarmonyOS/entry/src/main/ets/`）：

1. 新增 `services/KnockShareService.ets` —— 注册 `harmonyShare.on('knockShare', cb)`，回调内按 UTD 类型构造 `SharedData`（参考官方示例 `KnockShareApi.ets:307-317` 的 purityCallback 模式）
2. 在 `QAbility.ets` `onCreate` / `onWindowStageCreate` 初始化
3. 在 `OhosExportModules.ts` 或 `QAbilityStage.onCreate` 暴露全局函数（如 `globalThis.__qtArmKnockShare = (jsonArg) => {...}`），C++ 经此 bridge 传入应用内用户内容（选中文本/URL/文件路径）+ 开 `harmonyShare.on('knockShare', cb)`

C++ 侧（如 TeXworks `TWApp.cpp` File 菜单"碰一碰分享"动作，`#ifdef TW_BUILD_FOR_OHOS`）：通过 NAPI 调该 bridge 函数（或经 `QOhosJsThreadGateway::eval` 触发已注册全局函数），传 JSON `{type: 'text'|'link'|'file'|'image', content?, path?, title?, description?}`，**不直接碰 `SharableTarget`**。

- **优点**：`SharableTarget` 生命周期与回调留在 ArkTS（安全）；bridge 注册参考 BitFun `RustModule.registerArktsFunction` 模式
- **缺点**：需改 Qt OHOS 模板 ArkTS 胶水（增加一个 .ets 文件 + 在 `OhosExportModules.ts` / `QAbilityStage.ets` 注册 bridge）；C++ 调用要么用私有 `QOhosJsThreadGateway`，要么写自定义 NAPI 模块

#### 路径 B（高级/私有）：C++ 直接经 `QOhosJsThreadGateway` 注册监听

用 `QOhosJsThreadGateway::runAndWait` / `eval`（见 [[qt-ohos-js-thread-gateway]]）在 JS 线程执行 `harmonyShare.on('knockShare', cb)`，cb 内构造 `systemShare.SharedData` 并调 `sharableTarget.share(...)`。

- **风险**：`QOhosJsThreadGateway` 是 `QtCore/private/qcore_ohos_p.h` 私有 API，**无兼容承诺**；回调注册需 NAPI tsfn（参考 [[episodic/postmortems/quit-deadlock-tsfn|quit-deadlock-tsfn]] 退出路径死坑）；构建前置含 `Qt5::CorePrivate` + `node-addon-api/napi.h` + 链接 `ace_napi.z`（见 [[qt-ohos-js-thread-gateway]] §构建前置条件）
- 仅作为高级备选，标注私有 API 风险

## discover 简化 fallback（零 bridge，但非真碰一碰）

Qt C++ 可直接用 `QtOhosExtras::QOhosAbilityContext::shareDataWithShareKit(records, options)`（已核实，见 [[qt-ohos-extras]] §ShareKit）触发系统分享面板，等价 ArkTS `systemShare.ShareController.show()`，面板内含跨设备 HarmonyShare 目标。

- **注意**：这是 **discover** 模式（用户主动选目标），**不是** knock（碰一碰自动触发）。用户要"碰一碰"必须走路径 A/B 的 knock 监听器。discover 可作为零 bridge 的简化方案，当用户接受"分享面板"而非"碰一碰"语义时使用。

## 关键约束

1. **Qt NFC 不可用**（`QNearFieldManager` / `QNdefMessage` 在 OHOS 不可用）→ 碰一碰走 `@kit.ShareKit`，不走 Qt NFC
2. **QtOhosExtras::ShareKit 仅 discover**（`shareDataWithShareKit`），**无 knockShare 监听器** → knock 模式必须 ArkTS bridge
3. **`SharableTarget` 仅 JS 主线程有效**（双线程模型，见 [[qt-ohos-js-thread-gateway]]）→ `sharableTarget.share(shareData)` 必须在 knock 回调内调用；C++ 不可持有 `SharableTarget`，只能经 bridge 传入应用内用户内容（文本/URL/文件路径），ArkTS 回调内构造 `SharedData`
4. **按 Qt 应用类型选 UTD** → 文本类用 `TEXT` + `content`；链接类用 `HYPERLINK` + `content`；图片/文件类用 `getUniformDataTypeByFilenameExtension` + `uri`。传的是**应用内用户内容**，不是应用/工程信息
5. **Qt OHOS 模板无 `RustAbility.registerArktsFunction`**（那是 BitFun 的 `@ohos-rs/ability` 扩展）→ 需在 `OhosExportModules.ts` / `QAbilityStage.ets` 写等价 bridge 暴露全局函数，或用 `QOhosJsThreadGateway::eval` 调全局函数（路径 B）
6. **RECEIVE 侧靠 module.json5 skills** → 声明 `ohos.want.action.sendData` + `file` scheme + UTD 后系统才路由 Want 到本 Ability
7. **沙箱可写路径** → 接收文件须写 `QStandardPaths::writableLocation(AppLocalDataLocation)`，不可写 CWD（OHOS CWD 不可写）

## TeXworks 工程验证案例（Qt5.12 scenario-2）

已用 `D:\Desktop\texworks\texworks`（Qt 5.12.12-ohos，scenario 2）验证思路：

| 侧 | 状态 | 依据 |
|---|---|---|
| **RECEIVE（接收）** | ✅ 已就绪 | `HarmonyOS/entry/src/main/module.json5:50-76` 已声明 `skills`: `ohos.want.action.sendData` + `file` scheme + `general.text` / `general.png` / `general.jpeg` UTD + `continuable: true` |
| **SEND（碰一碰发出）** | ❌ 缺口 | ArkTS 胶水无 `@kit.ShareKit` 导入、无 `harmonyShare.on('knockShare')` 监听器；C++ 无分享触发点 |
| **C++↔ArkTS bridge** | ❌ 缺口 | Qt OHOS 模板无 `RustAbility.registerArktsFunction`，需在 `OhosExportModules.ts` / `QAbilityStage.ets` 写等价 bridge |

- `src/CMakeLists.txt` 与 `src/TWApp.cpp` 已有 `#ifdef TW_BUILD_FOR_OHOS` 钩子（`TWApp.cpp:136,943,955,966,976,986,1094`）
- ArkTS 胶水：`QAbility.ets`（thin UIAbility，全委托 `qpa`=`libqohos.so`）、`OhosExportModules.ts`、`QAbilityStage.ets`、`QtUtils.ets`、`common/QtAppConstants.ets`
- CMake 选项：`-DCMAKE_PREFIX_PATH=C:\qt\qt-5.12.12-ohos -DQT_DEFAULT_MAJOR_VERSION=5 -DTW_BUILD_FOR_OHOS=ON`

落地步骤（用户自行实施）：按 [[qt-harmonyos-tap-to-share-code-patterns]] K1-K8 在 ArkTS 加 `KnockShareService.ets` + bridge，在 `TWApp.cpp` File 菜单加"碰一碰分享"动作（`#ifdef TW_BUILD_FOR_OHOS`）调 bridge，传 Qt 应用内用户内容（选中文本/当前文件路径）。

## 快速决策流

```
收到"碰一碰/一碰传"任务
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

## Qt6 差异

本页所有 `QtOhosExtras` API 为 Qt5 公开 API。Qt6 中 `QtOhosExtras` 模块不再独立、API 私有化（`_p.h`），无公开等价物（见 [[qt-harmonyos-qt6-status]]）。路径 A 的 ArkTS bridge 部分不依赖 QtOhosExtras（纯 ArkTS + `@kit.ShareKit`），Qt6 仍可用；路径 B 的 `QOhosJsThreadGateway` 同样是私有 API，Qt6 风险一致。

## 参考来源

| 来源 | 说明 |
|---|---|
| 📦 华为官方示例工程 | `share-kit_-sample-code_-clientdemo_-arkts` — `KnockShareApi.ets`（knock 4 模式：purity/reject/update/nonShare）、`KnockShareAttr.ets`（sendOnly）、`TextScenario.ets` / `LinkScenario.ets` / `ImageScenario.ets` / `ZipScenario.ets`（discover 各 UTD 类型）、`module.json5`（RECEIVE skills 声明） |
| 🛠️ BitFun 仓库 | `src/apps/ohos/entry/src/main/ets/entryability/EntryAbility.ets` — bridge 注册模式参考（`RustModule.registerArktsFunction('share_file_ohos', ...)`），不参考 `sendOnlyCallback` 业务逻辑 |
| 📦 HarmonyOS 官方 kit | `@kit.ShareKit`（`harmonyShare` / `systemShare`）— 官方 kit 文档为准 |
| 📦 HarmonyOS 官方 kit | `@kit.ArkData`（`uniformTypeDescriptor`）、`@kit.CoreFileKit`（`fileUri`） |
| 🛠️ TeXworks 工程 | `D:\Desktop\texworks\texworks` — Qt5.12 scenario-2 已迁移工程，RECEIVE skills 已就绪验证 |

## 相关上下文

- [[qt-ohos-extras]] — QtOhosExtras 公开 API（ShareKit discover 等价 `shareDataWithShareKit`、WantInfo `tryGetSharedRecordsFromShareKit`、`newWantReceived` 信号）
- [[qt-ohos-js-thread-gateway]] — Qt↔ArkTS 私有 NAPI 桥接；路径 B 的 `eval` / `evalWithPromise`
- [[qt-harmonyos-tap-to-share-code-patterns]] — K1-K8 Before/After 代码模式
- [[qt-harmonyos-lifecycle]] — `newWantReceived` / `tryGetOnContinueData` / `launchReason`
- [[qt-harmonyos-project-structure]] — scenario 2（已有工程鸿蒙化）`HarmonyOS/` 目录、`module.json5`、`OhosExportModules.ts`
- [[episodic/postmortems/qt-opensource-apps-harmonyos-survey|Qt 开源应用鸿蒙化调研]] — Qt NFC 模块 OHOS 不可用
