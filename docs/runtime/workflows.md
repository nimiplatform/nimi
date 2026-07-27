# Workflows

A workflow is Runtime's typed execution graph for AI work that
takes more than one request-response turn. This page describes the
workflow model, the typed nodes, the workflow state machine, and
the merge strategies.

For streaming details see [Streaming](/runtime/streaming). For
non-text artifacts see [Multimodal](/runtime/multimodal).

## What A Workflow Is

A workflow is a DAG of typed nodes. Apps build workflows by
composing admitted node kinds; Runtime owns execution, retry,
branch, merge, and audit.

| Property | Value |
| --- | --- |
| Shape | Directed acyclic graph |
| Node count | 15 typed kinds across 3 categories |
| Retry | Per-node, admitted contract |
| Branch | Conditional via `CONTROL_BRANCH` |
| Merge | Joins via `CONTROL_MERGE` with admitted strategies |
| Execution | Inline or external-async |

Apps don't invent execution semantics. Workflows are bounded by
the admitted contract; an undefined node kind fails closed.

## The 15 Node Kinds

| Category | Kinds |
| --- | --- |
| AI | `AI_GENERATE`, `AI_STREAM`, `AI_EMBED`, `AI_IMAGE`, `AI_VIDEO`, `AI_TTS`, `AI_STT`, `AI_TTS_CREATE_VOICE`, `AI_TTS_SYNTHESIZE` |
| Transform | `TRANSFORM_EXTRACT`, `TRANSFORM_TEMPLATE`, `TRANSFORM_SCRIPT` |
| Control | `CONTROL_BRANCH`, `CONTROL_MERGE`, `CONTROL_NOOP` |

Each kind has typed inputs, typed outputs, and admitted retry /
branch / merge semantics. Kinds are admitted at the runtime kernel
level; new kinds require kernel extension.

## Workflow State Machine

| State | Terminal? |
| --- | --- |
| `ACCEPTED` | no |
| `QUEUED` | no |
| `RUNNING` | no |
| `COMPLETED` | yes (success) |
| `FAILED` | yes |
| `CANCELED` | yes |
| `SKIPPED` | yes |

A workflow finishes in one of `COMPLETED | FAILED | CANCELED |
SKIPPED`. The state is observable to apps through the workflow
event stream.

## Workflow Event Stream

While a workflow runs, Runtime emits typed events:

| Event | Fires |
| --- | --- |
| `STARTED` | Workflow entered `RUNNING` |
| `NODE_STARTED` | A node entered execution |
| `NODE_PROGRESS` | A node emitted progress |
| `NODE_COMPLETED` | A node finished |
| `NODE_SKIPPED` | A node was skipped |
| `COMPLETED` | Workflow reached `COMPLETED` |
| `FAILED` | Workflow reached `FAILED` |
| `CANCELED` | Workflow reached `CANCELED` |

Plus external-async variants for nodes that fan out to provider
async tasks (see [Multimodal](/runtime/multimodal)).

## Merge Strategies

When multiple parallel branches converge at a `CONTROL_MERGE`
node, the merge strategy decides when the merge satisfies:

| Strategy | Satisfies when |
| --- | --- |
| `ALL` | All upstream branches completed |
| `ANY` | Any one upstream branch completed |
| `N_OF_M` | N upstream branches completed |

Merge strategy is declared at workflow construction; runtime
enforces it.

## Inline And External-Async Execution

| Mode | When |
| --- | --- |
| Inline | Nodes execute synchronously inside the workflow run |
| External-async | A node fans out to a provider async task or other long-running external work; the workflow tracks the external lifecycle |

External-async is what makes a workflow that includes (for example)
a long-running video generation task work without blocking the
entire workflow. The provider async lifecycle (`queued → running →
succeeded | failed | expired`) is normalized into the workflow
state machine.

## ScenarioJob Linkage

Workflow AI nodes route through `ScenarioJob` for unified
execution semantics. A `ScenarioJob` is the shared lifecycle for
any AI request:

| State | Terminal? |
| --- | --- |
| `SUBMITTED` | no |
| `RUNNING` | no |
| `COMPLETED` | yes |
| `FAILED` | yes |
| `TIMEOUT` | yes |
| `CANCELED` | yes |

Apps that want a single unified handle for any AI work use
`ScenarioJob` as the bridge — every modality, every provider,
every workflow node fans out into `ScenarioJob` lifecycle.

## Reader Scenario: A Multi-Step Workflow

An app builds a workflow that:

1. Extracts text from a PDF (`TRANSFORM_EXTRACT`).
2. Embeds the extracted text (`AI_EMBED`).
3. Generates a structured analysis (`AI_GENERATE`).
4. Synthesizes the analysis as TTS (`AI_TTS`).

Execution:

1. Workflow enters `ACCEPTED`. The DAG is validated; node kinds
   are admitted; retry / branch / merge contracts are recorded.
2. Workflow moves to `QUEUED`, then `RUNNING`. `STARTED` event
   fires.
3. Node 1 runs. `NODE_STARTED → NODE_PROGRESS → NODE_COMPLETED`.
4. Node 2 runs. The embed result is typed.
5. Node 3 runs. The structured output is typed; if the schema
   does not validate, the node fails (not the workflow — yet).
6. Node 4 runs. The TTS artifact is delivered under the
   multimodal artifact contract.
7. Workflow reaches `COMPLETED`. Audit is recorded.

If any node hits a contract failure, the workflow's terminal
state depends on the node-level retry policy. Transient errors
may be retried; contract failures fail closed.

## Reader Scenario: A Branch-And-Merge Workflow

An app builds a workflow that:

1. Generates three candidate captions in parallel
   (`AI_GENERATE`, `AI_GENERATE`, `AI_GENERATE`).
2. Merges with strategy `ANY` (first one wins).
3. Continues with the winning caption.

Execution:

1. Three `AI_GENERATE` nodes run in parallel.
2. The first to complete satisfies the `CONTROL_MERGE` with
   `ANY`. The other two are typically `CANCELED` to free
   resources (depending on admitted cancellation policy).
3. Downstream continues with the winning caption.

Strategy semantics matter here. `ALL` would wait for all three;
`ANY` returns the first; `N_OF_M` lets the workflow pick "best of
3" with fallback. The strategy is declared, not improvised at
runtime.

## Source Basis

- [`.nimi/spec/runtime/model-catalog.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/model-catalog.authority.yaml)
- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)
- [`.nimi/spec/runtime/rpc-foundations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/rpc-foundations.authority.yaml)
- [`config/spec-frozen/runtime/tables/job-states.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/spec-frozen/runtime/tables/job-states.yaml)
