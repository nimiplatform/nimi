import { hasElectronRuntime } from '@nimiplatform/kit/shell/renderer/bridge';
import {
  createRuntimeRouteModelPickerProviderCache,
  type RouteModelPickerDataProvider,
} from '@nimiplatform/kit/features/model-picker/runtime';
import {
  createNimiRuntimeRouteOptionsHostDeps,
  listNimiRuntimeRouteOptionsWithHost,
  type Runtime,
  type NimiListRuntimeRouteOptionsInput,
  type NimiRuntimeRouteOptionsSnapshot,
} from '@nimiplatform/sdk/runtime';
import { getZhiyuRuntime as getSharedZhiyuRuntime } from '../auth/runtime-platform';

const ZHIYU_AGENT_CENTER_ROUTE_OPTIONS_SCOPE = Object.freeze({
  surfaceId: 'zhiyu.agent-center.model-picker',
});

function getZhiyuRuntime(): Runtime {
  if (typeof window === 'undefined' || !hasElectronRuntime()) {
    throw new Error('Electron Runtime bridge is not available for Zhiyu Agent Center model picker.');
  }
  return getSharedZhiyuRuntime();
}

async function loadZhiyuRuntimeRouteOptions(
  input: NimiListRuntimeRouteOptionsInput,
): Promise<NimiRuntimeRouteOptionsSnapshot> {
  const runtime = getZhiyuRuntime();
  return listNimiRuntimeRouteOptionsWithHost({
    capability: input.capability,
    targetId: input.targetId,
    selectedTargetRef: input.selectedTargetRef,
  }, createNimiRuntimeRouteOptionsHostDeps(runtime, {
    scope: ZHIYU_AGENT_CENTER_ROUTE_OPTIONS_SCOPE,
  }));
}

const resolveZhiyuRouteModelPickerProvider = createRuntimeRouteModelPickerProviderCache({
  loadOptions: loadZhiyuRuntimeRouteOptions,
  unavailableMessage: 'Zhiyu Runtime route model picker requires Electron Runtime bridge.',
});

export function getZhiyuRouteModelPickerProvider(capability: string): RouteModelPickerDataProvider | null {
  return resolveZhiyuRouteModelPickerProvider(capability);
}
