# Relay IPC Channels

> Auto-generated from `tables/ipc-channels.yaml` — do not edit manually
| Channel | Type | Module | SDK Method | Rule |
|---------|------|--------|------------|------|
| `relay:ai:generate` | unary | ai | `runtime.ai.text.generate` | RL-IPC-006 |
| `relay:ai:stream:open` | stream-open | ai | `runtime.ai.text.stream` | RL-IPC-006 |
| `relay:ai:stream:cancel` | stream-cancel | ai | — | RL-IPC-006 |
| `relay:stream:chunk` | event (main→renderer) | stream | — | RL-IPC-003 |
| `relay:stream:end` | event (main→renderer) | stream | — | RL-IPC-003 |
| `relay:stream:error` | event (main→renderer) | stream | — | RL-IPC-003 |
| `relay:media:tts:synthesize` | unary | media | `runtime.media.tts.synthesize` | RL-IPC-007 |
| `relay:media:tts:voices` | unary | media | `runtime.media.tts.listVoices` | RL-IPC-007 |
| `relay:media:stt:transcribe` | unary | media | `runtime.media.stt.transcribe` | RL-IPC-007 |
| `relay:media:image:generate` | unary | media | `runtime.media.image.generate` | RL-IPC-007 |
| `relay:media:video:generate` | unary | media | `runtime.media.video.generate` | RL-IPC-007 |
| `relay:media:video:job:subscribe` | stream-open | media | `runtime.media.jobs.subscribe` | RL-IPC-007 |
| `relay:media:video:job:get` | unary | media | `runtime.media.jobs.get` | RL-IPC-007 |
| `relay:media:video:job:artifacts` | unary | media | `runtime.media.jobs.getArtifacts` | RL-IPC-007 |
| `relay:media:video:job:cancel` | stream-cancel | media | — | RL-IPC-007 |
| `relay:agent:list` | unary | agent | — | RL-IPC-008 |
| `relay:agent:get` | unary | agent | — | RL-IPC-008 |
| `relay:realtime:message` | event (main→renderer) | stream | — | RL-IPC-009 |
| `relay:realtime:presence` | event (main→renderer) | stream | — | RL-IPC-009 |
| `relay:realtime:status` | event (main→renderer) | stream | — | RL-IPC-009 |
| `relay:realtime:subscribe` | unary | realtime | — | RL-IPC-009 |
| `relay:realtime:unsubscribe` | unary | realtime | — | RL-IPC-009 |
| `relay:chat:send` | unary | chat-pipeline | — | RL-PIPE-001 |
| `relay:chat:cancel` | unary | chat-pipeline | — | RL-PIPE-005 |
| `relay:chat:history` | unary | chat-pipeline | — | RL-PIPE-002 |
| `relay:chat:clear` | unary | chat-pipeline | — | RL-PIPE-002 |
| `relay:chat:settings:get` | unary | chat-pipeline | — | RL-PIPE-006 |
| `relay:chat:settings:set` | unary | chat-pipeline | — | RL-PIPE-006 |
| `relay:chat:proactive:toggle` | unary | chat-pipeline | — | RL-PIPE-007 |
| `relay:chat:turn:phase` | event (main→renderer) | stream | — | RL-PIPE-001 |
| `relay:chat:messages` | event (main→renderer) | stream | — | RL-PIPE-005 |
| `relay:chat:sessions` | event (main→renderer) | stream | — | RL-PIPE-002 |
| `relay:chat:status-banner` | event (main→renderer) | stream | — | RL-PIPE-001 |
| `relay:chat:prompt-trace` | event (main→renderer) | stream | — | RL-PIPE-003 |
| `relay:chat:turn-audit` | event (main→renderer) | stream | — | RL-PIPE-001 |
| `relay:chat:input-text` | event (main→renderer) | stream | — | RL-PIPE-001 |
| `relay:chat:selected-session` | event (main→renderer) | stream | — | RL-PIPE-002 |
| `relay:auth:status` | unary | auth | — | RL-BOOT-005 |
| `relay:auth:status` | event (main→renderer) | stream | — | RL-BOOT-005 |
| `relay:model:list` | unary | model | `runtime.model.list` | RL-IPC-010 |
| `relay:model:pull` | unary | model | `runtime.model.pull` | RL-IPC-010 |
| `relay:model:remove` | unary | model | `runtime.model.remove` | RL-IPC-010 |
| `relay:model:health` | unary | model | `runtime.model.checkHealth` | RL-IPC-010 |
| `relay:local:models:list` | unary | local | `runtime.local.listLocalModels` | RL-IPC-011 |
| `relay:local:models:verified` | unary | local | `runtime.local.listVerifiedModels` | RL-IPC-011 |
| `relay:local:models:catalog-search` | unary | local | `runtime.local.searchCatalogModels` | RL-IPC-011 |
| `relay:local:models:install-plan` | unary | local | `runtime.local.resolveModelInstallPlan` | RL-IPC-011 |
| `relay:local:models:install` | unary | local | `runtime.local.installLocalModel` | RL-IPC-011 |
| `relay:local:models:install-verified` | unary | local | `runtime.local.installVerifiedModel` | RL-IPC-011 |
| `relay:local:models:import` | unary | local | `runtime.local.importLocalModel` | RL-IPC-011 |
| `relay:local:models:remove` | unary | local | `runtime.local.removeLocalModel` | RL-IPC-011 |
| `relay:local:models:start` | unary | local | `runtime.local.startLocalModel` | RL-IPC-011 |
| `relay:local:models:stop` | unary | local | `runtime.local.stopLocalModel` | RL-IPC-011 |
| `relay:local:models:health` | unary | local | `runtime.local.checkLocalModelHealth` | RL-IPC-011 |
| `relay:local:models:warm` | unary | local | `runtime.local.warmLocalModel` | RL-IPC-011 |
| `relay:local:device-profile` | unary | local | `runtime.local.collectDeviceProfile` | RL-IPC-011 |
| `relay:local:profile:resolve` | unary | local | `runtime.local.resolveProfile` | RL-IPC-011 |
| `relay:local:catalog:nodes` | unary | local | `runtime.local.listNodeCatalog` | RL-IPC-011 |
| `relay:connector:create` | unary | connector | `runtime.connector.createConnector` | RL-IPC-012 |
| `relay:connector:get` | unary | connector | `runtime.connector.getConnector` | RL-IPC-012 |
| `relay:connector:list` | unary | connector | `runtime.connector.listConnectors` | RL-IPC-012 |
| `relay:connector:update` | unary | connector | `runtime.connector.updateConnector` | RL-IPC-012 |
| `relay:connector:delete` | unary | connector | `runtime.connector.deleteConnector` | RL-IPC-012 |
| `relay:connector:test` | unary | connector | `runtime.connector.testConnector` | RL-IPC-012 |
| `relay:connector:models` | unary | connector | `runtime.connector.listConnectorModels` | RL-IPC-012 |
| `relay:connector:provider-catalog` | unary | connector | `runtime.connector.listProviderCatalog` | RL-IPC-012 |
| `relay:connector:catalog-providers` | unary | connector | `runtime.connector.listModelCatalogProviders` | RL-IPC-012 |
| `relay:connector:catalog-provider-models` | unary | connector | `runtime.connector.listCatalogProviderModels` | RL-IPC-012 |
| `relay:connector:catalog-model-detail` | unary | connector | `runtime.connector.getCatalogModelDetail` | RL-IPC-012 |
| `relay:connector:catalog-provider:upsert` | unary | connector | `runtime.connector.upsertModelCatalogProvider` | RL-IPC-012 |
| `relay:connector:catalog-provider:delete` | unary | connector | `runtime.connector.deleteModelCatalogProvider` | RL-IPC-012 |
| `relay:connector:catalog-overlay:upsert` | unary | connector | `runtime.connector.upsertCatalogModelOverlay` | RL-IPC-012 |
| `relay:connector:catalog-overlay:delete` | unary | connector | `runtime.connector.deleteCatalogModelOverlay` | RL-IPC-012 |
| `relay:desktop:open-config` | unary | desktop | — | RL-IPC-013 |
| `relay:config` | unary | config | — | RL-CORE-003 |
| `relay:health` | unary | health | `runtime.health` | RL-IPC-002 |
