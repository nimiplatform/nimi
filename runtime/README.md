# runtime

`nimi-runtime` is now bootstrapped with executable Go entries:

- `cmd/nimi` unified entry (`serve` daemon + full CLI)
- `cmd/nimi` command surface: `serve`, `status`, `run/chat`, `ai ...`, `model ...`, `mod ...`, `auth ...`, `app-auth ...`, `knowledge ...`, `app ...`, `audit ...`, `workflow ...`, `health`, `providers`, `config ...`
- `internal/` runtime boot, health state, gRPC/HTTP servers

Current implementation scope:

- Daemon process lifecycle and graceful shutdown
- gRPC server with built-in health service
- Implemented gRPC services:
  - `RuntimeAuditService` (`ListAuditEvents`, `ExportAuditEvents`, `ListUsageStats`, `GetRuntimeHealth`, `ListAIProviderHealth`, `SubscribeAIProviderHealthEvents`, `SubscribeRuntimeHealthEvents`)
  - `RuntimeModelService` (`ListModels`, `PullModel`, `RemoveModel`, `CheckModelHealth`)
  - `RuntimeAuthService` (app/external principal session lifecycle)
  - `RuntimeGrantService` (authorize/validate/revoke/delegate/token-chain)
  - `RuntimeAppService` (`SendAppMessage`, `SubscribeAppMessages`)
  - `RuntimeKnowledgeService` (`BuildIndex`, `SearchIndex`, `DeleteIndex`)
  - `RuntimeLocalService` (local model/service/node/dependency management + local runtime audit append/query)
- `RuntimeAiService` (all RPCs implemented with `local` / `cloud` provider router, strict route/fallback checks, and native SSE stream forwarding when provider supports streaming chat)
  - `RuntimeWorkflowService` (submit/get/cancel/subscribe with DAG validation and async execution)
- Unified runtime audit bus:
  - gRPC unary/stream interceptors write audit events and usage samples into in-memory store
  - `RuntimeAuditService` reads unified store for list/export/stats
  - daemon emits provider health transition events (`runtime.ai` / `provider.health`)
  - AI service emits model-hint auto-switch events (`runtime.ai` / `route.auto_switch`)
- OpenAI-compatible provider bridge:
  - local-plane: set `NIMI_RUNTIME_LOCAL_AI_BASE_URL` (optional `NIMI_RUNTIME_LOCAL_AI_API_KEY`)
  - cloud-plane (canonical `NIMI_RUNTIME_CLOUD_*` keys):
    - NimiLLM: `NIMI_RUNTIME_CLOUD_NIMILLM_BASE_URL` / `NIMI_RUNTIME_CLOUD_NIMILLM_API_KEY`
    - DashScope: `NIMI_RUNTIME_CLOUD_DASHSCOPE_BASE_URL` / `NIMI_RUNTIME_CLOUD_DASHSCOPE_API_KEY`
    - Volcengine: `NIMI_RUNTIME_CLOUD_VOLCENGINE_BASE_URL` / `NIMI_RUNTIME_CLOUD_VOLCENGINE_API_KEY`
    - Volcengine OpenSpeech: `NIMI_RUNTIME_CLOUD_VOLCENGINE_OPENSPEECH_BASE_URL` / `NIMI_RUNTIME_CLOUD_VOLCENGINE_OPENSPEECH_API_KEY`
    - Gemini: `NIMI_RUNTIME_CLOUD_GEMINI_BASE_URL` / `NIMI_RUNTIME_CLOUD_GEMINI_API_KEY`
    - Gemini base default: if Gemini key is present and base URL is empty, runtime uses `https://generativelanguage.googleapis.com/v1beta/openai`
  - unified config file: `~/.nimi/config.json` (override with `NIMI_RUNTIME_CONFIG_PATH`)
  - timeout: `NIMI_RUNTIME_AI_HTTP_TIMEOUT` (default `30s`)
  - provider probe interval: `NIMI_RUNTIME_AI_HEALTH_INTERVAL` (default `8s`)
  - model registry persistence path: `NIMI_RUNTIME_MODEL_REGISTRY_PATH`
    - default: `~/.nimi/runtime/model-registry.json`
    - runtime boot loads this file; `RuntimeModelService.PullModel/RemoveModel` will persist updates
  - local runtime state persistence path: `NIMI_RUNTIME_LOCAL_STATE_PATH`
    - default: `~/.nimi/runtime/local-state.json`
    - runtime boot restores local model/service/audit state; local runtime writes state atomically on lifecycle/audit updates
  - model routing examples:
    - `cloud/nimillm/gpt-4o`
    - `cloud/dashscope/qwen-max`
    - `cloud/volcengine/deepseek-v3`
    - `cloud/gpt-4o-mini` (default cloud backend priority: NimiLLM -> DashScope -> Volcengine)
  - dynamic routing with model registry:
    - `RuntimeModelService.PullModel` writes `providerHint` into shared model registry
    - cloud default route (`cloud/<model>`) prefers registry hint over static fallback order
    - if hinted provider is unavailable, runtime auto-switches to first healthy backend and persists updated `providerHint`
    - persisted registry is restored after daemon restart
  - current bridged endpoints:
    - `/v1/chat/completions`
    - `/v1/embeddings`
    - `/v1/audio/transcriptions`
    - `/v1/images/generations`
    - `/v1/audio/speech`
    - `/v1/video/generations` (fallback `/v1/videos/generations`)
  - runtime daemon probes `/healthz` then `/v1/models`; failures switch runtime status to `DEGRADED`
  - per-request timeout policy (`timeout_ms`):
    - `ExecuteScenario(TEXT_GENERATE)`: default `30_000ms`
    - `StreamScenario(TEXT_GENERATE)`: first packet `10_000ms`, default total `120_000ms`
    - `ExecuteScenario(TEXT_EMBED)`: default `20_000ms`
    - `SubmitScenarioJob(IMAGE_GENERATE)`: default `120_000ms`
    - `SubmitScenarioJob(VIDEO_GENERATE)`: default `300_000ms`
    - `StreamScenario(SPEECH_SYNTHESIZE)`: default `45_000ms`
    - `SubmitScenarioJob(SPEECH_TRANSCRIBE)`: default `90_000ms`
  - stream timeout/path failures are emitted as `STREAM_EVENT_FAILED` with mapped reason code (for example `AI_PROVIDER_TIMEOUT`)
