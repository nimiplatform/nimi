# Transit 跨世界协议

Transit 定义参与者在世界之间移动时的准入规则、身份连续性与最终转场结果，其权威语义归属于 Realm。平台契约以 OASIS 为中枢组织跨世界路径：源世界 → OASIS → 目标世界。

## 协议核心职责

- Realm 负责解析参与者身份、源世界与目标世界，并校验对应的准入条件。
- OASIS 是平台契约规定的中枢中转与回归点，不可由应用的私有世界替代。
- 目标世界的局部规则不会派生新的全局身份，亦不授予应用绕过 Realm 校验的特权。
- 转场结果与失败原因均以 Realm 签发的正式状态为准，不可仅凭本地路由切换或客户端缓存推断转场成功。

## 当前 Home 世界入口说明

Home 界面中的“探索”与“世界详情”主要用于浏览公开设定、场景、社交关系与角色档案，支持关注世界、查看角色来源、添加伙伴或开启与已有伙伴的对话。当前入口不会提交 Transit 转场请求，不会在点击分区链接时经由 OASIS 漫游，也不会更改整个 Home 的当前活跃世界上下文。

如需完成当前发现与探索任务，请参阅[探索世界与角色源](/zh/desktop/explore-and-worlds)。请勿将底层的 Transit 协议流程序列误认为是当前 Home 界面中的“进入世界”操作指引。

## 相关文档

- [OASIS](/zh/platform/worlds/oasis)
- [六大基础协议](/zh/reference/six-primitives)

## Source Basis

- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`apps/desktop/src/shell/renderer/features/world/world-detail.tsx`](https://github.com/nimiplatform/nimi/blob/main/apps/desktop/src/shell/renderer/features/world/world-detail.tsx)
- [`apps/desktop/src/shell/renderer/features/world/world-detail-template.tsx`](https://github.com/nimiplatform/nimi/blob/main/apps/desktop/src/shell/renderer/features/world/world-detail-template.tsx)
