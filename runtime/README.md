# runtime

Nimi Runtime is the local Go daemon and CLI behind Nimi's app-facing AI surface.

It owns:
- local and cloud execution
- streaming and health
- model lifecycle
- knowledge, app messaging, and audit

## Released Binary First

If you are using Nimi as a product, use the installed `nimi` binary.

On a build with an admitted background/service controller:

```bash
nimi start

nimi doctor
nimi status
```

Foreground/developer path:

```bash
nimi serve
```

Connector custody and ModelAsset/Loadout selection are exposed only through
Desktop's verified protected Runtime surface. The CLI and standalone SDK
clients do not own parallel provider credentials, model selection, or
generation routing.

Core command groups:
- `serve`
- `start`
- `doctor`
- `init`
- `version`
- `status`
- `stop`
- `logs`

Advanced runtime groups:
- `knowledge`
- `app`
- `audit`
- `health`
- `config`

Run `nimi <command> --help` for the current command contract.

App-facing inference uses the SDK's typed Runtime clients after Desktop's
verified protected surface has committed Connector and Loadout intent.

## Source Development

If you are developing Nimi Runtime itself from this repo, use the source entrypoint:

```bash
cd runtime
go run ./cmd/nimi serve
```

`doctor`, `status`, and `health` use only an admitted daemon manager or
service controller. They fail explicitly on builds without that background
topology; they do not probe a protected Runtime method or invent a fallback
process.

Production Runtime private configuration is service-principal-owned protected
state. `~/.nimi/runtime/config.json`, `~/.nimi/config.json`, and
`NIMI_RUNTIME_CONFIG_PATH` are not production discovery or migration inputs.
Product data discovery starts only at `~/.nimi/nimi.json`; Runtime independently
validates its `dataRoot.path` and retains only derived verification state.

## Runtime Surface

Registered public runtime gRPC services currently include:
- `RuntimeAiService` — local and cloud AI execution, streaming, multimodal
- `RuntimeAiRealtimeService` — duplex realtime text/audio session surface
- `RuntimeLocalService` — local model inventory, Loadouts, acquisition, and supervision
- `RuntimeAgentService` — live agent execution, hook lifecycle, and Runtime-mediated LocalAgent Memory
- `RuntimeConnectorService` — provider connector lifecycle, credential hosting
- `RuntimeAuthService` — authentication and token management
- `RuntimeAppService` — app messaging and registration
- `RuntimeAuditService` — audit logging and replay

Notes:
- Cognition is an in-process owner reached only through typed Runtime-owned bridges;
  the pre-V1 generic Cognition gRPC service and Knowledge CLI are not public surfaces.
- standard `grpc.health.v1.Health` probing is also registered for daemon health, but
  it is not part of the runtime-owned proto service inventory above.

The explicit nonproduction foreground configuration may expose:
- gRPC on `127.0.0.1:46371` by default
- HTTP health endpoints on `127.0.0.1:46372` by default

Production does not open these ordinary listeners. Desktop reaches protected
Runtime methods through the verified native transport.

CLI runtime management semantics:
- `serve`: foreground runtime with direct logs
- `start`: admitted background/service start, otherwise bounded unsupported failure
- `status`: process status + reachability summary
- `health`: sanitized daemon process or protected-service health summary
- `logs`: managed background log tail

Health endpoints:
- `GET /livez`
- `GET /readyz`
- `GET /healthz`
- `GET /v1/runtime/health`

## Config Notes

- Product Control has the fixed path `~/.nimi/nimi.json`; only its
  `dataRoot.path` selects product data storage.
- Production Runtime private configuration has an OS-specific protected path
  that is not a Desktop, SDK, or public CLI interface.
- The source-development portable config surface is non-production only and
  exists only when `NIMI_RUNTIME_CONFIG_PATH` explicitly names a non-retired
  path. It has no default discovery, rejects `~/.nimi/runtime/config.json`, and
  rejects Product Control-owned `dataRootRef` and `managedRoots` fields.
- Runtime managed roots are derived from the selected data root and protected
  state cannot select or override it.
- Provider credentials may use `apiKey` or `apiKeyEnv`, but never both
- User-facing setup should prefer env-backed credentials; inline `apiKey` is fallback-only
- `config` changes that touch runtime wiring remain restart-scoped
- Connector/provider authority is the repo-local `.nimi` spec surface:
  `.nimi/spec/runtime/ai-provider.authority.yaml`, `.nimi/spec/runtime/model-catalog.authority.yaml`,
  and imported kernel provider catalog/capability tables. Runtime catalog source
  files and generated snapshots are support/projection inputs, not standalone
  product truth.

## Tests

From the repository root:

```bash
pnpm test:runtime:go
pnpm test:runtime:python
```

Provider live smokes are opt-in and require their corresponding
`NIMI_LIVE_*` credentials:

```bash
pnpm test:runtime:live
```

## Proto baseline

```bash
cd runtime
make proto-baseline
```

`make proto-baseline` 会把当前 proto contract 快照写入
`runtime/proto/runtime-v1.baseline.binpb`。当前 AI baseline 已采用 typed
`ScenarioOutput` 和 typed `ScenarioStreamDelta` delta oneof；如果这些 wire
contract 发生有意变化，必须先完成 runtime / sdk 对齐，再重建 baseline。

## References

- Runtime reference: [docs/reference/runtime.md](../docs/reference/runtime.md)
- Runtime domain authority: [.nimi/spec/runtime](../.nimi/spec/runtime) — one
  container per area; `rpc-foundations.authority.yaml` and
  `protected-session.authority.yaml` carry the transport and session contracts
  that the per-file `kernel/` tree used to hold.
- Contributor workflow: [CONTRIBUTING.md](../CONTRIBUTING.md)
