---
id: semantic-qt-harmonyos-tap-to-share-code-patterns
type: semantic
domain: tech
tags: [qt, harmonyos, ohos, tap-to-share, knockshare, sharekit, harmonyshare, systemshare, code-patterns, before-after, bridge, napi, want, module-json5, utd, text, hyperlink, file, image]
created: 2026-09-07
updated: 2026-09-09
status: active
audience: public
refs: [semantic-qt-harmonyos-tap-to-share, semantic-qt-ohos-extras, semantic-qt-ohos-js-thread-gateway, semantic-qt-ohos-extras-examples, semantic-qt-harmonyos-project-structure]
summary: >
  碰一碰跨设备分享 8 组 Before/After 代码模式。SEND 侧 K1-K6（knock 监听器 / 回调内分享文本 /
  回调内分享链接 / 回调内分享图片文件 / discover 系统面板 / C++↔ArkTS bridge 暴露）；
  RECEIVE 侧 K7-K8（module.json5 skills + newWantReceived / tryGetSharedRecordsFromShareKit）。
  按 Qt 应用类型选 UTD（TEXT/HYPERLINK/JPEG/PNG/FILE/ARCHIVE）构造 SharedData。
  所有 API 引用华为官方示例工程 + BitFun bridge 模式 + TeXworks module.json5 行号，不臆造。
---

# 碰一碰跨设备分享代码模式（K1-K8）

> **每条都标注真实参考来源**（华为官方示例工程 `.ets` 行号 / BitFun `.ets` 行号 / TeXworks `module.json5` 行号）。`@kit.ShareKit` 官方 kit 文档为准。
> 机制与 UTD 决策见 [[qt-harmonyos-tap-to-share]]。ArkTS bridge 写法见 [[qt-ohos-js-thread-gateway]]。
> **核心**：knock 回调里都是 `sharableTarget.share(shareData)`，区别只在 `SharedData` 构造的 UTD + content/uri。传的是**应用内用户内容**，不是应用/工程信息。

## SEND 侧（碰一碰发出）

### K1 注册 knockShare 监听器（SEND，ArkTS）

**问题**：如何在 Qt OHOS 工程 ArkTS 胶水里注册碰一碰监听器？

**参考**：官方示例 `KnockShareApi.ets:319-336` / BitFun `EntryAbility.ets:798-815`

**Before**

```typescript
// 无任何监听器
```

**After**（ArkTS，在 `QAbility.ets` 或新增 `KnockShareService.ets`）

```typescript
import { harmonyShare } from '@kit.ShareKit';

private shareStatus: boolean = false;

// 开启碰一碰监听（C++ 经 K6 bridge 传入应用内用户内容后调用）
private shareListening(): void {
  if (!this.shareStatus) {
    harmonyShare.on('knockShare', this.knockCallback);  // 官方示例 KnockShareApi.ets:321
    this.shareStatus = true;
  }
}

private shareDisablingListening(): void {
  harmonyShare.off('knockShare', this.knockCallback);   // 官方示例 KnockShareApi.ets:334
  this.shareStatus = false;
}
```

> **关键**：这是 ArkTS 侧代码，不是 C++。Qt OHOS 模板（如 TeXworks `HarmonyOS/entry/src/main/ets/`）需新增此文件并在 `QAbility.ets` `onCreate` / `onWindowStageCreate` 调 `shareListening()`。官方示例还在 `aboutToAppear` 注册 `onFocus`/`onBackGround` 事件自动恢复/关闭监听（`KnockShareApi.ets:19-43`）。

---

### K2 knock 回调内分享文本（SEND，ArkTS + C++ 取值）

**问题**：碰一碰触发时如何把 Qt 应用内用户选中的文本发出？

**参考**：官方示例 `TextScenario.ets:16-22`（discover 文本 UTD 构造）+ `KnockShareApi.ets:307-317`（knock 回调 share 模式）

**C++ 侧取选中文本**（如 TeXworks `TWApp.cpp`，`#ifdef TW_BUILD_FOR_OHOS`）

```cpp
// QTextEdit/QPlainTextEdit 选中文本
QString selectedText = editor->textCursor().selectedText();
if (selectedText.isEmpty()) return;
// 经 K6 bridge 传给 ArkTS
```

