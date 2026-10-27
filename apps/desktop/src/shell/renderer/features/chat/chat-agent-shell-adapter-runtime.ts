import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { NimiLocalAppAgentHandle } from '@nimiplatform/sdk/app';
import type { NimiRuntimeAgentPresentationProfileProjection } from '@nimiplatform/sdk/runtime';
import {
  createAppAgentCenterSession,
  type AgentCenterAppearanceProjection,
  type AgentCenterResourcePackPlacementAdapter,
  type AgentCenterSession,
  type AgentCenterSnapshot,
} from '@nimiplatform/kit/features/agent-center';
import { createAgentCenterShellBridge, hasElectronInvoke } from '@nimiplatform/kit/shell/renderer/bridge';
import type { AgentLocalTargetSnapshot } from '../../bridge/runtime-bridge/types';
import { useAppStoreApi, type AppStoreState } from '../../app-shell/providers/app-store';
import type { RuntimeCommittedStatusProjection } from './chat-agent-shell-visible-state';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import { createDesktopAgentCenterHostMechanics } from './chat-agent-center-host-mechanics.js';

type RuntimeHostErrorReporter = (
  error: unknown,
  options?: { action?: string; extra?: Record<string, unknown> },
) => void;

type UseAgentConversationRuntimeControllerInput = {
  activeTarget: AgentLocalTargetSnapshot | null;
  reportHostError: RuntimeHostErrorReporter;
};

