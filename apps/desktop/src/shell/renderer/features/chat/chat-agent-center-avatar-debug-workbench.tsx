import { useCallback, useMemo, useState } from 'react';
import { getPlatformClient } from '@nimiplatform/sdk';
import {
  AvatarDebugProbeKind,
  AvatarDebugProbeStatus,
  AvatarDebugRequestedBy,
  type AvatarDebugProbeResultEnvelope,
  type AvatarDebugReplayRef,
  type GetAvatarDebugSnapshotResponse,
} from '@nimiplatform/sdk/runtime';
import type { UseAgentConversationPresentationInput } from './chat-agent-shell-presentation-types';
import type { AgentCenterAvatarPackageModule } from './chat-agent-center-avatar-config-types';

export type AvatarDebugWorkbenchProbe = {
  kind: AvatarDebugProbeKind;
  label: string;
  summary: string;
};

export type AvatarDebugWorkbenchLaunchHealth = {
  status: 'ready' | 'checking' | 'needs_package' | 'needs_anchor' | 'runtime_unavailable';
  label: string;
  detail: string;
};

export type AvatarDebugWorkbenchDiagnostics = {
  backendKind: string;
  packageRefState: 'linked' | 'missing';
  profileRefState: 'linked' | 'pending';
  generatedMotionPolicy: string;
  debugProfile: string;
};

type AgentCenterAvatarDebugWorkbenchProps = {
  input: UseAgentConversationPresentationInput;
  avatarPackageConfig: AgentCenterAvatarPackageModule | null;
  avatarPackageValid: boolean;
  avatarPackageChecking: boolean;
  validationMessage: string | null;
};

const PROBES: readonly AvatarDebugWorkbenchProbe[] = [
  {
    kind: AvatarDebugProbeKind.PACKAGE_VALIDATION,
    label: 'Package',
    summary: 'Validate the selected avatar package record.',
  },
  {
    kind: AvatarDebugProbeKind.LAUNCH_READINESS,
    label: 'Launch',
    summary: 'Check readiness for the current conversation anchor.',
  },
  {
    kind: AvatarDebugProbeKind.BACKEND_LOAD,
    label: 'Backend',
    summary: 'Ask Runtime for backend load evidence.',
  },
  {
    kind: AvatarDebugProbeKind.CAPABILITY_PROFILE,
    label: 'Profile',
    summary: 'Inspect capability profile evidence.',
  },
  {
    kind: AvatarDebugProbeKind.ROUTE_SUPPORT_MATRIX,
    label: 'Routes',
    summary: 'Inspect route support for this backend.',
  },
  {
    kind: AvatarDebugProbeKind.GENERATED_MOTION,
    label: 'Motion',
    summary: 'Check generated motion support.',
  },
  {
    kind: AvatarDebugProbeKind.EMOTION_EXPRESSION,
    label: 'Emotion',
    summary: 'Check emotion and expression support.',
  },
  {
    kind: AvatarDebugProbeKind.SPEECH_LIPSYNC,
    label: 'Speech',
    summary: 'Check speech and lipsync support.',
  },
  {
    kind: AvatarDebugProbeKind.WINDOW_HIT_REGION,
    label: 'Window',
    summary: 'Check carrier window diagnostics.',
  },
];

export const AVATAR_DEBUG_WORKBENCH_PROBES = PROBES;

const REQUIRED_EVIDENCE_REF_COUNTS_BY_PROBE_KIND: Partial<Record<AvatarDebugProbeKind, number>> = {
  [AvatarDebugProbeKind.PACKAGE_VALIDATION]: 2,
  [AvatarDebugProbeKind.LAUNCH_READINESS]: 2,
  [AvatarDebugProbeKind.BACKEND_LOAD]: 2,
  [AvatarDebugProbeKind.CAPABILITY_PROFILE]: 2,
  [AvatarDebugProbeKind.ROUTE_SUPPORT_MATRIX]: 2,
  [AvatarDebugProbeKind.GENERATED_MOTION]: 2,
  [AvatarDebugProbeKind.EMOTION_EXPRESSION]: 2,
  [AvatarDebugProbeKind.SPEECH_LIPSYNC]: 2,
  [AvatarDebugProbeKind.WINDOW_HIT_REGION]: 1,
};

