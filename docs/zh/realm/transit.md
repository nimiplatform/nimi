# Transit 跨世界协议

Transit 定义参与者在世界之间移动时的准入、身份连续性与结果，由 Realm 拥有。平台契约以 OASIS 为中枢组织跨世界路径：源世界 → OASIS → 目标世界。

## 协议中的职责

- Realm 解析参与者身份、源世界和目标世界，并验证对应的准入条件。
- OASIS 是协议规定的中枢与回归点，不能由 App 私有世界替代。
- 目标世界的局部规则不创建新的全局身份，也不授予 App 越过 Realm 校验的权限。
- 转场结果与失败原因以 Realm 的正式结果为准，不能从本地路由或缓存推断成功。

## 当前 Home 世界入口

Home 的探索与世界详情用于阅读公开设定、场景、关系和角色档案，以及关注世界、查看角色源、添加伙伴或打开已有伙伴的对话。当前入口不提交 Transit 请求，不会因点击世界分区链接自动经 OASIS 漫游，也不会切换整个 Home 的活跃世界上下文。

需要完成当前发现任务时，按照[探索世界与角色源](/zh/desktop/explore-and-worlds)的步骤操作。不要把协议流程当作当前 Home 的“进入世界”按钮说明。

## 相关文档

- [OASIS](/zh/platform/worlds/oasis)
- [六大基础协议](/zh/reference/six-primitives)

## Source Basis

- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`apps/desktop/src/shell/renderer/features/world/world-detail.tsx`](https://github.com/nimiplatform/nimi/blob/main/apps/desktop/src/shell/renderer/features/world/world-detail.tsx)
- [`apps/desktop/src/shell/renderer/features/world/world-detail-template.tsx`](https://github.com/nimiplatform/nimi/blob/main/apps/desktop/src/shell/renderer/features/world/world-detail-template.tsx)
