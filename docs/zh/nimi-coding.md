# Nimi Coding

> Status: Active
> Version: 2.6
> Maintainer: @snowzane
> Created: 2026-03-03
> Last Updated: 2026-04-09
> Scope: Nimi 中文 public overview
> Language: 中文为主，关键术语保留英文
> Historical Note: 仓库早期讨论曾使用 `Oriented-AI Spec Coding`；该别名现已停用，`nimi-coding` 才是当前正式名称。

---

## 概览

**Nimi Coding** 是当前仓库用于 AI-first、authority-driven 交付的工程方法论。

`nimi-coding` 既是当前仓库中的正式方法论名称，也是当前正式的 execution system 模块名称。仓库早期出现过 `Oriented-AI Spec Coding` 这一旧别名，但它现在只保留历史说明意义，不应被视为现行并行名称。

它的基础生命周期是：

`Rule -> Table -> Generate -> Check -> Evidence`

它的 execution-orchestration 扩展是：

`Preflight -> Converge -> Phase Freeze -> Dispatch -> Execute -> Verify -> Accept -> Close / Reject / Defer`

为了支持 human-converged autonomous delivery，`nimi-coding/**` 现在已经 formalize：

- frozen execution packet artifact
- orchestration-state artifact
- packet-bound continuous runner
- foreground scheduler
- one-topic Codex automation setup / upsert / bridge surface

其中 execution packet 是 freeze 之后的执行 authority，orchestration state 是 packet-bound 的可变 run position，runner 与 scheduler 都仍然是 bounded mechanical surfaces，不会替代人类的语义验收与最终确认。

本文只是中文 public overview。它不是 contract authority，也不承载 `contracts/`、`schema/`、`protocol/`、`scripts/` 或 CLI 的正式定义；这些都以 `nimi-coding/**` 模块本体为准。

## Authority Model

1. `spec/**` 仍然是唯一的 product authority。
2. `.local/**` 是本地工作区，不提交，也不成为 repo authority。
3. `nimi-coding/**` 是正式 execution system 模块，已经 promoted、repo-tracked，并拥有自己的 AGENTS、contracts、validators 和 CLI。

## What Lives Where

| Layer | Location | Role |
|---|---|---|
| Public overview | `docs/zh/nimi-coding.md`（本文） | 面向读者的高层说明 |
| Formal execution system | `nimi-coding/**` | Contracts、schemas、protocols、gates、scripts、CLI、samples |
| Module AGENTS | `nimi-coding/AGENTS.md` | 模块内 ownership、workflow rules、script tiers |
| Topic workspace | `nimi-coding/.local/**` | 本地 incubator，用于研究和试跑，不进入 repo truth |

## Formal Module Structure

| Directory | Contents |
|---|---|
| `nimi-coding/contracts/` | Methodology、artifact model、staged delivery、finding lifecycle |
| `nimi-coding/schema/` | Topic index、explore、baseline、execution packet、orchestration state、evidence、finding ledger 等 typed schemas |
| `nimi-coding/protocol/` | Execution packet、orchestration state、dispatch、provider-worker-execution、worker-output、worker-runner-signal、acceptance、phase-lifecycle、reopen-defer 等 protocols |
| `nimi-coding/gates/` | Gate policy 与 promotion policy |
| `nimi-coding/scripts/` | Module validators、lifecycle helpers、module-owned repo-wide checks |
| `nimi-coding/cli/` | Unified command entrypoint |
| `nimi-coding/samples/` | Canonical self-host sample topic |

## Script Ownership

`nimi-coding/scripts/` 当前拥有两类脚本：

1. **Module-internal**：针对 nimi-coding artifacts 的 validators 与 lifecycle operations
2. **Module-owned repo-wide**：由 nimi-coding 自然拥有的 repo-wide checks，例如 AI context budget、doc metadata、structure budget；root `scripts/` 只保留薄 wrapper

repo-wide collaboration hygiene 仍然留在 root `scripts/`，例如 `check:agents-freshness`、`check:no-legacy-doc-contracts`。这些不属于 nimi-coding 模块 authority。

## CLI Command Surface

CLI 已经覆盖完整 staged-delivery surface，无需手工修改 YAML 路由。

**Lifecycle commands**：`init-topic`、`set-topic-status`、`set-baseline`、`attach-evidence`、`finding-set-status`

**Validation commands**：`validate-topic`、`validate-doc`、`validate-execution-packet`、`validate-orchestration-state`、`validate-notification-payload`、`validate-prompt`、`validate-worker-output`、`validate-acceptance`、`validate-finding-ledger`、`validate-module`

**Manager assist commands**：`topic-summary`、`unresolved-findings`、`prompt-skeleton`、`acceptance-skeleton`

**Batch delivery commands**：`batch-preflight`、`batch-next-phase`、`batch-phase-done`

**Continuous run commands**：`run-start`、`run-status`、`run-next-prompt`、`run-loop-once`、`run-until-blocked`

**Scheduler commands**：`run-schedule-status`、`run-schedule-once`

**Codex automation setup / upsert / bridge commands**：`run-schedule-codex-setup`、`run-schedule-codex-automation-upsert`、`run-schedule-codex-bridge`、`run-schedule-codex-once`

**Operational notification / checkpoint commands**：`run-ingest`、`run-ack-status`、`run-ack`、`run-notify`、`run-notify-telegram`、`run-notify-webhook`、`run-notifications`、`run-resume`、`run-confirm`

内容编写仍然主要是人工完成；execution packet 与 orchestration state 是 typed YAML artifacts，其余 phase artifacts 仍按 formal module 中定义的 markdown / YAML 结构存在。当前 CLI 已经覆盖 validation、batch、continuous run、scheduler，以及一 topic 范围内的 Codex automation setup / upsert / bridge。

## Current Boundaries

当前模块边界必须保持清晰：

1. `spec/**` 仍然是唯一 product authority；public docs 只是 overview，不是 contract truth。
2. packet、orchestration state、acceptance、evidence、finding-ledger 才是 execution truth；scheduler lease、automation bridge result、provider execution log、notification log、transport checkpoint 都只是 operational state。
3. scheduler、automation backend、assistant/UI bridge 都不是 semantic owner，不能接管 acceptance semantics、finding lifecycle semantics 或 packet progression semantics。
4. validator CLI 的 `validator-cli-result.v1` 是 machine-readable result surface，但不是 semantic judge。
5. 当前 admitted provider-backed worker boundary 仍然只限 `codex exec`，不把历史 alias 或其他 provider 写成这一 cut 的现行主面。

## Out Of Scope In This Cut

以下 phase-2 扩展仍未进入当前 public surface：

- daemon mode
- lease heartbeat / renewal
- multi-topic orchestration
- multi-provider automation
- semantic acceptance automation
- finding lifecycle automation

这些能力仍然 out of scope，不应在 public docs 中被写成既成事实。

## Default Use

1. 先读本文，建立高层模型。
2. 再读 `nimi-coding/AGENTS.md`，理解模块 ownership 与 workflow rules。
3. 如需正式系统语义，读 `nimi-coding/contracts/`。
4. 如需 typed artifact 结构，读 `nimi-coding/schema/` 与 `nimi-coding/protocol/`。
5. 如需完整命令面，使用 `pnpm nimi-coding:cli -- --help`。
6. `nimi-coding/.local/**` 只用于 incubate 新模式，不作为 repo truth。
7. 对模块本身做改动时，运行 `pnpm nimi-coding:check`。

## Historical Note

历史 alias `Oriented-AI Spec Coding` 仅用于解释仓库早期讨论背景，不应恢复为现行主名，也不应被视为 active parallel truth。
