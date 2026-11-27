# proto

Shared protocol sources for public repository.

Current state:

- Runtime V1 proto sources are in `proto/runtime/v1/`.
- Product protocol authority is tracked under `.nimi/spec/**`; generated baselines and this README are not authority.

Files (37 `.proto` sources under `proto/runtime/v1/`):

- Core & governance: `common.proto`, `auth.proto`, `account.proto`, `audit.proto`, `capability_configuration.proto`, `delegated_control.proto`, `development.proto`, `runtime_service_control.proto`
- AI & media: `ai.proto`, `ai_realtime.proto`, `ai_scheduling.proto`, `artifact_service.proto`, `connector.proto`, `realtime_control.proto`, `voice.proto`
- Local runtime: `local_runtime.proto`, `local_runtime_asset_catalog.proto`, `local_runtime_device_environment.proto`, `local_runtime_execution_profile.proto`, `local_runtime_recommendation.proto`
- Agents & Cognition Memory: `agent_common.proto`, `agent_configure.proto`, `agent_embodiment.proto`, `agent_life.proto`, `agent_presentation.proto`, `agent_service.proto`, `agent_session.proto`, `agent_source_materialization.proto`, `agent_utopia.proto`, `agent_work.proto`, `cognition_memory.proto`, `external_agent.proto`
- Apps, integrations & remote access: `app.proto`, `app_activity.proto`, `integration.proto`, `realm_realtime.proto`, `remote_access.proto`

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
