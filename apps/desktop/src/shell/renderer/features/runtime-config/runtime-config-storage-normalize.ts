import {
  DEFAULT_LOCAL_ENDPOINT_V11,
  normalizeCapabilityV11,
  normalizePageIdV11,
  normalizeRuntimeConfigActionFocus,
  normalizeSourceV11,
  normalizeUiModeV11,
  type RuntimeConfigStateV11,
} from './runtime-config-state-types';
import { parseOptionalJsonObject, type JsonObject } from '@nimiplatform/kit/shell/renderer/bridge';
import type { StoredStateV11 } from './runtime-config-storage-defaults';
import { createDefaultStateV11 } from './runtime-config-storage-defaults';

function normalizeLocalFromAny(
  parsed: StoredStateV11 & JsonObject,
  fallback: RuntimeConfigStateV11,
): RuntimeConfigStateV11['local'] {
  const rawLocalRecord = parseOptionalJsonObject(parsed.local) || {};
  const rawLocal = rawLocalRecord as Partial<RuntimeConfigStateV11['local']>;

  return {
    ...fallback.local,
    ...(rawLocal || {}),
    endpoint: DEFAULT_LOCAL_ENDPOINT_V11,
    models: [],
    nodeMatrix: [],
  };
}

export function normalizeStoredStateV11(parsed: StoredStateV11): RuntimeConfigStateV11 {
  const fallback = createDefaultStateV11();
  const parsedRecord = parsed as StoredStateV11 & JsonObject;
  const local = normalizeLocalFromAny(parsedRecord, fallback);

  const rawActivePage = parsedRecord.activePage || fallback.activePage;

  // Connectors are NOT loaded from localStorage; neither are Runtime endpoint or inventory.
  // Runtime bridge config and Runtime SDK projections are the single source of
  // truth. Renderer storage keeps UI preferences only.
  return {
    version: 12,
    initializedByV11: Boolean(parsed.initializedByV11),
    activePage: normalizePageIdV11(rawActivePage),
    actionFocus: normalizeRuntimeConfigActionFocus(parsedRecord.actionFocus),
    diagnosticsCollapsed: parsed.diagnosticsCollapsed !== false,
    uiMode: normalizeUiModeV11(parsed.uiMode || fallback.uiMode),
    selectedSource: normalizeSourceV11(parsed.selectedSource || fallback.selectedSource),
    activeCapability: normalizeCapabilityV11(parsed.activeCapability || fallback.activeCapability),
    local,
    connectors: [],
    selectedConnectorId: '',
  };
}
