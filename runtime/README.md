# runtime

Nimi Runtime is the local Go daemon and CLI behind Nimi's app-facing AI surface.

It owns:
- local and cloud execution
- streaming and health
- model lifecycle
- workflow, knowledge, app messaging, and audit

## Released Binary First

If you are using Nimi as a product, use the installed `nimi` binary.

First-run path:

```bash
nimi start

nimi doctor
nimi status
nimi run "What is Nimi?"
```

Foreground/developer path:

```bash
nimi serve
```

Cloud path:

```bash
nimi run "Hello from Nimi" --provider gemini
```

Or save a reusable default:

```bash
nimi provider set gemini --api-key-env NIMI_RUNTIME_CLOUD_GEMINI_API_KEY --default
export NIMI_RUNTIME_CLOUD_GEMINI_API_KEY="<your-key>"
nimi run "Hello from Nimi" --cloud
```

Core command groups:
- `serve`
- `start`
- `doctor`
- `init`
- `version`
- `run`
- `model`
- `provider`
- `status`
- `stop`
- `logs`

Advanced runtime groups:
- `ai`
- `app-auth`
- `knowledge`
- `app`
- `audit`
- `workflow`
- `health`
- `providers`
- `config`
- `mod`

Run `nimi <command> --help` for the current command contract.

High-level onboarding stays on `nimi run` and SDK `runtime.generate()/stream()`.
Fully-qualified explicit model ids stay on lower-level surfaces such as `nimi ai text-generate --model-id ...` and `runtime.ai.text.generate({ model: ... })`.

## Source Development

If you are developing Nimi Runtime itself from this repo, use the source entrypoint:

```bash
cd runtime
go run ./cmd/nimi serve
```

Useful source-development commands:

```bash
cd runtime
go run ./cmd/nimi doctor --json
go run ./cmd/nimi health --source grpc
go run ./cmd/nimi version --json
go run ./cmd/nimi model list --json
go run ./cmd/nimi provider list --json
go run ./cmd/nimi run "hello runtime" --yes --json
```

The source-development and scripted paths may use `--yes` for repeatability.
That flag is not part of the public first-run happy path, which stays on bare `nimi run "<prompt>"`.

Config precedence stays:

`CLI flags > environment variables > ~/.nimi/config.json > built-in defaults`

## Runtime Surface

Registered public runtime gRPC services currently include:
- `RuntimeAiService` — local and cloud AI execution, streaming, multimodal
- `RuntimeAiRealtimeService` — duplex realtime text/audio session surface
- `RuntimeWorkflowService` — workflow DAG orchestration
- `RuntimeModelService` — model lifecycle, listing, routing
- `RuntimeLocalService` — local execution, supervision, provider health
- `RuntimeAgentCoreService` — live agent execution, hook lifecycle, canonical review
- `RuntimeConnectorService` — provider connector lifecycle, credential hosting
- `RuntimeGrantService` — permission and grant management
- `RuntimeAuthService` — authentication and token management
- `RuntimeCognitionService` — runtime-facing memory and knowledge bank/page surface
- `RuntimeAppService` — app messaging and registration
- `RuntimeAuditService` — audit logging and replay

Notes:
- `RuntimeKnowledgeService` is not a standalone registered public gRPC service; its
  runtime-facing knowledge/page surface is absorbed by `RuntimeCognitionService`.
- standard `grpc.health.v1.Health` probing is also registered for daemon health, but
  it is not part of the runtime-owned proto service inventory above.

The runtime exposes:
- gRPC on `127.0.0.1:46371` by default
- HTTP health endpoints on `127.0.0.1:46372` by default

CLI runtime management semantics:
- `serve`: foreground runtime with direct logs
- `start`: background runtime with readiness probe
- `status`: process status + reachability summary
- `health`: detailed runtime health payload
- `logs`: managed background log tail

Health endpoints:
- `GET /livez`
- `GET /readyz`
- `GET /healthz`
- `GET /v1/runtime/health`

## Config Notes

- Canonical config path: `~/.nimi/config.json`
- Provider credentials may use `apiKey` or `apiKeyEnv`, but never both
- User-facing setup should prefer env-backed credentials; inline `apiKey` is fallback-only
- `config` changes that touch runtime wiring remain restart-scoped

## Compliance

```bash
cd runtime
make proto-baseline
make compliance
make compliance-gate
```

`make proto-baseline` 会把当前 proto contract 快照写入
`runtime/proto/runtime-v1.baseline.binpb`。当前 AI baseline 已采用 typed
`ScenarioOutput` 和 typed `ScenarioStreamDelta` delta oneof；如果这些 wire
contract 发生有意变化，必须先完成 runtime / sdk 对齐，再重建 baseline。

## References

- Runtime reference: [docs/reference/runtime.md](../docs/reference/runtime.md)
- Runtime domain spec: [spec/runtime](../spec/runtime)
- Runtime kernel contracts: [spec/runtime/kernel](../spec/runtime/kernel)
- Contributor workflow: [CONTRIBUTING.md](../CONTRIBUTING.md)