**After**（ArkTS knock 回调，构造 TEXT UTD）

```typescript
import { harmonyShare, systemShare } from '@kit.ShareKit';
import { uniformTypeDescriptor as utd } from '@kit.ArkData';

// C++ 经 bridge 传入的选中文本（K6）
private pendingText: string = '';

private knockCallback = (sharableTarget: harmonyShare.SharableTarget): void => {
  if (this.pendingText.length > 0) {
    let shareData: systemShare.SharedData = new systemShare.SharedData({
      utd: utd.UniformDataType.TEXT,              // 官方示例 TextScenario.ets:17
      content: this.pendingText,                  // 官方示例 TextScenario.ets:18
      title: 'Text Content',                      // 官方示例 TextScenario.ets:19
      description: 'Text Description',            // 官方示例 TextScenario.ets:20
      thumbnail: new Uint8Array()                 // 官方示例 TextScenario.ets:21
    });
    sharableTarget.share(shareData);              // 官方示例 KnockShareApi.ets:316
  }
};
```

> **关键约束**：`SharableTarget` 仅在 knock 回调（JS 主线程）内有效，`sharableTarget.share(...)` 必须在回调内调用。C++ 侧只负责取选中文本经 bridge 传入 `pendingText`，不持有 `SharableTarget`。

---

### K3 knock 回调内分享链接（SEND，ArkTS + C++ 取值）

**问题**：碰一碰触发时如何把 Qt 应用内的 URL 链接发出？

**参考**：官方示例 `LinkScenario.ets:16-21`（discover 链接 UTD 构造）+ `KnockShareApi.ets:363-372`（knock 回调 share 链接模式）

**C++ 侧取 URL**（如浏览器类应用）

```cpp
// 当前页面 URL 或选中的超链接
QString url = currentUrl.toString();  // QUrl::toString()
// 经 K6 bridge 传给 ArkTS
```

**After**（ArkTS knock 回调，构造 HYPERLINK UTD）

```typescript
import { harmonyShare, systemShare } from '@kit.ShareKit';
import { uniformTypeDescriptor as utd } from '@kit.ArkData';

// C++ 经 bridge 传入的 URL（K6）
private pendingUrl: string = '';

private knockCallback = (sharableTarget: harmonyShare.SharableTarget): void => {
  if (this.pendingUrl.length > 0) {
    let shareData: systemShare.SharedData = new systemShare.SharedData({
      utd: utd.UniformDataType.HYPERLINK,         // 官方示例 LinkScenario.ets:17
      content: this.pendingUrl,                   // 官方示例 LinkScenario.ets:18
      title: 'Link Title',                        // 官方示例 LinkScenario.ets:19
      description: 'Link Description',            // 官方示例 LinkScenario.ets:20
    });
    sharableTarget.share(shareData);              // 官方示例 KnockShareApi.ets:372
  }
};
```

> 官方示例 `KnockShareApi.ets:363-378` 还演示了 `sharableTarget.updateShareData({ thumbnailUri })` 延迟更新缩略图（碰一碰后 3 秒更新预览图）——如需延迟更新预览可参考。

---

### K4 knock 回调内分享图片/文件（SEND，ArkTS + C++ 取值）

**问题**：碰一碰触发时如何把 Qt 应用内的图片或文件发出？

**参考**：官方示例 `ImageScenario.ets:21-28`（discover 图片 UTD）+ `ZipScenario.ets:21-28`（discover 文件 UTD）+ `KnockShareApi.ets:307-317`（knock 回调 share 图片模式）

**C++ 侧取文件路径**（如 TeXworks 当前打开的 .tex 文件）

```cpp
// 当前打开的文件路径
QString filePath = currentDocument->filePath();  // QFileInfo / QFile
// 经 K6 bridge 传给 ArkTS
```

**After**（ArkTS knock 回调，构造图片/文件 UTD）