export function buildAvatarDebugWorkbenchLaunchHealth(input: {
  avatarPackageValid: boolean;
  avatarPackageChecking: boolean;
  conversationAnchorId: string | null;
  routeReady: boolean;
}): AvatarDebugWorkbenchLaunchHealth {
  if (!input.conversationAnchorId) {
    return {
      status: 'needs_anchor',
      label: 'Needs anchor',
      detail: 'Open an agent conversation before running avatar debug probes.',
    };
  }
  if (input.avatarPackageChecking) {
    return {
      status: 'checking',
      label: 'Checking',
      detail: 'Desktop is validating the current avatar package record.',
    };
  }
  if (!input.avatarPackageValid) {
    return {
      status: 'needs_package',
      label: 'Needs package',
      detail: 'Runtime-projected avatar package and backend evidence are required before probe execution.',
    };
  }
  if (!input.routeReady) {
    return {
      status: 'runtime_unavailable',
      label: 'Runtime pending',
      detail: 'Runtime route is not ready for avatar debug requests.',
    };
  }
  return {
    status: 'ready',
    label: 'Ready',
    detail: 'Runtime avatar debug probes can run through the typed SDK surface.',
  };
}

export function buildAvatarDebugWorkbenchDiagnostics(
  config: AgentCenterAvatarPackageModule | null,
): AvatarDebugWorkbenchDiagnostics {
  const backendKind = config?.backend_kind || 'live2d';
  return {
    backendKind,
    packageRefState: config?.avatar_package_ref ? 'linked' : 'missing',
    profileRefState: config?.backend_capability_profile_ref ? 'linked' : 'pending',
    generatedMotionPolicy: config?.generated_motion_provider_policy || 'require_profile_support',
    debugProfile: config?.debug_profile || 'standard',
  };
}

export function avatarDebugProbeStatusLabel(status: AvatarDebugProbeStatus | undefined): string {
  switch (status) {
    case AvatarDebugProbeStatus.PASSED:
      return 'Passed';
    case AvatarDebugProbeStatus.FAILED:
      return 'Failed';
    case AvatarDebugProbeStatus.UNSUPPORTED:
      return 'Unsupported';
    case AvatarDebugProbeStatus.BLOCKED:
      return 'Blocked';
    case AvatarDebugProbeStatus.INVALID:
      return 'Invalid';
    default:
      return 'Pending';
  }
}

function normalizedEvidenceRefs(result: AvatarDebugProbeResultEnvelope | null | undefined): string[] {
  return Array.isArray(result?.evidenceRefs)
    ? result.evidenceRefs.filter((ref) => ref.trim().length > 0)
    : [];
}

export function avatarDebugProbeFailClosedReason(
  result: AvatarDebugProbeResultEnvelope | null | undefined,
  replayRef?: AvatarDebugReplayRef | null,
): string | null {
  if (result?.status !== AvatarDebugProbeStatus.PASSED) {
    return null;
  }
  const requiredEvidenceCount = REQUIRED_EVIDENCE_REF_COUNTS_BY_PROBE_KIND[result.probeKind] ?? 1;
  if (normalizedEvidenceRefs(result).length < requiredEvidenceCount) {
    return 'required_probe_evidence_missing';
  }
  if (!replayRef?.replayRef?.trim()) {
    return 'runtime_replay_missing';
  }
  return null;
}

export function avatarDebugProbePresentationStatus(
  result: AvatarDebugProbeResultEnvelope | null | undefined,
  replayRef?: AvatarDebugReplayRef | null,
): AvatarDebugProbeStatus | undefined {
  return avatarDebugProbeFailClosedReason(result, replayRef)
    ? AvatarDebugProbeStatus.FAILED
    : result?.status;
}

