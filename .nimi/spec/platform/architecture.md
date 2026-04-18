# Platform Architecture

> Domain: Platform / Architecture

## 0. Normative Imports

| Kernel Location | Rule IDs |
|---|---|
| `kernel/architecture-contract.md` | P-ARCH-001–030 |
| `kernel/protocol-contract.md` | P-PROTO-002, P-PROTO-003, P-PROTO-010, P-PROTO-011, P-PROTO-020 |

## 1. 文档定位

本文件是平台架构导引。六层执行职责、通信边界、执行栈冻结与凭证平面以 kernel 为权威；`nimi-cognition` 的独立 authority placement 同样由 kernel 约束。domain 文档只提供阅读路径和跨域关系图。

它同时承担 public canonical 的 cross-repo upper-layer entrypoint：

- public platform/runtime/sdk/desktop/cognition read path 在当前 repo
- private realm / backend / dashboard / creator-side authority 留在
  `nimi-realm/.nimi/spec/**`
- nested but independent mods authority 留在 `nimi-mods/spec/**`

## 2. 核心阅读顺序

1. `kernel/architecture-contract.md`：先确认 P-ARCH-001、P-ARCH-002、P-ARCH-010、P-ARCH-011、P-ARCH-020。
2. `kernel/protocol-contract.md`：再确认 P-PROTO-003、P-PROTO-010、P-PROTO-011、P-PROTO-020 的封装、primitive layer 与授权语义。
3. `.nimi/spec/realm/README.md`：确认 public realm semantic persistence read path。
4. `.nimi/spec/runtime/kernel/index.md` 与 `.nimi/spec/sdk/kernel/index.md`：最后落到实现侧契约层。

## 2.5 Cross-Repo Read Path

- public canonical entrypoint：`nimi/.nimi/spec/**`
- private realm / backend / creator-side authority：
  `nimi-realm/.nimi/spec/**`
- mods workspace authority：`nimi-mods/spec/**`

上层总图只负责 topology / authority framing，不会把 private realm 或
`nimi-mods` 的 owner contract 静默吸回 platform 文本。

## 3. 跨层关系

```
mods <-> desktop       : in-process hook runtime
desktop -> nimi-sdk    : unified developer surface
desktop -> nimi-runtime: gRPC runtime access
nimi-apps -> nimi-realm: REST + WS realm access
nimi-runtime <-> nimi-cognition: runtime bridge / consume overlap (authority remains cognition)
```

- Runtime 职责边界见 P-ARCH-004。
- Credential Plane 双平面隔离见 P-ARCH-011。
- SDK 统一入口约束见 P-ARCH-020。
- Realm 六原语主权见 P-PROTO-003；该层是 platform primitive layer，不是
  realm semantic core 的完整别名。
- `nimi-cognition` 的独立 authority placement 见 P-ARCH-001。
- Forge / `world-studio` 迁移读路径见 `apps/forge/spec/**` 与
  `nimi-mods/spec/**`。

## 4. 非目标

- 不在 domain 文档重复定义 kernel 规则正文。
- 不在本文件写入执行态门禁或阶段性结果。
