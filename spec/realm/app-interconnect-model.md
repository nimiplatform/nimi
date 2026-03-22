# Realm App Interconnect Model

> Domain: Realm / App Interconnect Model

## 0. Normative Imports

- `kernel/truth-contract.md`: `R-TRUTH-001`, `R-TRUTH-002`, `R-TRUTH-003`, `R-TRUTH-004`, `R-TRUTH-005`, `R-TRUTH-006`
- `kernel/world-state-contract.md`: `R-WSTATE-001`, `R-WSTATE-002`, `R-WSTATE-003`, `R-WSTATE-004`, `R-WSTATE-005`, `R-WSTATE-006`
- `kernel/world-history-contract.md`: `R-WHIST-001`, `R-WHIST-002`, `R-WHIST-003`, `R-WHIST-004`, `R-WHIST-005`, `R-WHIST-006`
- `kernel/agent-memory-contract.md`: `R-MEM-001`, `R-MEM-002`, `R-MEM-003`, `R-MEM-004`, `R-MEM-005`, `R-MEM-006`
- `kernel/chat-contract.md`: `R-CHAT-001`, `R-CHAT-002`, `R-CHAT-003`, `R-CHAT-004`
- `kernel/social-contract.md`: `R-SOC-001`, `R-SOC-002`, `R-SOC-003`, `R-SOC-004`
- `kernel/economy-contract.md`: `R-ECON-001`, `R-ECON-002`, `R-ECON-003`, `R-ECON-004`
- `kernel/asset-contract.md`: `R-ASSET-001`, `R-ASSET-002`, `R-ASSET-003`, `R-ASSET-004`
- `kernel/transit-contract.md`: `R-TRANSIT-001`, `R-TRANSIT-002`, `R-TRANSIT-003`, `R-TRANSIT-004`
- `spec/platform/ai-last-mile.md`

## 1. Scope

App interconnect defines Realm as a cross-application semantic layer built around `Truth / World State / World History / Agent Memory`, with `Chat` retained only as `HUMAN_HUMAN + DIRECT`.

## 2. Reading Path

1. `kernel/truth-contract.md`
2. `kernel/world-state-contract.md`
3. `kernel/world-history-contract.md`
4. `kernel/agent-memory-contract.md`
5. `kernel/chat-contract.md`
6. `kernel/social-contract.md`
7. `kernel/economy-contract.md`
8. `kernel/asset-contract.md`
9. `kernel/transit-contract.md`
10. `spec/platform/ai-last-mile.md`

## 3. Non-goals

No runtime orchestration, prompt state, provider routing knobs, or story archive masquerading as canonical history is defined here.