- HTTP diagnostics endpoints:
  - `/livez`
  - `/readyz`
  - `/healthz`
  - `/v1/runtime/health` (includes `ai_providers` live snapshots)
- Runtime health state projection aligned with `RuntimeHealthStatus`

Proto contract:

- Contract source: `../spec/runtime/proto-governance.md`
- Concrete proto files: `../proto/runtime/v1/*.proto`
- Runtime config contract: `../spec/runtime/config.md`

## Quick Start

```bash
cd runtime
go run ./cmd/nimi serve
```

Recommended (one-time setup):

```bash
go run ./cmd/nimi config init --json
export NIMI_RUNTIME_CLOUD_GEMINI_API_KEY="<your-gemini-key>"
go run ./cmd/nimi config validate --json
go run ./cmd/nimi serve
```

Config precedence: CLI flags > environment variables > config file > built-in defaults.

`nimi config set` writes are restart-required; runtime does not hot-reload config.
This explicitly includes `providers.*`, `engines.localai.*`, and `engines.nexa.*` changes.

In another terminal:

```bash
cd runtime
go run ./cmd/nimi health
go run ./cmd/nimi health --source grpc
go run ./cmd/nimi health --watch --changes-only --interval 5s
go run ./cmd/nimi health --source grpc --watch --changes-only
go run ./cmd/nimi config get --json
go run ./cmd/nimi config set --set providers.gemini.apiKeyEnv=NIMI_RUNTIME_CLOUD_GEMINI_API_KEY --json
go run ./cmd/nimi config set --set providers.gemini.baseUrl=https://generativelanguage.googleapis.com/v1beta/openai --json
go run ./cmd/nimi providers
go run ./cmd/nimi providers --source grpc
go run ./cmd/nimi providers --watch --changes-only --interval 5s
go run ./cmd/nimi ai generate --prompt "hello runtime"
go run ./cmd/nimi ai generate --route cloud --model-id cloud/gpt-4o-mini --prompt "hello cloud" --json
go run ./cmd/nimi ai stream --prompt "write a short poem"
go run ./cmd/nimi ai stream --route cloud --model-id cloud/gpt-4o-mini --prompt "stream hello" --json
go run ./cmd/nimi ai embed --input "hello world" --input "second text" --json
go run ./cmd/nimi ai image --prompt "a cat in cyberpunk city" --output /tmp/cat.png
go run ./cmd/nimi ai video --prompt "flying over mars valley" --output /tmp/mars.mp4
go run ./cmd/nimi ai tts --text "hello from nimi runtime" --output /tmp/hello.mp3
go run ./cmd/nimi ai stt --audio-file ./sample.wav --mime-type audio/wav --json
go run ./cmd/nimi model list --json
go run ./cmd/nimi model pull --model-ref local/qwen2.5@latest --source official --json
go run ./cmd/nimi model health --model-id local/qwen2.5 --json
go run ./cmd/nimi model remove --model-id local/qwen2.5 --json
go run ./cmd/nimi auth register-app --app-id nimi.desktop --app-instance-id desktop-dev --capability ai.generate --json
go run ./cmd/nimi auth open-session --app-id nimi.desktop --app-instance-id desktop-dev --subject-user-id local-user --ttl-seconds 1800 --json
go run ./cmd/nimi auth register-external --app-id nimi.desktop --external-principal-id openclaw-agent --external-type agent --proof-type ed25519 --json
go run ./cmd/nimi auth open-external-session --app-id nimi.desktop --external-principal-id openclaw-agent --proof test-proof --json
go run ./cmd/nimi app-auth authorize --app-id nimi.desktop --external-principal-id openclaw-agent --external-type agent --subject-user-id local-user --policy-mode preset --preset delegate --scope-catalog-version sdk-v1 --json
go run ./cmd/nimi app-auth validate --app-id nimi.desktop --token-id <token_id> --requested-scope read:chat --json
go run ./cmd/nimi app-auth delegate --app-id nimi.desktop --parent-token-id <token_id> --scope read:chat --json
go run ./cmd/nimi app-auth chain --app-id nimi.desktop --root-token-id <token_id> --json
go run ./cmd/nimi knowledge build --app-id nimi.desktop --subject-user-id local-user --index-id chat-index --source-kind messages --source-uri memory://chat/1 --json
go run ./cmd/nimi knowledge search --app-id nimi.desktop --subject-user-id local-user --index-id chat-index --query hello --top-k 5 --json
go run ./cmd/nimi knowledge delete --app-id nimi.desktop --subject-user-id local-user --index-id chat-index --json
go run ./cmd/nimi app send --from-app-id app.writer --to-app-id app.reader --subject-user-id local-user --message-type note.created --json
go run ./cmd/nimi app watch --app-id app.reader --subject-user-id local-user --json
go run ./cmd/nimi audit events --app-id nimi.desktop --page-size 20 --json
go run ./cmd/nimi audit usage --app-id nimi.desktop --window hour --json
go run ./cmd/nimi audit export --app-id nimi.desktop --format ndjson --json
cat >/tmp/workflow.definition.json <<'EOF'
{
  "workflowType": "image.pipeline",
  "nodes": [
    { "nodeId": "n1", "nodeType": "prompt", "config": { "sleep_ms": 50 } },
    { "nodeId": "n2", "nodeType": "render", "dependsOn": ["n1"], "config": { "sleep_ms": 50 } }
  ]
}
EOF
go run ./cmd/nimi workflow submit --definition-file /tmp/workflow.definition.json --json
go run ./cmd/nimi workflow get --task-id <task_id> --json
go run ./cmd/nimi workflow watch --task-id <task_id> --json
go run ./cmd/nimi workflow cancel --task-id <task_id> --json
```

