import type { AvatarRuntimeCarrier } from '../carrier/avatar-carrier.js';
import { ulid } from '../infra/ids.js';
import {
  evidenceRefsForAvatarDebugSession,
  type AvatarDebugSession,
} from './avatar-debug-session.js';
import {
  AvatarDebugProbeStatus,
  avatarDebugTimestamp,
  type AvatarDebugCallOptions,
  type AvatarDebugFacade,
  type AvatarDebugProbeResult,
  type AvatarDebugReplayRef,
} from './contract.js';

const MAX_DEBUG_RESULTS = 64;

// @nimi-authority: rule.nimi.avatar.embodiment.r029
export function createAvatarDebugFacade(carrier: AvatarRuntimeCarrier): AvatarDebugFacade {
  const results: AvatarDebugProbeResult[] = [];
  const replays: AvatarDebugReplayRef[] = [];

  const snapshot = () => Object.freeze({
    probeResults: Object.freeze([...results]),
    replayRefs: Object.freeze([...replays]),
    observedAt: avatarDebugTimestamp(),
  });

  return Object.freeze({
    async snapshot(options?: AvatarDebugCallOptions) {
      assertCurrent(options);
      return snapshot();
    },
    async requestProbe(input, options?: AvatarDebugCallOptions) {
      assertCurrent(options);
      const probeId = `avatar-debug-probe-${ulid()}`;
      const session = carrier.createDebugSession({
        debugSessionId: probeId,
        probe: { probeId, probeKind: input.probeKind },
        avatarInstanceId: input.avatarInstanceId ?? null,
        avatarPackageRef: carrier.committedPresentationSelection?.avatarAssetRef
          ?? carrier.model.modelId,
        observedAt: new Date().toISOString(),
      });
      assertCurrent(options);
      const result = Object.freeze({
        probeId,
        probeKind: session.probeKind,
        status: probeStatus(session),
        observedAt: timestampFromIso(session.observedAt),
        evidenceRefs: Object.freeze(evidenceRefsForAvatarDebugSession(session)),
        reasonCode: session.evidence.reasonCode ?? '',
        resultId: `avatar-debug-result-${ulid()}`,
      });
      results.push(result);
      replays.push(Object.freeze({
        probeId,
        replayRef: `avatar-debug-replay:${result.resultId}`,
        redactionState: 'redacted' as const,
        visibility: 'avatar-debug' as const,
        linkedAt: result.observedAt,
      }));
      if (results.length > MAX_DEBUG_RESULTS) results.splice(0, results.length - MAX_DEBUG_RESULTS);
      if (replays.length > MAX_DEBUG_RESULTS) replays.splice(0, replays.length - MAX_DEBUG_RESULTS);
      return result;
    },
  });
}

function probeStatus(session: AvatarDebugSession): AvatarDebugProbeStatus {
  switch (session.evidence.status) {
    case 'passed': return AvatarDebugProbeStatus.PASSED;
    case 'failed': return AvatarDebugProbeStatus.FAILED;
    case 'unsupported': return AvatarDebugProbeStatus.UNSUPPORTED;
    case 'invalid': return AvatarDebugProbeStatus.INVALID;
  }
}

function timestampFromIso(value: string) {
  const millis = Date.parse(value);
  return avatarDebugTimestamp(Number.isFinite(millis) ? millis : Date.now());
}

function assertCurrent(options?: AvatarDebugCallOptions): void {
  if (options?.signal?.aborted) {
    throw options.signal.reason ?? new DOMException('Avatar diagnostics canceled', 'AbortError');
  }
}