type AgentConversationRuntimeController = {
  runtimeAgentCenterAdapter: AgentCenterSession | null;
  runtimeCommittedStatus: RuntimeCommittedStatusProjection | null;
  runtimePresentationProfile: NimiRuntimeAgentPresentationProfileProjection | null;
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function presentationBackend(
  value: unknown,
): NimiRuntimeAgentPresentationProfileProjection['backendKind'] {
  return value === 'vrm' || value === 'live2d' || value === 'sprite2d'
    || value === 'canvas2d' || value === 'video'
    ? value
    : null;
}

export function projectDesktopRuntimePresentationProfile(
  appearance: AgentCenterAppearanceProjection | null | undefined,
): NimiRuntimeAgentPresentationProfileProjection | null {
  if (!appearance || appearance.status === 'loading' || appearance.status === 'invalid') return null;
  return {
    backendKind: presentationBackend(appearance.backendKind),
    avatarAssetRef: normalizeText(appearance.avatarAssetRef) || null,
    expressionProfileRef: normalizeText(appearance.expressionProfileRef) || null,
    idlePreset: normalizeText(appearance.idlePreset) || null,
    interactionPolicyRef: normalizeText(appearance.interactionPolicyRef) || null,
    defaultVoiceReference: normalizeText(appearance.defaultVoiceReference) || null,
    avatarAutoplay: appearance.avatarAutoplay === true,
    backgroundAssetRef: normalizeText(appearance.backgroundRef) || null,
  };
}

type AgentConversationDisplaySource = {
  getSnapshot(): {
    readonly phase: AgentCenterSnapshot['phase'];
    readonly state: {
      readonly cognition: RuntimeCommittedStatusProjection;
      readonly appearance: AgentCenterAppearanceProjection;
    };
  };
  subscribe(listener: () => void): () => void;
};

type AgentConversationDisplaySnapshot = Readonly<Pick<AgentConversationRuntimeController,
  'runtimeCommittedStatus' | 'runtimePresentationProfile'>>;

function reuseDisplayProjection<T extends object>(previous: T | null, next: T | null): T | null {
  if (previous && next) {
    const keys = Object.keys(next) as (keyof T)[];
    if (keys.length === Object.keys(previous).length
      && keys.every(key => Object.hasOwn(previous, key) && Object.is(previous[key], next[key]))) return previous;
  }
  if (next) Object.freeze(next);
  return next;
}

/** Display values belong to this exact Session instance, never a handle cache.
 * Agent Center and mutations retain the complete Session's own subscriptions. */
export function createAgentConversationDisplayStore(source: AgentConversationDisplaySource | null) {
  // Partial initial Manager reads serve the independent Center overview. They
  // must not change the chat scene/autoplay before the complete initial read.
  const initialPresentation = projectDesktopRuntimePresentationProfile(source?.getSnapshot().state.appearance);
  if (initialPresentation) Object.freeze(initialPresentation);
  let observed: ReturnType<AgentConversationDisplaySource['getSnapshot']> | null | undefined;
  let projected: AgentConversationDisplaySnapshot = Object.freeze({
    runtimeCommittedStatus: null,
    runtimePresentationProfile: initialPresentation,
  });
  const getSnapshot = (): AgentConversationDisplaySnapshot => {
    const next = source?.getSnapshot() ?? null;
    if (next === observed) return projected;
    const cognition = next?.state.cognition;
    const runtimeCommittedStatus = reuseDisplayProjection(projected.runtimeCommittedStatus,
      !next || next.phase === 'loading' || !cognition ? null : {
        lifecycleStatus: cognition.lifecycleStatus,
        executionState: cognition.executionState,
        statusText: cognition.statusText,
      });
    const runtimePresentationProfile = reuseDisplayProjection(projected.runtimePresentationProfile,
      next?.phase === 'loading' ? initialPresentation : projectDesktopRuntimePresentationProfile(next?.state.appearance));
    observed = next;
    if (runtimeCommittedStatus !== projected.runtimeCommittedStatus
      || runtimePresentationProfile !== projected.runtimePresentationProfile) {
      projected = Object.freeze({ runtimeCommittedStatus, runtimePresentationProfile });
    }
    return projected;
  };
  const subscribe = (listener: () => void) => {
    let current = getSnapshot();
    let active = true;
    const unsubscribe = source?.subscribe(() => {
      if (!active) return;
      const next = getSnapshot();
      if (next === current) return;
      current = next;
      listener();
    });
    return () => { active = false; unsubscribe?.(); };
  };
  return Object.freeze({ getSnapshot, subscribe });
}

export function useDesktopAgentCenterSession(
  input: { agentHandle?: string | null; conversationAnchorId?: string | null },
): AgentCenterSession | null {
  const bindings = useDesktopRendererBindings();
  const store = useAppStoreApi();
  const agentHandle = normalizeText(input.agentHandle);
  const conversationAnchorId = normalizeText(input.conversationAnchorId);
  const [boundSession, setBoundSession] = useState<{
    agentHandle: string;
    conversationAnchorId: string;
    bindings: typeof bindings;
    session: AgentCenterSession;
  } | null>(null);
  useEffect(() => {
    let current: { scope: AgentCenterAccountScope; session: AgentCenterSession } | null = null;
    const createSession = () => {
      const shellBridge = hasElectronInvoke() ? createAgentCenterShellBridge() : null;
      const resourcePackPlacement = conversationAnchorId && shellBridge
        ? {
            availability: {
              state: 'available',
              reasonCode: null,
              actionHint: null,
            },
            open: () => shellBridge.openResourcePackInZhiyu(conversationAnchorId),
          } as const satisfies AgentCenterResourcePackPlacementAdapter
        : {
            availability: {
              state: 'unavailable',
              reasonCode: 'selection-required',
              actionHint: 'open_current_conversation',
            },
            open: async () => ({
              status: 'unavailable',
              reasonCode: 'operation-unavailable',
              actionHint: 'retry_zhiyu_resource_pack_placement',
            }),
          } as const satisfies AgentCenterResourcePackPlacementAdapter;
      const appClient = bindings.sdk.appProduct();
      return createAppAgentCenterSession({
        handle: agentHandle as NimiLocalAppAgentHandle,
        client: appClient.agentConfigure,
        referenceVoiceClient: appClient,
        ...(conversationAnchorId
          ? { conversationAnchorId }
          : {}),
        hostMechanics: shellBridge
          ? createDesktopAgentCenterHostMechanics({
            conversationAnchorId,
            shell: shellBridge,
            avatarHandoff: bindings.app.commands.avatarHandoff,
          })
          : null,
        resourcePackPlacement,
      });
    };
    const update = () => {
      const auth = store.getState().auth;
      const scope = agentCenterAccountScope(auth);
      if (current && scope && sameAgentCenterAccountScope(current.scope, scope)) return;
      current?.session.dispose();
      current = null;
      // Refresh-pending may retain this exact established Session, but never
      // opens one. Owner calls still enforce formal App access independently.
      if (auth.status === 'authenticated' && scope && agentHandle) {
        current = { scope, session: createSession() };
      }
      setBoundSession(current ? { agentHandle, conversationAnchorId, bindings, session: current.session } : null);
    };
    // Observe every account transition, including sign-out/sign-in batched into
    // one React render, so an old Session can never be revived by equal fields.
    const unsubscribe = store.subscribe(update);
    update();
    return () => { unsubscribe(); current?.session.dispose(); current = null; };
  }, [agentHandle, conversationAnchorId, bindings, store]);

  const runtimeAgentCenterAdapter = boundSession?.agentHandle === agentHandle
    && boundSession.conversationAnchorId === conversationAnchorId && boundSession.bindings === bindings
    ? boundSession.session : null;
  return runtimeAgentCenterAdapter;
}

export function useAgentConversationRuntimeController(
  input: UseAgentConversationRuntimeControllerInput,
): AgentConversationRuntimeController {
  const runtimeAgentCenterAdapter = useDesktopAgentCenterSession(input.activeTarget ?? {});

  const displayStore = useMemo(() => createAgentConversationDisplayStore(runtimeAgentCenterAdapter), [runtimeAgentCenterAdapter]);
  const { runtimeCommittedStatus, runtimePresentationProfile } = useSyncExternalStore(
    displayStore.subscribe, displayStore.getSnapshot, displayStore.getSnapshot,
  );

  return {
    runtimeAgentCenterAdapter,
    runtimeCommittedStatus,
    runtimePresentationProfile,
  };
}

type AgentCenterAccountScope = Readonly<{
  accountId: string;
  realmEnvironmentId: string;
  authorizationRevision: string;
}>;

// @nimi-authority: rule.nimi.runtime.protected-session.r031
function agentCenterAccountScope(auth: AppStoreState['auth']): AgentCenterAccountScope | null {
  const accountId = auth.user?.id;
  const realmEnvironmentId = auth.user?.realmEnvironmentId;
  if ((auth.status !== 'authenticated' && auth.status !== 'refresh-pending')
    || typeof accountId !== 'string' || !accountId
    || typeof realmEnvironmentId !== 'string' || !realmEnvironmentId
    || !auth.authorizationRevision) return null;
  return { accountId, realmEnvironmentId, authorizationRevision: auth.authorizationRevision };
}

function sameAgentCenterAccountScope(left: AgentCenterAccountScope, right: AgentCenterAccountScope): boolean {
  return left.accountId === right.accountId && left.realmEnvironmentId === right.realmEnvironmentId
    && left.authorizationRevision === right.authorizationRevision;
}
