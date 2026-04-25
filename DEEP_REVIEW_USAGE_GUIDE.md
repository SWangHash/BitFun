# Deep Review 使用说明

本文档记录当前 Deep Review 与代码审核团队的用户可见行为，适用于 BitFun 桌面端和共享前端维护。

## 入口

- 在聊天输入框中使用 `/DeepReview` 可以启动深度审查。
- 在审查按钮下拉框中可以选择普通审查或深度审查。
- 当当前会话已经处于普通审查或深度审查中时，下拉框会进入审查中状态，`/DeepReview` 命令也会被阻止，避免重复拉起审查任务。

## 首次确认

首次启动 Deep Review 时会展示确认弹窗，说明大致 token 消耗、执行时间和可能影响。用户可以勾选“下次不再提示”，该选项在浅色和深色主题下都需要保持可读。

## 代码审核团队

Deep Review 使用内置代码审核团队执行并行审查。默认团队包含业务逻辑、性能、安全和质量把关角色，用户可在“专业智能体 > 代码审核团队”中调整审查策略、模型和可选成员。

审查策略分为快速、正常、深度三档：

| 档位 | 适用场景 | 影响 |
| --- | --- | --- |
| 快速 | 小范围、低风险变更 | 更快、更省 token，但覆盖面较窄 |
| 正常 | 日常代码变更 | 默认档位，平衡耗时、token 和质量 |
| 深度 | 高风险或发布前变更 | 覆盖面更广，耗时和 token 消耗更高 |

如果某位审查员使用显式指定模型，则策略不会覆盖该选择；如果使用 primary/fast 类配置模型且配置被移除，应回退到该审查员默认模型。

## 执行状态

- 审查进行中时，左侧会话列表显示“审查中”。
- 审查页面应提供明确的中止入口。
- 用户停止审查后，前端需要立即收敛对应会话的执行状态，避免聊天页继续显示深度审查中。
- 子审查员事件必须正确关联到父审查任务；前端需要兼容后端 `subagent_parent_info` 与前端 `subagentParentInfo` 两种字段形式。

## 修复计划

Deep Review 默认先读后写。报告完成后，修复计划由用户确认：

- 修复项支持多选。
- 默认勾选中高优先级或建议修复的问题。
- 未选择任何修复项时，开始修复和修复后再次审查按钮不可用。
- 每个修复项默认折叠，可展开查看更详细描述。
- 存档计划入口已移除，避免把用户决策分散到低频路径。

## 测试覆盖

关键行为由以下前端测试保护：

- `src/web-ui/src/app/scenes/agents/AgentsScene.test.tsx`：防止代码审核团队详情页布局回退为空白页。
- `src/web-ui/src/app/scenes/agents/components/ReviewTeamPage.test.tsx`：保护代码审核团队配置页基础渲染。
- `src/web-ui/src/flow_chat/utils/deepReviewCommandGuard.test.ts`：保护 `/DeepReview` 在审查进行中被阻止。
- `src/web-ui/src/flow_chat/utils/reviewSessionStop.test.ts`：保护停止审查后的本地状态收敛。
- `src/web-ui/src/flow_chat/services/flow-chat-manager/EventHandlerModule.test.ts`：保护子审查员事件能挂回父审查任务。
- `src/web-ui/src/flow_chat/utils/sessionReviewActivity.test.ts`：保护会话审查中状态识别。

变更 Deep Review 前端行为时，至少运行：

```bash
pnpm run lint:web
pnpm run type-check:web
pnpm --dir src/web-ui run test:run
node scripts/i18n-audit.mjs
```

如修改 Rust 策略、提示词或工具实现，还需要运行：

```bash
cargo test -p bitfun-core deep_review -- --nocapture
```
