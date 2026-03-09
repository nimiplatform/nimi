# Runtime CLI Onboarding Contract

> Owner Domain: `K-CLI-*`

## K-CLI-001 Public First-Run Command Set

面向首次使用的 public CLI surface 必须稳定提供 `serve`、`doctor`、`init`、`version`、`run`、`model`、`provider`。

## K-CLI-002 Top-Level Usage Grouping

顶层 `nimi` usage 必须按 `Quick Start`、`Model Management`、`Cloud Setup`、`Runtime Ops`、`Advanced/Admin` 分组展示；首次使用路径不得被 infra/debug 子命令淹没。

## K-CLI-003 Run Happy Path Shape

首次使用文本生成命令必须是 prompt-first 形态，并收敛到以下 high-level targeting：

- bare `nimi run "<prompt>"` / `nimi run "<prompt>" --local`：本地默认文本模型
- `nimi run "<prompt>" --model <local-model-id>`：本地显式模型
- `nimi run "<prompt>" --provider <provider>`：provider 默认文本模型
- `nimi run "<prompt>" --provider <provider> --model <model>`：provider 显式模型
- `nimi run "<prompt>" --cloud`：default cloud provider 的默认文本模型

`--local` 与 `--cloud` 互斥；`--provider` 表示 cloud targeting，且不得与 `--local` 联用；`--cloud --model <value>` 不得成为 high-level public surface。默认行为为直接流式输出文本，`--json` 才返回结构化结果。

## K-CLI-004 Daemon-Down Error Contract

当 runtime daemon 不可达时，`nimi run` 与 `nimi provider test` 必须 fail-close，并返回单一步骤的可执行提示，不得暴露原始 gRPC/dial 细节到 public surface。

## K-CLI-005 Local Model Install Guidance

当 bare `nimi run`、`--local` 或 local `--model <local-model-id>` 解析出的本地目标模型缺失时，`nimi run` 必须提示安装；`--yes` 自动确认，`--no-install` 必须返回直接可执行的 `nimi model pull` 下一步，不得静默跳过。

## K-CLI-006 Onboarding Model Namespace

high-level onboarding surface 中，`model` 字段只表示具体模型，不承担 route/provider alias 语义；`provider` 出现即表示 cloud。high-level `--model` 允许 slash-bearing local model id，但不得把 fully-qualified remote model id 暴露为 public happy path；任意 fully-qualified remote model id 仅保留在低层 advanced surface，不得在 onboarding surface 回流 provider prefix 推断列表。

## K-CLI-007 Provider-First Cloud Setup

cloud 首次使用必须基于 machine-scoped provider credentials；public cloud setup surface 为 `nimi provider list|set|unset|test`，且 `nimi run` 必须支持 provider-first one-shot 入口（`--provider` / `--provider + --model`）与 machine-default cloud 入口（`--cloud`）。当 cloud credential 缺失且 provider 可确定时，interactive CLI 必须允许用户粘贴 API key、立即写入 canonical config，并继续完成同一条 run 命令；不得要求 account login 才能完成 basic cloud generation。

## K-CLI-008 Doctor Minimum Report

`nimi doctor` 至少报告 binary version、config path、daemon health、local engine health、configured providers、installed models，以及当前工作目录下的 optional SDK detection。

## K-CLI-009 Init Scaffold Contract

`nimi init` 必须产出可直接运行的模板；`basic` 模板走 `Runtime.generate()` ergonomic path，`vercel-ai` 模板走 `createNimiAiProvider({ runtime })` 集成路径。

## K-CLI-010 Version Contract

`nimi version` 必须输出 `nimi version`、`go version`、`os/arch` 与 `config path`，用于安装面和问题排查。

## K-CLI-011 Foreground Serve Contract

`nimi serve` 是 canonical foreground runtime command；它保持前台运行、直接输出日志，不得隐式 daemonize。

## K-CLI-012 Background Runtime Management Surface

background runtime management surface 必须稳定提供 `nimi start`、`nimi stop`、`nimi status`、`nimi logs`；`status` 表示进程/实例状态，`health` 保持详细运行时健康视图。

## K-CLI-013 Background Start Readiness Gate

`nimi start` 只有在 child process 已启动且 runtime health probe 可达后才可返回成功；探针返回 degraded 仍可算成功，但未通过 reachability 检查前不得报告成功。

## K-CLI-014 Status Reachability Contract

`nimi status` 不得只读本地 state files；它必须同时验证 process liveness 与 runtime reachability，并以不同退出码区分 stopped 与 probe failed。

## K-CLI-015 Stale Daemon State Cleanup

background runtime state files（如 `daemon.pid`、`daemon.json` 与 stale lock state）必须 fail-close 清理；若 state 与 live process 不一致，CLI 必须优先 live process truth 并移除陈旧 state。
