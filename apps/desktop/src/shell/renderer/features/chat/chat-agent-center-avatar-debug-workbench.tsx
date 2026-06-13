import { useCallback, useMemo, useState } from 'react';
import { createNimiRuntimeAgentConsumeClient, type NimiRuntimeAgentCompanionParticipationProjection, type NimiRuntimeAgentCompanionParticipationSurfaceKind } from '@nimiplatform/sdk/runtime';
import { getDesktopAppId, getDesktopRuntime } from '@renderer/infra/sdk/desktop-nimi-client-session';
import type { UseAgentConversationPresentationInput } from './chat-agent-shell-presentation-types';
import type { AgentCenterAvatarAssetModule } from './chat-agent-center-avatar-config-types';
import {
  AVATAR_DEBUG_WORKBENCH_PROBES,
  AvatarDebugProbeKind,
  avatarDebugProbePresentationStatusLabel,
  avatarDebugProbeRemediation,
  buildAvatarDebugWorkbenchDiagnostics,
  buildAvatarDebugWorkbenchLaunchHealth,
  buildDesktopCompanionParticipationProjectionRequest,
  desktopCompanionParticipationRemediation,
  desktopCompanionParticipationStatusLabel,
  type AvatarDebugProbeResultEnvelope,
  type AvatarDebugReplayRef,
} from './chat-agent-center-avatar-debug-workbench-model';

const AVATAR_DEBUG_REQUESTED_BY_DESKTOP_DEBUG_WORKBENCH = 1;

type AvatarDebugSnapshotResponse = {
  probeResults: AvatarDebugProbeResultEnvelope[];
  replayRefs: AvatarDebugReplayRef[];
};

export {
  AVATAR_DEBUG_WORKBENCH_PROBES,
  AvatarDebugProbeKind,
  AvatarDebugProbeStatus,
  avatarDebugProbeFailClosedReason,
  avatarDebugProbePresentationStatus,
  avatarDebugProbePresentationStatusLabel,
  avatarDebugProbeRemediation,
  avatarDebugProbeStatusLabel,
  buildAvatarDebugWorkbenchDiagnostics,
  buildAvatarDebugWorkbenchLaunchHealth,
  buildDesktopCompanionParticipationProjectionRequest,
  desktopCompanionParticipationRemediation,
  desktopCompanionParticipationStatusLabel,
  type AvatarDebugWorkbenchDiagnostics,
  type AvatarDebugWorkbenchLaunchHealth,
  type AvatarDebugWorkbenchProbe,
  type AvatarDebugProbeResultEnvelope,
  type AvatarDebugReplayRef,
  type DesktopCompanionParticipationProjectionRequest,
} from './chat-agent-center-avatar-debug-workbench-model';

type AgentCenterAvatarDebugWorkbenchProps = {
  input: UseAgentConversationPresentationInput;
  avatarAssetConfig: AgentCenterAvatarAssetModule | null;
  avatarAssetValid: boolean;
  avatarAssetChecking: boolean;
  validationMessage: string | null;
};

export async function requestDesktopCompanionParticipationProjection(input: {
  ownerUserId: string;
  realmAgentId: string;
  localAgentRef: string;
  conversationAnchorId: string;
  surfaceKind?: NimiRuntimeAgentCompanionParticipationSurfaceKind;
}): Promise<NimiRuntimeAgentCompanionParticipationProjection> {
  return createDesktopAvatarDebugRuntimeAgentClient().companionParticipation.getProjection(
    buildDesktopCompanionParticipationProjectionRequest(input),
  );
}

export async function requestAvatarDebugWorkbenchProbe(input: {
  ownerUserId: string;
  realmAgentId: string;
  localAgentRef: string;
  conversationAnchorId: string;
  probeKind: AvatarDebugProbeKind;
}) {
  return createDesktopAvatarDebugRuntimeAgentClient().avatarDebug.requestProbe({
    ownerUserId: input.ownerUserId,
    realmAgentId: input.realmAgentId,
    localAgentRef: input.localAgentRef,
    conversationAnchorId: input.conversationAnchorId,
    probeKind: input.probeKind,
    requestedBy: AVATAR_DEBUG_REQUESTED_BY_DESKTOP_DEBUG_WORKBENCH,
    replayRequested: true,
  });
}

function createDesktopAvatarDebugRuntimeAgentClient() {
  return createNimiRuntimeAgentConsumeClient({
    runtime: { agents: getDesktopRuntime().agents },
    runtimeAppId: getDesktopAppId(),
  });
}

