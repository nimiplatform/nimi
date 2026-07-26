# Local Agent Product Gate Guidance

## Scope

- Applies to `tests/local-agent-product/**` and tasks explicitly targeting Gate 0, P4, or the stateful first-party product harness.

## Hard Boundaries

- Product Control is discovered only at `~/.nimi/nimi.json`; P4 must reuse its `dataRoot.path` and must not accept a path option, environment root, fallback, or test-only Product Control topology.
- A fresh isolated product journey selects `dataRoot.path` once through the ordinary Product Control UI. An existing valid `selected` or `ready` record is reused without prompting for another path.
- Do not add a product reset RPC, default reset, migration, compatibility path, profile, or evidence mechanism. Pre-release residue cleanup is an explicit one-time non-product operation, never part of the Gate command.
- Finish every harness-only source, identity, configuration, and contract precondition before the first durable product mutation.
- After the canonical product owner reports success, an auxiliary projection or evidence-writer failure is a harness defect. Do not relabel it as product failure, delete product data automatically, or replay the completed action; use bounded read-only recovery or an explicit one-time non-product cleanup.
- P4 has one acceptance target: `pnpm test:e2e:first-party-product:p4`.
- Git/worktree snapshots, source hashes, test-file edits, artifact manifests, historical mappings, auxiliary Runtime readbacks, and evidence completeness are diagnostic only and cannot fail P4.
- Stop on the first real build, install, launch, OAuth, product-owner, Nimi Chat, partner UI, or reload failure; fix that failure and rerun the same target.

## Retrieval Defaults

- Read the active harness target, its direct product owner, immediate configuration, and exact authority implicated by the first failure.
- Do not preload historical plans, prior attempts, unrelated evidence, later gates, or repo-wide state.

## Verification Commands

- For P4, run only `pnpm test:e2e:first-party-product:p4` until its first real product-path failure is closed.
