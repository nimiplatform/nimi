# Nimi Home Contract

> Owner Domain: `P-HOME-*`

## Scope

定义 `Nimi Home` — Platform 拥有的产品入口/壳层 authority surface。
本契约只定义产品 ontology 与非 owner 边界，shell IA 与实现细节由
`.nimi/spec/desktop/kernel/nimi-home-shell-contract.md`（`D-HOME-*`）拥有。

不创建 `.nimi/spec/home/**` 平级 kernel。

## P-HOME-001 — Authority Boundary

`Nimi Home` 是 Platform 拥有的产品入口/壳层 authority surface。
当前由 desktop host 渲染。

`MUST`:

- 本 authority 只表达产品入口/壳层 ontology、placement、与跨域 projection
  许可。
- shell IA 与实现细节由 Desktop kernel `D-HOME-*` 拥有。
- Web 入口 boundary 仍由 `web-release-contract.md`（`P-WEB-*`）拥有；Web
  surface 不被本契约升格为 product entry shell 平级 owner，除非未来明确
  admit。

`MUST NOT`:

- 不得创建 `.nimi/spec/home/**` 平级 kernel。
- 不得让 `Nimi Home` 名称作为 schema、registry、table 列名、IPC 命令名、
  或文件路径段被复用为第二种 authority 名义。

## P-HOME-002 — Hosted Shell Binding

`Nimi Home` 通过 Desktop-hosted shell 渲染：

- Desktop kernel 拥有 hosted shell 实现 contract。
- Platform 拥有产品入口 ontology 与 placement。
- Desktop hosted shell 必须按 `D-HOME-*` 实现，不得自行重写 `Nimi Home`
  ontology。

## P-HOME-003 — Non-Owner Rules

`MUST NOT`：`Nimi Home` 不得拥有以下任一 truth：

- installer / downloader / materializer 执行 ownership
- selected source record（K-LENV-MAT-*, K-LENV-ACT-*）
- Runtime model catalog / host capability profile / local compute pack
  authority（K-LENG-024..K-LENG-028）
- Realm 账户 / 云端 / world / economy / social authority
- Cognition 语义 memory / knowledge artifact authority
- Avatar `.nimi/spec/avatar/**` kernel authority
- public Mod / public Extension 产品类目
- 共享 Nimi Content Pack 渠道
- agent identity 跨 app 平级 owner（参见
  `agent-identity-primitive-floor.md` Wave 0 决议）

## P-HOME-004 — Surface Registry Requirement

`MUST`：`Nimi Home` 的 surface registry（由 Desktop kernel
`nimi-home-surfaces.yaml` 拥有）必须包含以下入口的 placement 行：

- `first-run`
- `apps`
- `agent-chat`
- `runtime-health`
- `app-health`
- `account`
- `settings`
- `diagnostics`
- `developer-mode`
- `failure-projection`

每个 surface 行必须显式列出其 source authority 与 forbidden ownership；不允许
出现"集中式 generic surface"既消费多 authority 又不声明边界。

## P-HOME-005 — AIProfile Selection Consumption

`MUST`：`Nimi Home` 必须通过
`aiProfile.apply(scopeRef, profileId)`（`S-AICONF-001`）消费
Platform-owned AIProfile selection policy（`P-AIPS-001..P-AIPS-013`）输出的
factory AIProfile reference。

UI / first-run / shell / first-party app AIProfile 绑定代码均不得内嵌
provider / connector / engine / model 字符串常量。

mechanical guard：Wave 4 重命名后的 no-provider/no-model gate（见
`enforcement-gates-required.md` 与 `P-AIPS-008`）。

## P-HOME-006 — Agent Chat Placement Boundary

`MUST`：Wave 1 的 Agent Chat 在 `Nimi Home` 内是 in-shell reference
surface only。本契约固定其作为 placement，但不在 Wave 1 收编 transcript /
history / identity / grant / memory / `ConversationAnchor` 的 ownership。

`MUST NOT`:

- Agent Chat 不得在 Wave 1 拥有 chat-derived memory truth 或跨 app agent
  identity truth。
- 完整 identity / grant / memory semantics 由 Wave 4 permission fabric
  与 `runtime-cognition-knowledge-memory-owner-split.md`、
  `agent-identity-primitive-floor.md` 决议接管。

## P-HOME-007 — Mandatory AIScopeRef

`MUST`：所有 Agent Chat 执行 path（以及 `Nimi Home` 内任何调用
`Runtime` AI execution 的 path）必须显式携带 `AIScopeRef`（`P-AISC-001`）。

mechanical guard：`check:home-shell-aiscoperef-required`。

## P-HOME-008 — No Private Path

`MUST NOT`：`Nimi Home` 任何代码层不得 import：

- `runtime/internal/**`
- Realm private client / private transport
- SDK private internals

mechanical guard：`check:home-shell-no-runtime-internal-import`。

## P-HOME-009 — Apps Non-Owner Rule

`MUST`：`Apps` surface 消费 Nimi App registry / package projection、SDK Nimi
App client projection、与 Runtime registration / enforcement projection。
`Library` 与 `Discovery` 只能作为 lower-level projection 或历史实现名，不得
定义最终 ordinary primary navigation label。

`MUST NOT`:

- 不得拥有 admission truth、marketplace truth、economy truth、package
  trust truth、或第二份 app discovery 平面。
- 不得从 app-local spec、workspace source tree、Mods、Extensions、或未
  admitted registry row 推导 ordinary Apps 可见性。
- 不得在 ordinary Apps 中显示 Avatar；隐藏 Avatar 也不得把 package /
  install / update truth 移入 Agent Chat。
- 不得引入“Home tab as Home”命名递归（参见 Wave 0
  `naming-and-kernel-ontology.md`）。

## P-HOME-010 — First Screen Rule

`MUST`：`Nimi Home` 的首屏必须是可用 product control。

`MUST NOT`：首屏不得是 marketing copy、landing page、或第三方 placeholder。
首屏可以 fail-closed 展示 cold-start authority 状态（`P-COLD-001`），但
必须直接给到用户可操作的产品控制面（settings、setup、account、Runtime
health、Apps 等）。

## Fact Sources

- `.nimi/spec/platform/kernel/architecture-contract.md` — `P-ARCH-001..P-ARCH-021`
- `.nimi/spec/platform/kernel/ai-scope-contract.md` — `P-AISC-001..P-AISC-005`
- `.nimi/spec/platform/kernel/ai-profile-selection-policy-contract.md` — `P-AIPS-001..P-AIPS-013`
- `.nimi/spec/platform/kernel/nimi-self-update-contract.md` — `P-SUPD-001..P-SUPD-008`
- `.nimi/spec/platform/kernel/nimi-package-release-contract.md` — `P-PKGREL-001..P-PKGREL-008`
- `.nimi/spec/platform/kernel/cold-start-authority-contract.md` — `P-COLD-001..P-COLD-008`
- `.nimi/spec/platform/kernel/web-release-contract.md` — `P-WEB-*`
- `.nimi/spec/desktop/kernel/nimi-home-shell-contract.md` — `D-HOME-001..D-HOME-012`
- `.nimi/spec/desktop/kernel/tables/nimi-home-surfaces.yaml`
- `.nimi/spec/sdk/kernel/ai-config-surface-contract.md` — `S-AICONF-001..S-AICONF-006`
- `.nimi/spec/sdk/kernel/local-environment-projection-contract.md` — `S-RUNTIME-119`