export function AgentCenterAvatarDebugWorkbench(props: AgentCenterAvatarDebugWorkbenchProps) {
  const { input, avatarAssetConfig, avatarAssetValid, avatarAssetChecking, validationMessage } = props;
  const [snapshot, setSnapshot] = useState<AvatarDebugSnapshotResponse | null>(null);
  const [latestResult, setLatestResult] = useState<AvatarDebugProbeResultEnvelope | null>(null);
  const [latestReplay, setLatestReplay] = useState<AvatarDebugReplayRef | null>(null);
  const [latestParticipationProjection, setLatestParticipationProjection] = useState<NimiRuntimeAgentCompanionParticipationProjection | null>(null);
  const [pendingKind, setPendingKind] = useState<AvatarDebugProbeKind | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const localAgentRef = input.activeTarget?.localAgentRef || '';
  const ownerUserId = input.activeTarget?.ownerUserId || '';
  const realmAgentId = input.activeTarget?.realmAgentId || '';
  const conversationAnchorId = input.activeConversationAnchorId || '';
  const launchHealth = useMemo(() => buildAvatarDebugWorkbenchLaunchHealth({
    avatarAssetValid,
    avatarAssetChecking,
    conversationAnchorId: input.activeConversationAnchorId,
    routeReady: input.agentRouteReady,
  }), [
    avatarAssetChecking,
    avatarAssetValid,
    input.activeConversationAnchorId,
    input.agentRouteReady,
  ]);
  const diagnostics = useMemo(() => buildAvatarDebugWorkbenchDiagnostics(avatarAssetConfig), [
    avatarAssetConfig,
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
      const runtimeAgent = createDesktopAvatarDebugRuntimeAgentClient();
      const nextSnapshot = await runtimeAgent.avatarDebug.snapshot({
        ownerUserId,
        realmAgentId,
        localAgentRef,
        conversationAnchorId,
      });
      setSnapshot(nextSnapshot as AvatarDebugSnapshotResponse);
      setLatestResult((nextSnapshot.probeResults[0] as AvatarDebugProbeResultEnvelope | undefined) || null);
      setLatestReplay((nextSnapshot.replayRefs[0] as AvatarDebugReplayRef | undefined) || null);
      setLatestParticipationProjection(await requestDesktopCompanionParticipationProjection({
        ownerUserId,
        realmAgentId,
        localAgentRef,
        conversationAnchorId,
      }));
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
      setLatestResult((response.result as AvatarDebugProbeResultEnvelope | undefined) || null);
      setLatestReplay((response.replayRef as AvatarDebugReplayRef | undefined) || null);
      const nextSnapshot = await createDesktopAvatarDebugRuntimeAgentClient().avatarDebug.snapshot({
        ownerUserId,
        realmAgentId,
        localAgentRef,
        conversationAnchorId,
      });
      setSnapshot(nextSnapshot as AvatarDebugSnapshotResponse);
      setLatestParticipationProjection(await requestDesktopCompanionParticipationProjection({
        ownerUserId,
        realmAgentId,
        localAgentRef,
        conversationAnchorId,
      }));
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
      const replay = await createDesktopAvatarDebugRuntimeAgentClient().avatarDebug.getReplay({
        ownerUserId,
        realmAgentId,
        localAgentRef,
        conversationAnchorId,
        probeId,
      });
      setLatestResult((replay.result as AvatarDebugProbeResultEnvelope | undefined) || latestResult);
      setLatestReplay((replay.replayRef as AvatarDebugReplayRef | undefined) || latestReplay);
      setLatestParticipationProjection(await requestDesktopCompanionParticipationProjection({
        ownerUserId,
        realmAgentId,
        localAgentRef,
        conversationAnchorId,
      }));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : input.t('Chat.agentCenterAvatarDebugReplayFailed', { defaultValue: 'Avatar debug replay is unavailable.' }));
    } finally {
      setPendingKind(null);
    }
  }, [conversationAnchorId, input, latestReplay, latestResult, localAgentRef, ownerUserId, realmAgentId]);

  const latestStatus = avatarDebugProbePresentationStatusLabel(latestResult, latestReplay);
  const participationStatus = desktopCompanionParticipationStatusLabel(latestParticipationProjection);
  const latestEvidence = latestResult?.evidenceRefs?.length ? latestResult.evidenceRefs.join(', ') : input.t('Chat.agentCenterAvatarDebugNoEvidence', { defaultValue: 'No evidence linked yet' });
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
        <DebugFact label={input.t('Chat.agentCenterAvatarDebugAssetRef', { defaultValue: 'Asset ref' })} value={diagnostics.localAssetRefState === 'linked' ? input.t('Chat.agentCenterLinked', { defaultValue: 'Linked' }) : input.t('Chat.agentCenterMissing', { defaultValue: 'Missing' })} />
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
        {AVATAR_DEBUG_WORKBENCH_PROBES.map((probe) => (
          <button
            key={probe.kind}
            type="button"
            title={probe.summary}
            disabled={!probe.runtimeProbeKind || !canRequestProbe || pendingKind !== null}
            onClick={() => {
              if (probe.runtimeProbeKind) {
                void runProbe(probe.runtimeProbeKind);
              }
            }}
            className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 transition-colors hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {probe.runtimeProbeKind && pendingKind === probe.runtimeProbeKind
              ? input.t('Chat.agentCenterAvatarDebugRunning', { defaultValue: 'Running' })
              : probe.label}
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
        <div className="mt-2 text-slate-500">
          {input.t('Chat.agentCenterAvatarDebugParticipation', { defaultValue: 'Participation' })}: {participationStatus}
        </div>
        <div className="mt-1 text-slate-500">
          {desktopCompanionParticipationRemediation(latestParticipationProjection)}
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