```typescript
import { harmonyShare, systemShare } from '@kit.ShareKit';
import { uniformTypeDescriptor as utd } from '@kit.ArkData';
import { fileUri } from '@kit.CoreFileKit';

// C++ 经 bridge 传入的文件路径（K6）
private pendingFilePath: string = '';

private knockCallback = (sharableTarget: harmonyShare.SharableTarget): void => {
  if (this.pendingFilePath.length === 0) return;

  // 按扩展名解析 UTD（官方示例 ImageScenario.ets:21 / ZipScenario.ets:21）
  let ext = this.getExtension(this.pendingFilePath);
  let baseUtd = utd.UniformDataType.FILE;  // 默认文件
  if (ext === '.jpg' || ext === '.jpeg') baseUtd = utd.UniformDataType.IMAGE;
  else if (ext === '.png') baseUtd = utd.UniformDataType.IMAGE;
  else if (ext === '.zip') baseUtd = utd.UniformDataType.ARCHIVE;
  let utdTypeId = utd.getUniformDataTypeByFilenameExtension(ext, baseUtd);

  let fileUriStr = fileUri.getUriFromPath(this.pendingFilePath);  // 官方示例 ImageScenario.ets:25

  let shareData: systemShare.SharedData = new systemShare.SharedData({
    utd: utdTypeId,                                // 官方示例 ImageScenario.ets:24
    uri: fileUriStr,                               // 官方示例 ImageScenario.ets:25
    title: this.getFileName(this.pendingFilePath), // 官方示例 ImageScenario.ets:26
    description: 'File from Qt app',               // 官方示例 ImageScenario.ets:27
  });

  // 图片类可加缩略图（官方示例 KnockShareApi.ets:314）
  if (baseUtd === utd.UniformDataType.IMAGE) {
    shareData.thumbnailUri = fileUriStr;  // 官方示例 KnockShareApi.ets:314
  }

  sharableTarget.share(shareData);                // 官方示例 KnockShareApi.ets:316
};

private getExtension(path: string): string {
  let dot = path.lastIndexOf('.');
  return dot >= 0 ? path.slice(dot) : '';
}

private getFileName(path: string): string {
  let slash = path.lastIndexOf('/');
  return slash >= 0 ? path.slice(slash + 1) : path;
}
```

> **文件 URI 与 UTD 解析**详见 K5。

---

### K5 discover 模式系统面板（SEND，ArkTS + C++ 等价）

**问题**：不要碰一碰自动触发，要弹系统分享面板让用户选目标？

**参考（ArkTS）**：官方示例 `TextScenario.ets:24-34` / `ImageScenario.ets:30-39` / `LinkScenario.ets:23-33` / `ZipScenario.ets:30-39`

**After**（ArkTS discover 模式——以文本为例）

```typescript
import { systemShare } from '@kit.ShareKit';
import { uniformTypeDescriptor as utd } from '@kit.ArkData';
import { common } from '@kit.AbilityKit';

// 构造 SharedData（官方示例 TextScenario.ets:16-22）
let shareData: systemShare.SharedData = new systemShare.SharedData({
  utd: utd.UniformDataType.TEXT,
  content: 'This is a text.',
  title: 'Text Content',
  description: 'Text Description',
  thumbnail: new Uint8Array()
});

// 构造 Controller（官方示例 TextScenario.ets:24）
let controller: systemShare.ShareController = new systemShare.ShareController(shareData);

// 弹面板（官方示例 TextScenario.ets:27-34）
controller.show(context, {
  selectionMode: systemShare.SelectionMode.SINGLE,    // 官方示例 TextScenario.ets:28
  previewMode: systemShare.SharePreviewMode.DEFAULT,  // 官方示例 TextScenario.ets:29
}).then(() => {
  // 分享面板关闭
}).catch((error) => {
  // 失败
});
```

**C++ 等价（零 bridge fallback，QtOhosExtras）**

```cpp
#include <QtOhosExtras/qohossharekit.h>
#include <QtOhosExtras/qohosabilitycontext.h>

// 文本分享记录
auto textRecord = QtOhosExtras::ShareKit::createContentRecord(
    QMimeDatabase().mimeTypeForName("text/plain"),
    QStringLiteral("This is a text."));
textRecord->setTitle(QStringLiteral("Text Content"));

// URL 分享记录
auto urlRecord = QtOhosExtras::ShareKit::createUrlRecord(QUrl("https://example.com"));

auto ctx = QtOhosExtras::QOhosAbilityContext::getDefaultInstance();
ctx->shareDataWithShareKit({textRecord, urlRecord}, nullptr);
// 系统弹出分享面板，用户选择目标（含附近 HarmonyShare 设备）
```

