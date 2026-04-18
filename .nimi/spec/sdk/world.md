# World SDK Domain Spec

> Scope: `@nimiplatform/sdk/world` world-domain facade.
> Normative Imports: `.nimi/spec/sdk/kernel/*`

## 0. 权威导入

- `kernel/world-contract.md` (`S-WORLD-001`, `S-WORLD-002`, `S-WORLD-003`, `S-WORLD-004`, `S-WORLD-005`, `S-WORLD-006`, `S-WORLD-007`)
- `kernel/surface-contract.md` (`S-SURFACE-001`, `S-SURFACE-014`)
- `kernel/boundary-contract.md` (`S-BOUNDARY-001`, `S-BOUNDARY-002`)

## 1. 文档定位

本文件是 `@nimiplatform/sdk/world` 的 domain guide。公开 world-domain
facade 的 family boundary、projection boundary、fixture boundary、renderer
orchestration boundary 与 world-session composition boundary 以 SDK kernel 为
权威。

## 2. 阅读路径

1. `kernel/world-contract.md`
2. `kernel/surface-contract.md`
3. `kernel/boundary-contract.md`
4. `.nimi/spec/realm/world.md`
5. `.nimi/spec/platform/kernel/architecture-contract.md`

## 3. 与其他 SDK 域的关系

- `@nimiplatform/sdk/world` 通过 SDK public authority 组合 Realm world truth
  consume 与 Runtime-backed world generation / materialization surfaces。
- `@nimiplatform/sdk/world` 不替代 `@nimiplatform/sdk/realm` 的 canonical
  world truth home。
- `@nimiplatform/sdk/world` 不替代 Runtime `K-WEV-*` 或 runtime provider
  execution semantic ownership。

## 4. 非目标

- 不公开 provider-native request shapes。
- 不公开 renderer-driver APIs。
- 不在本文件定义 world simulation contract。
- 不引入第二个 public world package。
