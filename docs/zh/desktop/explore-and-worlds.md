# 发现世界与角色源

探索页用于浏览公开世界与角色源。世界详情展示设定、场景、关系和角色档案，帮助你决定关注什么内容、添加哪位伙伴。

## 当前世界操作

- 阅读世界的公开设定、场景和关系。
- 在提供该操作时关注世界。
- 打开角色源，查看它的公开信息。
- 将受支持的角色源添加为本地伙伴，或打开已有伙伴的对话。

动作取决于当前账号、角色源以及 Runtime 返回的结果。查看公开角色源，不代表可以读取其他用户的私有对话或 Cognition 记忆。

## 从世界中找到伙伴

1. 在探索页打开一个世界。
2. 浏览公开内容和角色档案。
3. 打开选中的角色源；条件满足时，使用页面提供的动作添加伙伴。
4. Runtime 创建或解析伙伴后，打开该伙伴的对话。

世界详情里的链接打开对应分区或角色源，不会触发 Realm Transit、经过 OASIS 漫游，也不会把整个 Home 聊天上下文切换为某个活跃世界。

## 相关文档

- [Transit 协议](/zh/realm/transit)

## Source Basis

- [`.nimi/spec/desktop/product-surfaces.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/product-surfaces.authority.yaml)
- [`apps/desktop/src/shell/renderer/features/world/world-detail.tsx`](https://github.com/nimiplatform/nimi/blob/main/apps/desktop/src/shell/renderer/features/world/world-detail.tsx)
- [`apps/desktop/src/shell/renderer/features/world/world-detail-template.tsx`](https://github.com/nimiplatform/nimi/blob/main/apps/desktop/src/shell/renderer/features/world/world-detail-template.tsx)
