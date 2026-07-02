import { hasElectronRuntime } from '@nimiplatform/kit/shell/renderer/bridge';
import type { ZhiyuEvidence } from '../app/evidence';
import {
  readZhiyuLiveRuntimeFixtureProjection,
  sourceStatusFromZhiyuLiveRuntimeFixture,
} from './live-runtime-fixture';

export type ZhiyuRuntimeSourceStatus = ZhiyuEvidence['source'];

export function probeZhiyuRuntimeSourceProjection(): ZhiyuRuntimeSourceStatus {
  if (typeof window === 'undefined' || !hasElectronRuntime()) {
    return sourceUnavailable({
      reasonCode: 'electron-runtime-bridge-unavailable',
      actionHint: 'restart_zhiyu_electron_shell',
      source: 'renderer',
      message: 'Electron Runtime bridge is not available.',
    });
  }

  const fixtureSource = sourceStatusFromZhiyuLiveRuntimeFixture(readZhiyuLiveRuntimeFixtureProjection());
  if (fixtureSource) {
    return fixtureSource;
  }

  return sourceUnavailable({
    reasonCode: 'zhiyu-admitted-source-projection-required',
    actionHint: 'await_admitted_runtime_source_projection',
    source: 'renderer',
    message: 'Zhiyu requires an admitted Runtime source projection before LocalAgent discovery.',
  });
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
