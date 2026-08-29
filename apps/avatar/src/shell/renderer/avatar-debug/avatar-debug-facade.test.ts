import { describe, expect, it, vi } from 'vitest';
import type { AvatarRuntimeCarrier } from '../carrier/avatar-carrier.js';
import { createAvatarDebugSession } from './avatar-debug-session.js';
import { createAvatarDebugFacade } from './avatar-debug-facade.js';
import { AvatarDebugProbeKind, AvatarDebugProbeStatus } from './contract.js';

function testCarrier(): AvatarRuntimeCarrier {
  return {
    model: { modelId: 'avatar-debug-test', kind: 'vrm', runtimeDir: '/avatar/debug-test' },
    committedPresentationSelection: null,
    createDebugSession: vi.fn((input) => createAvatarDebugSession({
      ...input,
      backendKind: 'vrm',
      backend: null,
      resolverEvidence: { packageResolved: true, capabilityProfileResolved: false },
    })),
  } as unknown as AvatarRuntimeCarrier;
}

describe('Avatar-owned debug facade', () => {
  it('stores only bounded redacted App-local results from the real carrier evaluator', async () => {
    const carrier = testCarrier();
    const facade = createAvatarDebugFacade(carrier);

    const result = await facade.requestProbe({ probeKind: AvatarDebugProbeKind.BACKEND_LOAD });
    expect(result.status).toBe(AvatarDebugProbeStatus.FAILED);
    expect(result.reasonCode).toBe('backend_not_loaded');

    const snapshot = await facade.snapshot();
    expect(snapshot.probeResults).toEqual([result]);
    expect(snapshot.replayRefs).toEqual([expect.objectContaining({
      probeId: result.probeId,
      redactionState: 'redacted',
      visibility: 'avatar-debug',
    })]);
    expect(JSON.stringify(snapshot)).not.toMatch(
      /ownerUserId|runtimeSourceRef|localAgentRef|provider|modelId|storage|backend_command/u,
    );
  });

  it('rejects an already-canceled request before carrier evaluation or mutation', async () => {
    const carrier = testCarrier();
    const facade = createAvatarDebugFacade(carrier);
    const controller = new AbortController();
    controller.abort(new Error('canceled'));

    await expect(facade.requestProbe(
      { probeKind: AvatarDebugProbeKind.BACKEND_LOAD },
      { signal: controller.signal },
    )).rejects.toThrow('canceled');
    expect(carrier.createDebugSession).not.toHaveBeenCalled();
    expect((await facade.snapshot()).probeResults).toHaveLength(0);
  });

  it('retains only the latest 64 App-local results and replay refs', async () => {
    const facade = createAvatarDebugFacade(testCarrier());
    for (let index = 0; index < 65; index += 1) {
      await facade.requestProbe({ probeKind: AvatarDebugProbeKind.BACKEND_LOAD });
    }
    const snapshot = await facade.snapshot();
    expect(snapshot.probeResults).toHaveLength(64);
    expect(snapshot.replayRefs).toHaveLength(64);
    expect(snapshot.replayRefs[0]?.probeId).toBe(snapshot.probeResults[0]?.probeId);
  });
});
