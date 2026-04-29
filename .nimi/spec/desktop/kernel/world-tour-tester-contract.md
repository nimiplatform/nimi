# World Tour Tester Contract

> Authority: Desktop Kernel

## Scope

Desktop tester `world tour` product semantics。定义 baseline
`world.generate` 的 tester acceptance surface、required in-app chain、以及
fail-close acceptance behavior。

不拥有：

- connector custody truth
- runtime scenario truth
- canonical Realm world/resource truth

## D-LLM-066 — World Tour Acceptance Surface

Desktop tester 必须把 `world tour` 作为 `world.generate` 的 baseline
operator-visible acceptance surface。

- `world tour` 是最终端到端验收入口，不是可选 demo。
- web-only render、API-only success、或 runtime-only job success 均不构成最终验收。

## D-LLM-067 — Required Acceptance Chain

`world tour` 必须验证以下完整链路：

1. resolve `world.generate` route
2. submit runtime-owned world-generation request
3. observe async job progression until terminal state
4. fetch typed world result
5. render provider-delivered SPZ assets through Spark 2.0 in-app

若链路缺失任一步，不得宣称 baseline acceptance 成功。

## D-LLM-068 — Fail-Close Acceptance

`world tour` 的验收必须 fail-close：

- 缺 renderable SPZ assets 时，不得把 preview-only 视为 full acceptance 成功。
- 外部打开 provider viewer URL，不得替代 in-app Spark render 成功。
- connector -> runtime -> provider -> result -> render 任一关键段失败时，
  tester 必须呈现失败语义，而不是部分成功。
