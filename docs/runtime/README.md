# Runtime Reference

`nimi-runtime` is the local execution plane daemon.

It exposes:

- gRPC APIs (`RuntimeAiService`, `RuntimeAuthService`, `RuntimeGrantService`, `RuntimeWorkflowService`, `RuntimeModelService`, `RuntimeKnowledgeService`, `RuntimeAppService`, `RuntimeAuditService`, `RuntimeLocalRuntimeService`)
- HTTP diagnostics endpoints (`/livez`, `/readyz`, `/healthz`, `/v1/runtime/health`)

## Run the Daemon

```bash
cd runtime
go run ./cmd/nimi serve
```

## CLI Entry

```bash
cd runtime
go run ./cmd/nimi <subcommand>
```

Top-level runtime subcommands:

- `serve`
- `status`
- `run`
- `chat`
- `ai`
- `model`
- `mod`
- `auth`
- `app-auth`
- `knowledge`
- `app`
- `audit`
- `workflow`
- `health`
- `providers`

## Command Groups

### `ai`

- `generate`
- `stream`
- `embed`
- `image`
- `video`
- `tts`
- `stt`

All support caller metadata overrides:

- `--caller-kind`
- `--caller-id`
- `--surface-id`
- `--trace-id`

### `model`

- `list`
- `pull`
- `remove`
- `health`

### `mod`

- `list`
- `install`
- `create`
- `dev`
- `build`
- `publish`

Notes:

- `install` accepts local dir, `github:owner/repo[/subpath]`, `mod-circle:<modId>`, and direct `world.nimi.*`
- `install --strict-id` disables Mod Circle name fallback and requires exact `modId`
- `publish` opens a Mod Circle PR; missing token returns `MOD_PUBLISH_GITHUB_TOKEN_MISSING` with action hint

### `auth`

- `register-app`
- `open-session`
- `refresh-session`
- `revoke-session`
- `register-external`
- `open-external-session`
- `revoke-external-session`

### `app-auth`

- `authorize`
- `validate`
- `revoke`
- `delegate`
- `chain`

### `runtime knowledge`

- `build`
- `search`
- `delete`

Notes:

- `build` requires at least one `--source-uri`
- `--options-file` / `--filters-file` use protojson `google.protobuf.Struct`

### `runtime app`

- `send`
- `watch`

Notes:

- `send` supports `--payload-file` (protojson `google.protobuf.Struct`)
- `watch` streams events from `RuntimeAppService.SubscribeAppMessages`

### `runtime audit`

- `events`
- `usage`
- `export`

Notes:

- `events` supports domain/reason/time/caller filters
- `usage` supports capability/model/window filters
- `export` streams audit chunks and can write to `--output`

### `runtime workflow`

- `submit`
- `get`
- `cancel`
- `watch`

Notes:

- `submit` consumes a protojson `WorkflowDefinition` file
- `watch` exits non-zero when terminal event is `FAILED` or `CANCELED`

### `runtime health` / `runtime providers`

- source can be `http` or `grpc`
- support watch mode and change-only mode

## Proto Source

- Runtime proto contracts: [`../../proto/runtime/v1/`](../../proto/runtime/v1/)
- Runtime implementation and local CLI reference: [`../../runtime/README.md`](../../runtime/README.md)