## Compliance Report

```bash
cd runtime
make proto-baseline
make compliance
cat compliance-report.json
make compliance-gate
```

`providers` notes:

- `--source http|grpc` chooses transport (`grpc` calls `RuntimeAuditService.ListAIProviderHealth`)
- `--watch --changes-only` prints incremental provider changes after the baseline snapshot
- with `--source grpc --watch`, CLI subscribes `RuntimeAuditService.SubscribeAIProviderHealthEvents` (push-based)
- `--interval` is used by HTTP polling watch mode

`health` notes:

- `--watch --changes-only` prints incremental health field changes after the baseline snapshot
- with `--source grpc --watch`, CLI subscribes `RuntimeAuditService.SubscribeRuntimeHealthEvents` (push-based)

`ai *` notes:

- all AI commands support metadata overrides: `--caller-kind --caller-id --surface-id --trace-id`
- default caller metadata is `third-party-service / nimi-cli / runtime-cli`

`workflow *` notes:

- `workflow submit` reads a protojson `WorkflowDefinition` from `--definition-file`
- `workflow watch` streams `RuntimeWorkflowService.SubscribeWorkflowEvents` and returns non-zero when terminal event is `FAILED` or `CANCELED`

`auth *` notes:

- all auth commands support metadata overrides: `--caller-kind --caller-id --surface-id --trace-id`
- use `register-app` before `open-session`
- use `register-external` before `open-external-session`

`app-auth *` notes:

- all app-auth commands support metadata overrides: `--caller-kind --caller-id --surface-id --trace-id`
- `app-auth authorize` supports `preset` and `custom` mode (`--scope` for custom)
- `--resource-selectors-file` accepts protojson `ResourceSelectors`

`knowledge *` notes:

- `knowledge build` requires at least one `--source-uri`
- `--options-file` / `--filters-file` accept protojson `google.protobuf.Struct`

`app *` notes:

- `app send` supports optional structured payload via `--payload-file`
- `app watch` streams `RuntimeAppService.SubscribeAppMessages` events as line-delimited JSON with `--json`

`audit *` notes:

- `audit events` filters by `app_id/domain/reason_code/time window/caller identity`
- `audit usage` aggregates request and token stats by capability/model/window
- `audit export` supports direct stdout payload or `--output` file write

`mod *` notes:

- command group includes `list/install/create/dev/build/publish`
- `mod install` supports local dir, `github:owner/repo[/subpath]`, `mod-circle:<modId>`, and direct `world.nimi.*` selectors
- `mod install --strict-id` enforces exact `modId` match for Mod Circle lookup
- `mod publish` creates a PR in `nimiplatform/mod-circle`; missing token fails with `MOD_PUBLISH_GITHUB_TOKEN_MISSING` and `actionHint=export_GITHUB_TOKEN_then_retry`

## Regenerate gRPC Stubs

```bash
cd ../proto
$(go env GOPATH)/bin/buf generate
```
