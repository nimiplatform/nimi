import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function createZhiyuLiveRuntimeFixtureAcceptanceInitScript(fixture) {
  const sourceProjection = {
    transport: 'electron-ipc',
    ready: true,
    reasonCode: 'runtime-source-projected',
    actionHint: 'discover_runtime_owned_local_agent',
    source: 'sdk-fixture',
    message: 'Runtime source projection was supplied by the SDK live fixture.',
    ownerUserId: fixture.ownerUserId,
    runtimeSourceRef: fixture.runtimeSourceRef,
    sourceRef: {
      kind: fixture.sourceRef?.kind,
      worldId: fixture.sourceRef?.worldId,
      sourceId: fixture.sourceRef?.sourceId,
      sourceContentHash: fixture.sourceRef?.sourceContentHash,
    },
  };
  return `
    (() => {
      const sourceProjection = ${JSON.stringify(sourceProjection)};
      Object.defineProperty(window, '__NIMI_ZHIYU_ACCEPTANCE_SOURCE_PROJECTION__', {
        value: sourceProjection,
        configurable: true
      });
    })();
  `;
}

export function createZhiyuLiveRuntimeAcceptanceRendererUrl(root) {
  const url = new URL(pathToFileURL(path.join(root, 'dist', 'index.html')).toString());
  url.searchParams.set('nimiElectronSdkAcceptance', '1');
  return url.toString();
}