export function avatarDebugProbePresentationStatusLabel(
  result: AvatarDebugProbeResultEnvelope | null | undefined,
  replayRef?: AvatarDebugReplayRef | null,
): string {
  return avatarDebugProbeStatusLabel(avatarDebugProbePresentationStatus(result, replayRef));
}

export function avatarDebugProbeRemediation(
  result: AvatarDebugProbeResultEnvelope | null | undefined,
  replayRef?: AvatarDebugReplayRef | null,
): string {
  const failClosedReason = avatarDebugProbeFailClosedReason(result, replayRef);
  if (failClosedReason === 'required_probe_evidence_missing') {
    return 'Required probe evidence is missing. Treat this probe as failed until Runtime returns every required evidence ref.';
  }
  if (failClosedReason === 'runtime_replay_missing') {
    return 'runtime_replay_missing: Runtime replay evidence is missing. Treat this probe as failed until Runtime returns a replay ref.';
  }
  switch (result?.status) {
    case AvatarDebugProbeStatus.PASSED:
      return 'Evidence is linked and this probe is ready.';
    case AvatarDebugProbeStatus.UNSUPPORTED:
      return 'Select a backend/profile that supports this route, or disable the related capability policy.';
    case AvatarDebugProbeStatus.BLOCKED:
      return 'Runtime policy blocked this probe. Review approval, scope, and package validation state.';
    case AvatarDebugProbeStatus.INVALID:
      return 'The probe request was invalid. Refresh the conversation anchor and retry.';
    case AvatarDebugProbeStatus.FAILED:
      return 'Inspect package validation, backend load state, and capability profile evidence.';
    default:
      return 'Run a probe to produce Runtime-owned evidence and replay links.';
  }
}

export async function requestAvatarDebugWorkbenchProbe(input: {
  ownerUserId: string;
  realmAgentId: string;
  localAgentRef: string;
  conversationAnchorId: string;
  probeKind: AvatarDebugProbeKind;
}) {
  return getPlatformClient().runtime.avatarDebug.requestProbe({
    ownerUserId: input.ownerUserId,
    realmAgentId: input.realmAgentId,
    localAgentRef: input.localAgentRef,
    conversationAnchorId: input.conversationAnchorId,
    probeKind: input.probeKind,
    requestedBy: AvatarDebugRequestedBy.DESKTOP_DEBUG_WORKBENCH,
    replayRequested: true,
  });
}

