import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { ScrollArea, Surface } from '@nimiplatform/nimi-kit/ui';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import {
  AgentChatReference,
  type AgentChatBinding,
  type AgentChatExecutor,
} from '../../agent-chat/agent-chat-reference.js';
import {
  DiscoveryView,
  FirstRunReadinessView,
  LibraryView,
  projectDiscovery,
  projectFirstRunReadiness,
  projectLibrary,
  type ColdStartState,
  type DiscoveryProjection,
  type FirstRunReadinessProjection,
  type LibraryProjection,
  type UpstreamInputs,
} from '../../first-run/index.js';
import { createDesktopHomeLiveBridge, type NimiHomeAIProfileProjection, type DesktopHomeLiveBridge } from './nimi-home-live-bridge.js';

const UNAVAILABLE_AGENT_ANCHOR_ID = 'runtime-anchor-unavailable';

function runtimeDaemonState(bootstrapReady: boolean, bootstrapError: string | null): ColdStartState {
  if (bootstrapError) return 'failed';
  return bootstrapReady ? 'ready' : 'in-progress';
}

function accountState(status: 'bootstrapping' | 'anonymous' | 'authenticated'): ColdStartState {
  if (status === 'authenticated') return 'ready';
  if (status === 'bootstrapping') return 'in-progress';
  return 'needs-confirmation';
}

function runtimeDefaultsState(hasRuntimeDefaults: boolean): ColdStartState {
  return hasRuntimeDefaults ? 'ready' : 'setup-required';
}

function useAIProfileSelectionProjection(liveBridge: DesktopHomeLiveBridge): NimiHomeAIProfileProjection {
  const [projection, setProjection] = useState<NimiHomeAIProfileProjection>({
    profileState: 'in-progress',
    materializationState: 'in-progress',
  });

  useEffect(() => {
    let cancelled = false;
    void liveBridge.projectAIProfileSelection().then((next) => {
      if (!cancelled) setProjection(next);
    });
    return () => {
      cancelled = true;
    };
  }, [liveBridge]);

  return projection;
}

function useFirstRunReadinessProjection(
  aiProfileSelection: NimiHomeAIProfileProjection,
  appRegistryState: ColdStartState,
): FirstRunReadinessProjection | null {
  const bootstrapReady = useAppStore((state) => state.bootstrapReady);
  const bootstrapError = useAppStore((state) => state.bootstrapError);
  const authStatus = useAppStore((state) => state.auth.status);
  const runtimeDefaults = useAppStore((state) => state.runtimeDefaults);
  const inputs = useMemo<UpstreamInputs>(() => {
    return {
      runtimeDaemon: runtimeDaemonState(bootstrapReady, bootstrapError),
      account: accountState(authStatus),
      aiProfileSelection: aiProfileSelection.profileState,
      materialization: aiProfileSelection.materializationState === 'unavailable' && runtimeDefaults
        ? runtimeDefaultsState(Boolean(runtimeDefaults))
        : aiProfileSelection.materializationState,
      appRegistry: appRegistryState,
      cognitionMemory: 'unavailable',
    };
  }, [aiProfileSelection, appRegistryState, authStatus, bootstrapError, bootstrapReady, runtimeDefaults]);
  const [projection, setProjection] = useState<FirstRunReadinessProjection | null>(null);

  useEffect(() => {
    let cancelled = false;
    void projectFirstRunReadiness(inputs).then((next) => {
      if (!cancelled) setProjection(next);
    });
    return () => {
      cancelled = true;
    };
  }, [inputs]);

  return projection;
}

