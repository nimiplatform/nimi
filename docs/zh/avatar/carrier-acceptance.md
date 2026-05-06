# 载体视觉接受度

**载体**是渲染形体化的宿主面。载体视觉接受度合同决定一个形体化能不能在某个载体上显示。它是「这个 Agent 能不能在这里显示」的准入闸口。

## 载体接受度决定什么

| 决定 | 结果 |
| --- | --- |
| 形体化符合载体类型化合同 | 准入并渲染 |
| 形体化超出载体合同 | 拒绝或回退到准入降级形态 |
| 形体化形状错 | 拒绝带类型化错误 |
| 形体化会违反载体策略 | 拒绝带类型化原因 |

载体**不**静默渲染半个版本。合同决定；结果是准入、回退、拒绝之一。

## 为什么载体来决定

如果形体化想往哪渲染就往哪渲染，给桌面端载体设计的高细节包可能撑爆受限的移动载体。给某个后端设计的包可能试图在另一个后端上渲染。

载体视觉接受度合同就是每个载体声明它能托管什么的地方。形体化要么合适要么不合适；平台让决定类型化。

## 阅读场景：受限载体上的重形体化

某用户装了一个动画很丰富的形体化包，试图在受限载体（比如低功耗设备）上看。

1. **载体声明合同。** 什么后端、什么动作复杂度 tier、什么资产大小限制。
2. **读形体化包。** 形体化包的声明要求。
3. **接受度检查。** 载体视觉接受度合同对比。
4. **决定：回退。** 完整形体化会超载体 tier；合同决定回退到准入降级形态（比如静态或简化呈现）。
5. **用户看到回退。** 带类型化原因 — 「你的设备不支持这个形体化的完整动作 tier」。

回退是被准入的；用户**不**会被静默半渲染惊讶。

## 阅读场景：载体拒绝后端不匹配

某形体化只支持 Live2D；载体只支持 VRM。

1. **接受度检查。** Live2D 形体化 vs 只 VRM 载体。
2. **拒。** 后端不匹配；未准入。
3. **类型化错误。** 「这个载体不支持 Live2D 后端」。
4. **没部分渲染。** 载体**不**试图把 Live2D 投到 VRM 空间。

后端的判别 union 让不匹配在任何渲染尝试之前就可检测。

## 阅读场景：Session 中途形体化更新

某创作者在用户看 Agent 时更新了形体化包。

1. **新形体化投递。** 可能通过准入更新流。
2. **载体重新评估。** 接受度合同检查新版本。
3. **如准入。** 载体在准入转换合同内平滑过渡。
4. **如不准入。** 载体保留之前版本；或搬到 `degraded:embodiment-incompatible` 状态。
5. **用户看到状态。** 要么是新形体化要么是类型化降级状态。

创作者的更新**不**静默打断用户的 session。

## 接受度**不**做什么

| 关注 | 为什么不 |
| --- | --- |
| 决定 Agent 身份 | 身份是规范化 Realm；载体接受视觉 |
| 改形体化包 | 载体读；包是创作者发布的 |
| 在准入 tier 之外渲染 | 合同限制是显式的 |

## 来源

- [`.nimi/spec/avatar/kernel/carrier-visual-acceptance-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/carrier-visual-acceptance-contract.md)
- [`.nimi/spec/avatar/kernel/embodiment-projection-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/embodiment-projection-contract.md)
- [`.nimi/spec/avatar/kernel/backend-branch-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/backend-branch-contract.md)
- [`.nimi/spec/avatar/kernel/app-shell-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/app-shell-contract.md)
- [`.nimi/spec/avatar/kernel/live2d-asset-compatibility-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/live2d-asset-compatibility-contract.md)
