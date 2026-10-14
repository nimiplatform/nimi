# 发现世界与数字角色

在 Nimi Home 的「探索」模块中，你可以漫游创作者构建的各类数字世界，了解其中的世界观与法则设定，结识生活在这些世界里的数字角色（Character），并在满足条件时将他们添加为本机运行的个人伙伴（LocalAgent）。

---

## 探索世界的核心体验

1. **浏览公开世界**
   - 漫游不同题材与风格的虚拟设定——从奇幻群岛、赛博朋克都市到宁静的心灵栖息地。
   - 查看世界的权威设定、运行规则、地理标志以及角色之间的关系网络。
2. **结识原住角色**
   - 查看每个角色的公开档案，包括性格特征、背景故事与独特的对话语气。
   - 角色设定来自 Realm 中的公开源记录，来源清晰可查。
3. **添加为个人伙伴 (LocalAgent)**
   - 遇到心仪的角色且当前账号与角色来源满足条件时，可通过页面操作将其添加为伙伴。
   - 本地 Runtime 会依据该角色的源定义，在你的设备上初始化一个专属的 **LocalAgent**。
   - 该 LocalAgent 拥有独立的对话线程与可选记忆；若选用云端推理，相关上下文会发送至所选服务商。

---

## 隐私与交互边界

- **公开设定与私人记忆隔离**：浏览公开角色资料时，绝不会暴露其他用户与该角色的私人对话或个人记忆。
- **浏览与当前会话解耦**：在探索页浏览世界和地标属于只读体验，不会打断或覆盖你在 Nimi Home 中正在进行的聊天上下文。

## 延伸阅读

- [Realm 权威边界与世界状态](/zh/realm/truth)
- [跨世界漫游协议 (Transit)](/zh/realm/transit)
- [开发 Nimi App](/zh/start/)

## Source Basis

- [`.nimi/spec/desktop/product-surfaces.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/product-surfaces.authority.yaml)
- [`apps/desktop/src/shell/renderer/features/world/world-detail.tsx`](https://github.com/nimiplatform/nimi/blob/main/apps/desktop/src/shell/renderer/features/world/world-detail.tsx)