function useAppRegistryProjections(liveBridge: DesktopHomeLiveBridge): {
  library: LibraryProjection | null;
  discovery: DiscoveryProjection | null;
  appRegistryState: ColdStartState;
} {
  const [library, setLibrary] = useState<LibraryProjection | null>(null);
  const [discovery, setDiscovery] = useState<DiscoveryProjection | null>(null);
  const [appRegistryState, setAppRegistryState] = useState<ColdStartState>('in-progress');

  useEffect(() => {
    let cancelled = false;
    void Promise.all([projectLibrary(liveBridge.appClient), projectDiscovery(liveBridge.appClient)]).then(([nextLibrary, nextDiscovery]) => {
      if (cancelled) return;
      setLibrary(nextLibrary);
      setDiscovery(nextDiscovery);
      setAppRegistryState(nextLibrary.status === 'loaded' ? 'ready' : 'unavailable');
    });
    return () => {
      cancelled = true;
    };
  }, [liveBridge]);

  return { library, discovery, appRegistryState };
}

function LoadingProjection({ label }: { label: string }): ReactElement {
  return (
    <section data-testid={`nimi-home-${label}-loading`} className="flex min-h-32 animate-pulse items-center justify-center rounded-lg border border-dashed border-[color:var(--nimi-border-subtle)] text-sm text-[var(--nimi-text-secondary)]">
      Loading {label}...
    </section>
  );
}

export function NimiHomePanel(): ReactElement {
  const liveBridge = useMemo(() => createDesktopHomeLiveBridge(), []);
  const aiProfileSelection = useAIProfileSelectionProjection(liveBridge);
  const { library, discovery, appRegistryState } = useAppRegistryProjections(liveBridge);
  const readiness = useFirstRunReadinessProjection(aiProfileSelection, appRegistryState);
  const agentChatBinding = useMemo<AgentChatBinding>(() => ({
    scopeRef: { kind: 'first-run', scopeId: 'nimi-home-agent-chat' },
    conversationAnchorId: UNAVAILABLE_AGENT_ANCHOR_ID,
    profileId: aiProfileSelection.profileId,
  }), [aiProfileSelection.profileId]);
  const agentChatExecutor = useMemo<AgentChatExecutor>(() => ({
    async applyProfile(scopeRef, profileId) {
      return liveBridge.applyAgentChatProfile(scopeRef, profileId);
    },
  }), [liveBridge]);

  return (
    <div data-testid="nimi-home-panel" className="flex min-h-0 flex-1 flex-col">
      <ScrollArea
        className="flex-1"
        viewportClassName="bg-transparent"
        contentClassName="mx-auto flex w-full max-w-6xl flex-col gap-5 px-5 py-5"
      >
        <header className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase text-[var(--nimi-text-secondary)]">Nimi</p>
              <h1 className="mt-2 text-3xl font-semibold text-[var(--nimi-text-primary)]">Home</h1>
            </div>
            <span className="rounded-full border border-[color:var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_78%,transparent)] px-3 py-1 text-xs font-medium text-[color:var(--nimi-text-secondary)]">
              {readiness?.isReady ? 'Ready' : 'Setup in progress'}
            </span>
          </div>
        </header>

        <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
          <Surface tone="panel" material="glass-regular" padding="none" className="min-h-[258px] p-5 shadow-[0_16px_44px_rgba(15,23,42,0.06)]">
            {readiness ? <FirstRunReadinessView projection={readiness} /> : <LoadingProjection label="readiness" />}
          </Surface>
          <Surface tone="panel" material="glass-regular" padding="none" className="min-h-[258px] p-5 shadow-[0_16px_44px_rgba(15,23,42,0.06)]">
            <AgentChatReference binding={agentChatBinding} executor={agentChatExecutor} />
          </Surface>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Surface tone="panel" material="glass-regular" padding="none" className="min-h-[148px] p-5 shadow-[0_16px_44px_rgba(15,23,42,0.06)]">
            {library ? <LibraryView projection={library} /> : <LoadingProjection label="library" />}
          </Surface>
          <Surface tone="panel" material="glass-regular" padding="none" className="min-h-[148px] p-5 shadow-[0_16px_44px_rgba(15,23,42,0.06)]">
            {discovery ? <DiscoveryView projection={discovery} /> : <LoadingProjection label="discovery" />}
          </Surface>
        </div>
      </ScrollArea>
    </div>
  );
}
