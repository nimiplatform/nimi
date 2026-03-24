# Platform Architecture

> Domain: Platform / Architecture

## 0. Normative Imports

| Kernel Location | Rule IDs |
|---|---|
| `kernel/architecture-contract.md` | P-ARCH-001–030 |
| `kernel/protocol-contract.md` | P-PROTO-002, P-PROTO-003, P-PROTO-010, P-PROTO-011, P-PROTO-020 |

## 1. 文档定位

本文件是平台架构导引。六层职责、通信边界、执行栈冻结与凭证平面以 kernel 为权威，domain 文档只提供阅读路径和跨域关系图。

## 2. 核心阅读顺序

1. `kernel/architecture-contract.md`：先确认 P-ARCH-001、P-ARCH-002、P-ARCH-010、P-ARCH-011、P-ARCH-020。
2. `kernel/protocol-contract.md`：再确认 P-PROTO-010、P-PROTO-011、P-PROTO-020 的封装与授权语义。
3. `spec/runtime/kernel/index.md` 与 `spec/sdk/kernel/index.md`：最后落到实现侧契约层。

## 3. 跨层关系

```
mods <-> desktop       : in-process hook runtime
desktop -> nimi-sdk    : unified developer surface
desktop -> nimi-runtime: gRPC runtime access
nimi-apps -> nimi-realm: REST + WS realm access
```

- Runtime 职责边界见 P-ARCH-004。
- Credential Plane 双平面隔离见 P-ARCH-011。
- SDK 统一入口约束见 P-ARCH-020。
- Realm 六原语主权见 P-PROTO-003。

## 4. 非目标

- 不在 domain 文档重复定义 kernel 规则正文。
- 不在本文件写入执行态门禁或阶段性结果。
