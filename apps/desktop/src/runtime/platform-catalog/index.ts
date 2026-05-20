// Platform catalog projection — factory AIProfile surface only.
//
// T4 Fork C: the Nimi App registry / release descriptor catalog projections
// (`PLATFORM_NIMI_APP_REGISTRY_ROWS`, `loadPlatformNimiAppRegistryRows`, etc.)
// are NOT re-exported here. The Desktop Apps bridge sources the Nimi App
// registry from the runtime `~/.nimi/apps/registry.json` + `packages.json`
// projections via the `apps_bridge_projection_get` Tauri command, not from this
// build-time catalog. The generated rows remain in `generated.js` only as a
// catalog projection input to the Rust-side projection writer's sibling and as
// test fixtures; they must not be consumed as the live Apps bridge source.
export {
  PLATFORM_AI_PROFILE_FACTORY_CATALOG,
  PLATFORM_AI_PROFILE_FACTORY_ROWS,
  loadPlatformAIProfileFactoryCatalog,
  loadPlatformAIProfileFactoryRows,
} from './generated.js';
export type { PlatformAIProfileFactoryRow } from './generated.js';
