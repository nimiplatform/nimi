import { hasElectronRuntime } from '@nimiplatform/kit/shell/renderer/bridge';
import type { ZhiyuEvidence } from '../app/evidence';

export type ZhiyuRuntimeSourceStatus = ZhiyuEvidence['source'];

const ELECTRON_SDK_ACCEPTANCE_QUERY = 'nimiElectronSdkAcceptance';

declare global {
  interface Window {
    __NIMI_ZHIYU_ACCEPTANCE_SOURCE_PROJECTION__?: unknown;
  }
}

export function probeZhiyuRuntimeSourceProjection(): ZhiyuRuntimeSourceStatus {
  if (typeof window === 'undefined' || !hasElectronRuntime()) {
    return sourceUnavailable({
      reasonCode: 'electron-runtime-bridge-unavailable',
      actionHint: 'restart_zhiyu_electron_shell',
      source: 'renderer',
      message: 'Electron Runtime bridge is not available.',
    });
  }

  const acceptanceSource = readAcceptanceSourceProjection();
  if (acceptanceSource) {
    return acceptanceSource;
  }

  return sourceUnavailable({
    reasonCode: 'zhiyu-admitted-source-projection-required',
    actionHint: 'await_admitted_runtime_source_projection',
    source: 'renderer',
    message: 'Zhiyu requires an admitted Runtime source projection before LocalAgent discovery.',
  });
}

function readAcceptanceSourceProjection(): ZhiyuRuntimeSourceStatus | null {
  if (!isElectronSdkAcceptanceRenderer()) {
    return null;
  }
  const candidate = typeof window.__NIMI_ZHIYU_ACCEPTANCE_SOURCE_PROJECTION__ === 'function'
    ? (window.__NIMI_ZHIYU_ACCEPTANCE_SOURCE_PROJECTION__ as () => unknown)()
    : window.__NIMI_ZHIYU_ACCEPTANCE_SOURCE_PROJECTION__;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return null;
  }
  const projection = candidate as ZhiyuRuntimeSourceStatus;
  if (
    projection.transport !== 'electron-ipc'
    || projection.ready !== true
    || !stringOr(projection.ownerUserId, '')
    || !stringOr(projection.runtimeSourceRef, '')
    || !projection.sourceRef
  ) {
    return null;
  }
  return projection;
}

function isElectronSdkAcceptanceRenderer(): boolean {
  return new URL(window.location.href).searchParams.get(ELECTRON_SDK_ACCEPTANCE_QUERY) === '1';
}

function sourceUnavailable(input: {
  readonly reasonCode: string;
  readonly actionHint: string;
  readonly source: string;
  readonly message: string;
}): ZhiyuRuntimeSourceStatus {
  return {
    transport: 'electron-ipc',
    ready: false,
    reasonCode: input.reasonCode,
    actionHint: input.actionHint,
    source: input.source,
    message: input.message,
    ownerUserId: null,
    runtimeSourceRef: null,
    sourceRef: null,
  };
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}
