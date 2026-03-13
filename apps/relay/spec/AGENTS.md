# Relay Spec AGENTS

## Authoritative Structure

- `kernel/*.md`: Relay contracts (RL-*)
- `kernel/tables/*.yaml`: fact sources
- `kernel/generated/*.md`: generated views (auto, read-only)
- `relay.md`: domain increments only, references kernel Rule IDs

## Editing Rules

- Do not manually edit `kernel/generated/*.md`
- Edit `kernel/tables/*.yaml` first, then align kernel contract docs
- Domain doc (relay.md) must not duplicate kernel rule prose
- Each rule defined exactly once in kernel
- Cross-layer references (S-*, K-*) are informational, not preconditions

## Rule ID Namespace

RL-BOOT-*   Bootstrap sequence
RL-IPC-*    Electron IPC bridge
RL-TRANS-*  Transport validation
RL-INTOP-*  Multi-app interop
RL-CORE-*   Agent-centric interaction core
RL-FEAT-*   Feature modules