> **关键**：`QtOhosExtras::shareDataWithShareKit` 是 **discover** 模式（用户主动选目标），**不是** knock（碰一碰自动触发）。用户要真"碰一碰"必须走 K1-K4 的 knock 监听器。详见 [[qt-ohos-extras]] §ShareKit。

---

### K6 C++↔ArkTS bridge 暴露（SEND 触发）

**问题**：Qt C++ 侧如何把应用内用户内容（选中文本/URL/文件路径）传给 ArkTS 并触发 knock 监听？

**参考（BitFun bridge 注册模式）**：`src/apps/ohos/entry/src/main/ets/entryability/EntryAbility.ets:755-774`（只参考 bridge 注册机制，不参考 `sendOnlyCallback` 业务逻辑）

**BitFun 原版**（用 `@ohos-rs/ability` 扩展注册 bridge）

```typescript
// EntryAbility.ets:755-774 — bridge 注册模式参考
RustModule.registerArktsFunction('share_file_ohos', async (err: Error, arg: string): Promise<string> => {
  const req = JSON.parse(arg);  // BitFun 传 { path, mode, ... }
  // ... 业务逻辑
});
```

**Qt OHOS 模板改写**（无 `RustAbility.registerArktsFunction`，需在 `OhosExportModules.ts` / `QAbilityStage.ets` 暴露全局函数）

```typescript
// 在 QAbilityStage.onCreate 或 OhosExportModules.ts 中暴露全局函数
// C++ 传入应用内用户内容（文本/URL/文件路径），按 type 设置 pending 数据并开监听
globalThis.__qtArmKnockShare = (jsonArg: string): void => {
  const req = JSON.parse(jsonArg);
  // req: { type: 'text'|'link'|'file'|'image', content?, path?, title?, description? }
  const service = KnockShareService.getInstance();
  if (req.type === 'text') {
    service.pendingText = req.content || '';
  } else if (req.type === 'link') {
    service.pendingUrl = req.content || '';
  } else if (req.type === 'file' || req.type === 'image') {
    service.pendingFilePath = req.path || '';
  }
  service.shareListening();  // 开 harmonyShare.on('knockShare', cb)（K1）
};
```

**C++ 侧调用**（如 TeXworks `TWApp.cpp` File 菜单"碰一碰分享"动作，`#ifdef TW_BUILD_FOR_OHOS`）

```cpp
#ifdef TW_BUILD_FOR_OHOS
#include <QtCore/private/qcore_ohos_p.h>  // 私有 API，见 qt-ohos-js-thread-gateway

void TWApp::armKnockShareText(const QString &selectedText) {
  const QJsonObject req = {
    {"type", "text"},
    {"content", selectedText},
    {"title", QFileInfo(m_currentFile).fileName()},
  };
  const QByteArray json = QJsonDocument(req).toJson(QJsonDocument::Compact);
  QOhosJsThreadGateway::invoke([&](QOhosJsState &js) {
    js.eval<void>(QStringLiteral("globalThis.__qtArmKnockShare('%1')")
                      .arg(QString::fromUtf8(json)));
  });
}

void TWApp::armKnockShareFile(const QString &filePath) {
  const QJsonObject req = {
    {"type", "file"},
    {"path", filePath},
    {"title", QFileInfo(filePath).fileName()},
  };
  const QByteArray json = QJsonDocument(req).toJson(QJsonDocument::Compact);
  QOhosJsThreadGateway::invoke([&](QOhosJsState &js) {
    js.eval<void>(QStringLiteral("globalThis.__qtArmKnockShare('%1')")
                      .arg(QString::fromUtf8(json)));
  });
}
#endif
```

