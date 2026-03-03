# proto

Shared protocol sources for public repository.

Current state:

- Runtime V1 proto sources are in `proto/runtime/v1/`.
- Proto governance contract is tracked in `spec/runtime/proto-governance.md`.

Files:

- `runtime/v1/common.proto`
- `runtime/v1/ai.proto`
- `runtime/v1/app.proto`
- `runtime/v1/auth.proto`
- `runtime/v1/audit.proto`
- `runtime/v1/connector.proto`
- `runtime/v1/grant.proto`
- `runtime/v1/knowledge.proto`
- `runtime/v1/local_runtime.proto`
- `runtime/v1/model.proto`
- `runtime/v1/script_worker.proto`
- `runtime/v1/workflow.proto`

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
