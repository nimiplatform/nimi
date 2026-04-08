# AI Scope Contract

> Owner Domain: `P-AISC-*`

## Scope

定义 `AIScopeRef` — AI 配置作用域的 canonical identity contract。本契约为跨 desktop / web / future surface 的 AI config keying 提供稳定唯一标识。

## P-AISC-001 — AIScopeRef Identity

`AIScopeRef` 是 AI 配置作用域的 canonical identity，最小 schema 固定为：

```
AIScopeRef {
  kind: 'app' | 'mod' | 'module' | 'feature'
  ownerId: string
  surfaceId?: string
}
```

- `kind` 标识作用域类型。
- `ownerId` 标识作用域所有者实体（app ID、mod ID、module ID、feature ID）。
- `surfaceId` 可选，标识同一 owner 下的子面（如 app 内某个独立 feature surface）。
- `kind + ownerId + surfaceId?` 三元组必须在整个系统中形成稳定唯一键。

`kind` 的 canonical 语义约束：

- `kind: 'app'`：`ownerId` 标识 app identity；`surfaceId` 可标识 app 下的独立 AI feature surface。
- `kind: 'mod'`：`ownerId` 必须是 stable mod manifest ID；不得使用 route page ID、tab key、conversation ID、document ID、project ID、prompt config ID、profile ID 等 mod 内数据实体或瞬时 UI key 充当 owner。
- `kind: 'module'`：`ownerId` 标识独立 module identity；仅当 module 自身是 canonical owner 时才可使用。
- `kind: 'feature'`：`ownerId` 标识跨 app/mod 复用的独立 feature owner；不得把本应属于 mod owner 的 AI truth 拆散到 feature fragments。

Phase 1 mod-scoped AIConfig 的 canonical shape 固定为：

```
AIScopeRef {
  kind: 'mod'
  ownerId: <stable mod manifest id>
  surfaceId: 'workspace'
}
```

- `surfaceId: 'workspace'` 表示该 mod 当前唯一的 canonical AI workspace。
- 在后续 kernel rule 明确定义前，mod-scoped AIConfig consumer 不得省略该 `surfaceId`，也不得自行发明替代值。

## P-AISC-002 — Uniqueness And Lifecycle

- 每个 `AIScopeRef` 实例在其 lifetime 内全局唯一。
- scope lifecycle 必须由 owner entity 的 lifecycle 驱动：scope 的创建、存续、销毁绑定到 owner entity。
- 不允许 UI 或 consumer 临时拼接 scope key；scope key 必须由 canonical factory 或 registry 产出。
- scope 销毁时，其绑定的 `AIConfig` 必须同步失效或清理，不允许悬空 config 残留。

多 scope 约束：

- 一个 mod 默认只拥有一个 canonical AI scope：`surfaceId: 'workspace'`。
- 只有当同一 mod 内存在多个 first-class AI workspace，且每个 workspace 都需要独立的 profile apply / config edit / probe / snapshot history 时，才允许为该 mod 扩展多个 `AIScopeRef`。
- mod 多 scope 必须是显式少量、可被用户稳定理解的 workspace identity；不得按 tab、session、thread、document、selected record、modal、wizard step 或其他瞬时 UI / domain 粒度滥扩 scope。
- 若产品只是想在一个 mod workspace 内切换当前对象、当前文档或当前会话，必须在该 workspace scope 内通过 domain state 实现，不得为每个对象额外创建 `AIScopeRef`。

## P-AISC-003 — No Implicit Inheritance

- scope 之间不存在隐式继承链。
- 每个 scope 的 `AIConfig` 必须是 full materialized config。
- 如果产品需要"从父 scope 继承默认值"的 UX，实现方式必须是 profile apply（copy-on-write 覆盖），不是运行时 fallback chain。
- 不允许 scope A 的 `AIConfig` 在运行时引用 scope B 的 config 作为 fallback。

## P-AISC-004 — Cross-Surface Applicability

- `AIScopeRef` 同时适用于 desktop 和 web surface。
- desktop-specific 和 web-specific 的 scope 行为差异必须在各自的 kernel contract 中定义，不在本契约中引入 surface-specific 规则。
- 若后续证明 `AIScopeRef` 只在 desktop 体系内有效，可由 spec preflight 决议下沉回 Desktop Kernel，但下沉前本契约保持 authority。

## P-AISC-005 — Allowed Consumers

- `AIScopeRef` 可被以下 kernel authority 消费：
  - Desktop Kernel — 用于 `AIConfig` keyed storage 和 UI scope selection
  - SDK Kernel — 用于 typed config/profile/snapshot API 的 scope parameter
  - Runtime Kernel — 用于 execution snapshot 的 scope evidence
- consumer 不得扩展 `AIScopeRef` schema（如添加 consumer-local fields）；如需额外标注，必须在 consumer 侧建立独立 annotation，不修改 `AIScopeRef` 本体。
- mod-facing AIConfig consumer 通过 Desktop/Web host bridge 消费 `AIScopeRef` 时，仍必须使用本契约定义的 canonical identity；不得退回 consumer-local key schema。

## Fact Sources

- 本契约无 YAML 表。Phase 1 scope kind 值域为封闭枚举 `'app' | 'mod' | 'module' | 'feature'`；若需扩展，须修改本规则并通过 spec consistency check。
- Phase 1 mod-scoped AIConfig canonical workspace identity 固定为 `{ kind: 'mod', ownerId: <modManifestId>, surfaceId: 'workspace' }`。