> **关键**：Qt OHOS 模板**没有** BitFun 的 `RustAbility.registerArktsFunction`（那是 `@ohos-rs/ability` 扩展）。两种暴露方式：
> 1. 在 `OhosExportModules.ts` / `QAbilityStage.ets` 写等价 NAPI bridge 暴露全局函数（推荐，与 Qt OHOS 模板胶水一致）
> 2. 用 `QOhosJsThreadGateway::eval`（私有 API，见 [[qt-ohos-js-thread-gateway]]）直接调全局函数（路径 B，无兼容承诺）
>
> **具体 bridge 注册方式需按目标 Qt OHOS 模板版本核实**（Qt 5.12.12 / 5.15.16 模板的 `OhosExportModules.ts` 形态可能不同）。

---

## RECEIVE 侧（接收碰一碰/分享面板传入）

### K7 接收分享文件（RECEIVE，module.json5 + C++）

**问题**：如何让 Qt 应用被系统识别为碰一碰/分享面板的接收目标，并在 C++ 侧取传入文件？

**参考（module.json5 skills）**：官方示例 `module.json5:25-103` + TeXworks `D:\Desktop\texworks\texworks\HarmonyOS\entry\src\main\module.json5:50-76`（已就绪）

**Before**（module.json5 无 skills）

```json5
"abilities": [{
  "name": "QAbility",
  // ... 无 skills 数组
}]
```

**After**（module.json5 声明接收 skills —— 官方示例 + TeXworks 已就绪形态）

```json5
"abilities": [{
  "name": "QAbility",
  "skills": [{
    "actions": [
      "action.system.home",
      "ohos.want.action.sendData",      // ★ 接收分享/碰一碰
    ],
    "uris": [
      { "scheme": "file", "utd": "general.text", "maxFileSupported": 10 },  // .tex/.txt
      { "scheme": "file", "utd": "general.png",  "maxFileSupported": 10 },
      { "scheme": "file", "utd": "general.jpeg", "maxFileSupported": 10 },
    ]
  }],
  "continuable": true
}]
```

> **参考**：官方示例 `module.json5:65-78`（ShareUIAbility 声明 `ohos.want.action.sendData` + `file` + `general.text`）；TeXworks `module.json5:50-76` 已声明此形态。精确 `action`/`uri`/`utd` 值以目标 SDK API level 为准。官方示例还演示了多 Ability 按类型分流（`ShareUIAbility` 收 text、`SubShareUIAbility` 收 png、`ShareExtensionAbility` 收 jpeg）。

**C++ 侧取传入文件**（连接 `newWantReceived` 信号）

```cpp
#include <QtOhosExtras/qohosabilitycontext.h>
#include <QStandardPaths>

auto ctx = QtOhosExtras::QOhosAbilityContext::getDefaultInstance();
QObject::connect(ctx.get(),
    &QtOhosExtras::QOhosAbilityContext::newWantReceived,
    [](const QtOhosExtras::QOhosWant &want) {
        // want.uri 是文件 URI（file://...）
        const QString uri = want.uri;
        // 写沙箱可写目录后用应用打开（OHOS CWD 不可写）
        const QString destDir = QStandardPaths::writableLocation(
            QStandardPaths::AppLocalDataLocation);
        // ... 复制/打开逻辑
    });
```

> 详见 [[qt-ohos-extras]] §Want / WantInfo、[[qt-harmonyos-lifecycle]] §接续。

---

### K8 接收 ShareKit 记录（RECEIVE，C++）

**问题**：如何取通过 ShareKit 系统分享面板传入的分享记录？

**参考（QtOhosExtras API）**：[[qt-ohos-extras]] §WantInfo（`tryGetSharedRecordsFromShareKit` 已核实）

**After**（C++ 连接 `newWantInfoReceived` 信号）

```cpp
#include <QtOhosExtras/qohosabilitycontext.h>

auto ctx = QtOhosExtras::QOhosAbilityContext::getDefaultInstance();
QObject::connect(ctx.get(),
    &QtOhosExtras::QOhosAbilityContext::newWantInfoReceived,
    [](const QSharedPointer<QtOhosExtras::QOhosWantInfo> &wantInfo) {
        // 区分启动原因（StartAbility / Continuation / Preload）
        const auto reason = wantInfo->launchReason();
        if (reason != QtOhosExtras::QOhosWantInfo::LaunchReason::StartAbility)
            return;

        // 取 ShareKit 传入的分享记录
        const auto records = wantInfo->tryGetSharedRecordsFromShareKit();
        for (const auto &record : records) {
            // record->mimeType() / content() / filePath() / isUrlContent()
            // 按 mimeType 处理：text 插入编辑器，file 写沙箱后打开
        }
    });
```

