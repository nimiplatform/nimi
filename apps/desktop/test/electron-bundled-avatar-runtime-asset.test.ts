import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import test from 'node:test';

import {
  GetAgentPresentationAssetRequest,
  GetAgentPresentationAssetResponse,
} from '../../../sdks/typescript/core-generated/runtime-protobuf/runtime/v1/agent_service';

const METHOD_ID = '/nimi.runtime.v1.RuntimeAgentService/GetAgentPresentationAsset';
const electronMockUrl = `data:text/javascript,${encodeURIComponent(`
  export class BrowserWindow {
    static fromWebContents() { return null; }
  }
  export const screen = {};
`)}`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'electron') {
      return { shortCircuit: true, url: electronMockUrl };
    }
    return nextResolve(specifier, context);
  },
});

const {
  createDesktopBundledAvatarRuntimeAssetResolver,
} = await import('../src-electron/bundled-avatar-host.js');

test('bundled Avatar Runtime asset resolver uses protected unary with only the bound selector', async () => {
  const content = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 0x02, 0x00, 0x00, 0x00]);
  const digest = createHash('sha256').update(content).digest('hex');
  const calls: Array<{
    readonly methodId: string;
    readonly requestBytes: Uint8Array;
    readonly timeoutMs?: number;
  }> = [];
  const resolveRuntimeAsset = createDesktopBundledAvatarRuntimeAssetResolver({
    bundledAvatarUnary: async (input) => {
      calls.push(input);
      return GetAgentPresentationAssetResponse.toBinary(GetAgentPresentationAssetResponse.create({
        assetRef: 'vrm_0123456789ab',
        role: 1,
        backendKind: 1,
        fileName: 'avatar.vrm',
        mediaType: 'model/gltf-binary',
        content,
        sha256: digest,
      }));
    },
  });

  const result = await resolveRuntimeAsset({
    agentId: 'local-agent:alice',
    assetRef: 'vrm_0123456789ab',
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.methodId, METHOD_ID);
  assert.equal(calls[0]?.timeoutMs, 30_000);
  assert.deepEqual(GetAgentPresentationAssetRequest.fromBinary(
    calls[0]?.requestBytes ?? new Uint8Array(),
  ), {
    context: {
      appId: 'nimi.avatar',
      subjectUserId: '',
      ownerUserId: '',
      runtimeSourceRef: '',
      localAgentRef: '',
    },
    agentId: 'local-agent:alice',
    assetRef: 'vrm_0123456789ab',
  });
  assert.deepEqual(result, {
    assetRef: 'vrm_0123456789ab',
    role: 'avatar',
    backendKind: 'vrm',
    fileName: 'avatar.vrm',
    mediaType: 'model/gltf-binary',
    content,
    sha256: digest,
  });
});

test('bundled Avatar Runtime asset resolver rejects a mismatched or corrupted projection', async () => {
  const content = new Uint8Array([1, 2, 3]);
  const resolveRuntimeAsset = createDesktopBundledAvatarRuntimeAssetResolver({
    bundledAvatarUnary: async () => GetAgentPresentationAssetResponse.toBinary(
      GetAgentPresentationAssetResponse.create({
        assetRef: 'vrm_bbbbbbbbbbbb',
        role: 1,
        backendKind: 1,
        fileName: 'avatar.vrm',
        mediaType: 'model/gltf-binary',
        content,
        sha256: createHash('sha256').update(content).digest('hex'),
      }),
    ),
  });

  await assert.rejects(
    resolveRuntimeAsset({
      agentId: 'local-agent:alice',
      assetRef: 'vrm_aaaaaaaaaaaa',
    }),
    /desktop-bundled-avatar-runtime-asset-response-invalid/u,
  );

  const resolveRuntimeAssetWithControlFileName = createDesktopBundledAvatarRuntimeAssetResolver({
    bundledAvatarUnary: async () => GetAgentPresentationAssetResponse.toBinary(
      GetAgentPresentationAssetResponse.create({
        assetRef: 'vrm_aaaaaaaaaaaa',
        role: 1,
        backendKind: 1,
        fileName: 'avatar\u0000.vrm',
        mediaType: 'model/gltf-binary',
        content,
        sha256: createHash('sha256').update(content).digest('hex'),
      }),
    ),
  });

  await assert.rejects(
    resolveRuntimeAssetWithControlFileName({
      agentId: 'local-agent:alice',
      assetRef: 'vrm_aaaaaaaaaaaa',
    }),
    /desktop-bundled-avatar-runtime-asset-response-invalid/u,
  );
});

test('bundled Avatar asset command binds Runtime agent selection to its sender window', async () => {
  const source = await readFile(
    new URL('../src-electron/bundled-avatar-host.ts', import.meta.url),
    'utf8',
  );

  assert.match(
    source,
    /const boundAgentId = recordForSender\(asElectronEvent\(event\)\)\.launchContext\.agentId;/u,
  );
  assert.match(source, /return assetHost\.resolve\(reference, boundAgentId\);/u);
  assert.doesNotMatch(source, /resolveSelectedDataRoot/u);
  assert.match(source, /await assetHost\.close\(\);/u);
  assert.match(
    source,
    /if \(!initialNavigationComplete\) return;\s+event\.preventDefault\(\);\s+invalidate\(\);\s+if \(!window\.isDestroyed\(\)\) window\.close\(\);/u,
  );
});