export function AgentCenterAvatarDebugWorkbench(props: AgentCenterAvatarDebugWorkbenchProps) {
  const { input, avatarPackageConfig, avatarPackageValid, avatarPackageChecking, validationMessage } = props;
  const [snapshot, setSnapshot] = useState<GetAvatarDebugSnapshotResponse | null>(null);
  const [latestResult, setLatestResult] = useState<AvatarDebugProbeResultEnvelope | null>(null);
  const [latestReplay, setLatestReplay] = useState<AvatarDebugReplayRef | null>(null);
  const [pendingKind, setPendingKind] = useState<AvatarDebugProbeKind | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const localAgentRef = input.activeTarget?.localAgentRef || '';
  const ownerUserId = input.activeTarget?.ownerUserId || '';
  const realmAgentId = input.activeTarget?.realmAgentId || '';
  const conversationAnchorId = input.activeConversationAnchorId || '';
  const launchHealth = useMemo(() => buildAvatarDebugWorkbenchLaunchHealth({
    avatarPackageValid,
    avatarPackageChecking,
    conversationAnchorId: input.activeConversationAnchorId,
    routeReady: input.agentRouteReady,
  }), [
    avatarPackageChecking,
    avatarPackageValid,
    input.activeConversationAnchorId,
    input.agentRouteReady,
  ]);
  const diagnostics = useMemo(() => buildAvatarDebugWorkbenchDiagnostics(avatarPackageConfig), [
    avatarPackageConfig,
  ]);
  const canRequestProbe = Boolean(localAgentRef && ownerUserId && realmAgentId && conversationAnchorId && launchHealth.status === 'ready');

  const refreshSnapshot = useCallback(async () => {
    if (!localAgentRef || !ownerUserId || !realmAgentId || !conversationAnchorId) {
      setErrorMessage(input.t('Chat.agentCenterAvatarDebugMissingAnchor', { defaultValue: 'Open an agent conversation before refreshing avatar debug state.' }));
      return;
    }
    setPendingKind(AvatarDebugProbeKind.UNSPECIFIED);
    setErrorMessage(null);
    try {
      const nextSnapshot = await getPlatformClient().runtime.avatarDebug.snapshot({
        ownerUserId,
        realmAgentId,
        localAgentRef,
        conversationAnchorId,
      });
      setSnapshot(nextSnapshot);
      setLatestResult(nextSnapshot.probeResults[0] || null);
      setLatestReplay(nextSnapshot.replayRefs[0] || null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : input.t('Chat.agentCenterAvatarDebugRefreshFailed', { defaultValue: 'Could not refresh avatar debug state.' }));
    } finally {
      setPendingKind(null);
    }
  }, [conversationAnchorId, input, localAgentRef, ownerUserId, realmAgentId]);

  const runProbe = useCallback(async (probeKind: AvatarDebugProbeKind) => {
    if (!localAgentRef || !ownerUserId || !realmAgentId || !conversationAnchorId) {
      setErrorMessage(input.t('Chat.agentCenterAvatarDebugMissingAnchor', { defaultValue: 'Open an agent conversation before running probes.' }));
      return;
    }
    setPendingKind(probeKind);
    setErrorMessage(null);
    try {
      const response = await requestAvatarDebugWorkbenchProbe({
        ownerUserId,
        realmAgentId,
        localAgentRef,
        conversationAnchorId,
        probeKind,
      });
      setLatestResult(response.result || null);
      setLatestReplay(response.replayRef || null);
      const nextSnapshot = await getPlatformClient().runtime.avatarDebug.snapshot({
        ownerUserId,
        realmAgentId,
        localAgentRef,
        conversationAnchorId,
      });
      setSnapshot(nextSnapshot);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : input.t('Chat.agentCenterAvatarDebugProbeFailed', { defaultValue: 'Avatar debug probe failed.' }));
    } finally {
      setPendingKind(null);
    }
  }, [conversationAnchorId, input, localAgentRef, ownerUserId, realmAgentId]);

  const openReplay = useCallback(async () => {
    const probeId = latestResult?.probeId || latestReplay?.probeId || '';
    if (!localAgentRef || !ownerUserId || !realmAgentId || !conversationAnchorId || !probeId) {
      return;
    }
    setPendingKind(AvatarDebugProbeKind.UNSPECIFIED);
    setErrorMessage(null);
    try {
      const replay = await getPlatformClient().runtime.avatarDebug.getReplay({
        ownerUserId,
        realmAgentId,
        localAgentRef,
        conversationAnchorId,
        probeId,
      });
      setLatestResult(replay.result || latestResult);
      setLatestReplay(replay.replayRef || latestReplay);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : input.t('Chat.agentCenterAvatarDebugReplayFailed', { defaultValue: 'Avatar debug replay is unavailable.' }));
    } finally {
      setPendingKind(null);
    }
  }, [conversationAnchorId, input, latestReplay, latestResult, localAgentRef, ownerUserId, realmAgentId]);

  const latestStatus = avatarDebugProbePresentationStatusLabel(latestResult, latestReplay);
  const latestEvidence = latestResult?.evidenceRefs.length ? latestResult.evidenceRefs.join(', ') : input.t('Chat.agentCenterAvatarDebugNoEvidence', { defaultValue: 'No evidence linked yet' });
  const snapshotCount = snapshot?.probeResults.length || 0;

  return (
    <div className="rounded-lg border border-emerald-100 bg-emerald-50/40 px-3 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-slate-950">
            {input.t('Chat.agentCenterAvatarDebugWorkbench', { defaultValue: 'Debug workbench' })}
          </div>
          <div className="mt-1 text-[11px] leading-4 text-slate-500">
            {launchHealth.detail}
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-[10px] font-semibold text-emerald-700">
          {launchHealth.label}
        </span>
      </div>

      <div className="mt-3 grid gap-2 text-[11px] leading-4 text-slate-600 sm:grid-cols-2">
        <DebugFact label={input.t('Chat.agentCenterAvatarDebugBackend', { defaultValue: 'Backend' })} value={diagnostics.backendKind.toUpperCase()} />
        <DebugFact label={input.t('Chat.agentCenterAvatarDebugPackageRef', { defaultValue: 'Package ref' })} value={diagnostics.packageRefState === 'linked' ? input.t('Chat.agentCenterLinked', { defaultValue: 'Linked' }) : input.t('Chat.agentCenterMissing', { defaultValue: 'Missing' })} />
        <DebugFact label={input.t('Chat.agentCenterAvatarDebugProfileRef', { defaultValue: 'Profile ref' })} value={diagnostics.profileRefState === 'linked' ? input.t('Chat.agentCenterLinked', { defaultValue: 'Linked' }) : input.t('Chat.agentCenterPending', { defaultValue: 'Pending' })} />
        <DebugFact label={input.t('Chat.agentCenterAvatarDebugPolicy', { defaultValue: 'Motion policy' })} value={diagnostics.generatedMotionPolicy.replaceAll('_', ' ')} />
        <DebugFact label={input.t('Chat.agentCenterAvatarDebugProfile', { defaultValue: 'Debug profile' })} value={diagnostics.debugProfile.replaceAll('_', ' ')} />
        <DebugFact label={input.t('Chat.agentCenterAvatarDebugSnapshot', { defaultValue: 'Snapshot' })} value={input.t('Chat.agentCenterAvatarDebugSnapshotCount', { defaultValue: '{{count}} result(s)', count: snapshotCount })} />
      </div>

      {validationMessage ? (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-4 text-amber-800">
          {validationMessage}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!localAgentRef || !ownerUserId || !realmAgentId || !conversationAnchorId || pendingKind !== null}
          onClick={() => { void refreshSnapshot(); }}
          className="rounded-md border border-emerald-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pendingKind === AvatarDebugProbeKind.UNSPECIFIED
            ? input.t('Chat.agentCenterAvatarDebugRefreshing', { defaultValue: 'Refreshing' })
            : input.t('Chat.agentCenterAvatarDebugRefresh', { defaultValue: 'Refresh' })}
        </button>
        {PROBES.map((probe) => (
          <button
            key={probe.kind}
            type="button"
            title={probe.summary}
            disabled={!canRequestProbe || pendingKind !== null}
            onClick={() => { void runProbe(probe.kind); }}
            className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 transition-colors hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pendingKind === probe.kind ? input.t('Chat.agentCenterAvatarDebugRunning', { defaultValue: 'Running' }) : probe.label}
          </button>
        ))}
      </div>

      <div className="mt-3 rounded-md bg-white px-3 py-2 text-[11px] leading-4 text-slate-600">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-semibold text-slate-800">
            {input.t('Chat.agentCenterAvatarDebugLatestResult', { defaultValue: 'Latest result' })}
          </span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
            {latestStatus}
          </span>
        </div>
        <div className="mt-1">{avatarDebugProbeRemediation(latestResult, latestReplay)}</div>
        <div className="mt-2 text-slate-500">
          {input.t('Chat.agentCenterAvatarDebugEvidence', { defaultValue: 'Evidence' })}: {latestEvidence}
        </div>
        {latestReplay?.replayRef ? (
          <button
            type="button"
            disabled={pendingKind !== null}
            onClick={() => { void openReplay(); }}
            className="mt-2 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {input.t('Chat.agentCenterAvatarDebugReplay', { defaultValue: 'Refresh replay link' })}
          </button>
        ) : null}
      </div>

      {errorMessage ? (
        <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] leading-4 text-rose-700">
          {errorMessage}
        </div>
      ) : null}
    </div>
  );
}

function DebugFact(props: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-white px-2.5 py-2">
      <span className="font-semibold text-slate-700">{props.label}</span>
      <span className="ml-1 capitalize">{props.value}</span>
    </div>
  );
}
