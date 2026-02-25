# proto

Shared protocol sources for public repository.

Current state:

- Runtime V1 proto sources are in `proto/runtime/v1/`.
- Contract source is tracked in `ssot/runtime/proto-contract.md`.

Files:

- `runtime/v1/common.proto`
- `runtime/v1/ai.proto`
- `runtime/v1/workflow.proto`
- `runtime/v1/model.proto`
- `runtime/v1/grant.proto`
- `runtime/v1/auth.proto`
- `runtime/v1/knowledge.proto`
- `runtime/v1/app.proto`
- `runtime/v1/audit.proto`

## Generate

```bash
cd proto
$(go env GOPATH)/bin/buf generate
```

From workspace root:

```bash
pnpm proto:generate
pnpm proto:lint
pnpm proto:breaking
pnpm proto:drift-check
```
