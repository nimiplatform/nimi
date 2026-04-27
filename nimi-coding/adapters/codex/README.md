# Codex Adapter Sketch

This adapter defines native Codex support for `@nimiplatform/nimi-coding`.

It is intentionally separate from `oh_my_codex`. `oh_my_codex` is an external
adapter boundary; `codex` is the native Codex SDK host boundary.

## Boundary

- Codex SDK owns operational thread execution.
- `.nimi/**` remains semantic truth.
- Topic decisions come from `nimicoding topic run-next-step`.
- Run continuity is recorded by `nimicoding topic run-ledger`.
- Codex thread IDs are operational state and must not become semantic truth.

## SDK Surface

The admitted native surface is the official TypeScript package:

- package: `@openai/codex-sdk`
- primary API: `new Codex().startThread().run(prompt)`
- resume API: `new Codex().resumeThread(threadId).run(prompt)`

The first packaged runner must call the SDK directly. It must not shell out to
the Codex CLI and must not route through `oh_my_codex`.

## Execution Rule

The runner may call Codex only after `run-next-step` returns:

- `stop_class: continue`
- a mechanical `recommended_action`
- a concrete `next_command_ref`

`continue` means the next package-owned command is placeholder-free and
mechanically determined. It may include lifecycle transitions such as admitting
the uniquely selected wave or freezing the uniquely matching draft packet; those
transitions do not by themselves create a human gate.

All other stop classes must be represented as run-ledger events and returned to
the manager/operator without hidden continuation.

## Native Review Boundary

Codex native review features are admitted only as lower-layer host capabilities:

- automatic approval review may evaluate permission prompts and risk posture
- GitHub automatic review may provide PR findings
- both outputs may be recorded as `.nimi/local/evidence/**` candidate evidence

They must not admit a wave, freeze a packet, record a result verdict, close a
wave, close a topic, or satisfy true-close. Those transitions remain
`nimicoding topic` command semantics with package-owned artifact lineage.