> **参考**：`QOhosWantInfo::tryGetSharedRecordsFromShareKit()` / `launchReason()` 见 [[qt-ohos-extras]] §Want/WantInfo（源码核实，`qohoswant.h`）。`LaunchReason` 枚举：`Unknown / StartAbility / Continuation / PrepareContinuation / Preload`。

---

## 速查：SEND vs RECEIVE + UTD 类型对照

| 侧 | 模式 | UTD 类型 | 触发 | ArkTS | C++ |
|---|---|---|---|---|---|
| SEND | knock（碰一碰） | TEXT | 两设备 NFC 碰撞 | K1 监听 + K2 回调 share（content） | K6 bridge 传选中文本 |
| SEND | knock（碰一碰） | HYPERLINK | 同上 | K1 监听 + K3 回调 share（content） | K6 bridge 传 URL |
| SEND | knock（碰一碰） | JPEG/PNG/FILE | 同上 | K1 监听 + K4 回调 share（uri） | K6 bridge 传文件路径 |
| SEND | discover（分享面板） | 任一 | 用户点"分享" | K5 ShareController.show | K5 C++ `shareDataWithShareKit`（零 bridge） |
| RECEIVE | Want 路由 | general.text/png/jpeg | 系统分发 | K7 module.json5 skills | K7 `newWantReceived` / K8 `tryGetSharedRecordsFromShareKit` |

## 参考来源

| 来源 | 说明 |
|---|---|
| 📦 华为官方示例工程 | `share-kit_-sample-code_-clientdemo_-arkts/entry/src/main/ets/` — `KnockShareApi.ets:307-428`（knock 4 模式）、`KnockShareAttr.ets:126-138`（sendOnly）、`TextScenario.ets:16-22` / `LinkScenario.ets:16-21` / `ImageScenario.ets:21-28` / `ZipScenario.ets:21-28`（各 UTD 类型构造）、`module.json5:25-103`（RECEIVE skills） |
| 🛠️ BitFun 仓库 | `src/apps/ohos/entry/src/main/ets/entryability/EntryAbility.ets:755-774,798-815` — bridge 注册模式参考（`RustModule.registerArktsFunction`），不参考 `sendOnlyCallback` 业务逻辑 |
| 🛠️ TeXworks 工程 | `D:\Desktop\texworks\texworks\HarmonyOS\entry\src\main\module.json5:50-76` — RECEIVE skills 已就绪形态 |
| 🛠️ Qt 源码 | `qtohosextras/src/ohosextras/qohoswant.h` — `QOhosWantInfo::tryGetSharedRecordsFromShareKit` / `launchReason` |
| 📦 HarmonyOS 官方 kit | `@kit.ShareKit`（`harmonyShare` / `systemShare`）、`@kit.ArkData`（`uniformTypeDescriptor`）、`@kit.CoreFileKit`（`fileUri`） |

## 相关上下文

- [[qt-harmonyos-tap-to-share]] — 机制、UTD 类型速查表、收发区分、两路径决策、TeXworks 验证案例
- [[qt-ohos-extras]] — ShareKit discover 等价 `shareDataWithShareKit`、WantInfo `tryGetSharedRecordsFromShareKit`、`newWantReceived` 信号
- [[qt-ohos-js-thread-gateway]] — 路径 B `QOhosJsThreadGateway::eval` 私有 NAPI 桥接（含构建前置 `Qt5::CorePrivate` + `napi.h` + `ace_napi.z`）
- [[qt-ohos-extras-examples]] — wantfdssender/wantfdsreceiver 官方示例（文件 fd 传递）
- [[qt-harmonyos-project-structure]] — scenario 2 `HarmonyOS/` 目录、`module.json5`、`OhosExportModules.ts`
