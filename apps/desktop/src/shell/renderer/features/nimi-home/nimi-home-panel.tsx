import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { NimiAppClient, type NimiAppTransport } from '@nimiplatform/sdk/app';
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
  type ColdStartProjection,
  type ColdStartState,
  type DiscoveryProjection,
  type FirstRunReadinessProjection,
  type LibraryProjection,
  type UpstreamInputs,
} from '../../first-run/index.js';
import {
  DefaultExperienceBridge,
  type ApplicableScope,
  type ApplyResult,
  type DefaultExperienceProfile,
  type HostProfile,
  type ProfilePreferences,
  type RuntimeAdapter,
  type ScopeRef,
} from '../../../../runtime/default-experience-bridge/index.js';

const UNAVAILABLE_APP_REGISTRY_DETAIL = 'Nimi App registry bridge is not mounted yet.';
const UNAVAILABLE_AGENT_ANCHOR_ID = 'runtime-anchor-unavailable';

const unavailableAppTransport: NimiAppTransport = {
  async listRegistry() {
    throw new Error(UNAVAILABLE_APP_REGISTRY_DETAIL);
  },
  async getAppStatus() {
    throw new Error(UNAVAILABLE_APP_REGISTRY_DETAIL);
  },
};

function buildRuntimeAdapter(): RuntimeAdapter {
  return {
    async hostProfile(): Promise<HostProfile> {
      throw new Error('Host profile bridge is not mounted yet.');
    },
    async recommendProfile(
      _scope: ApplicableScope,
      _preferences?: ProfilePreferences,
    ): Promise<DefaultExperienceProfile> {
      throw new Error('AIProfile recommendation bridge is not mounted yet.');
    },
    async applyProfile(scopeRef: ScopeRef, profileId: string): Promise<ApplyResult> {
      return { applied: false, profileId, scope: scopeRef };
    },
    async projectColdStart(inputs: UpstreamInputs): Promise<ColdStartProjection> {
      const ready = Object.values(inputs).every((state) => state === 'ready');
      return ready
        ? { state: 'ready' }
        : { state: 'unavailable', detail: 'Cold-start bridge is waiting for Runtime projections.' };
    },
  };
}

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

function useFirstRunReadinessProjection(): FirstRunReadinessProjection | null {
  const bootstrapReady = useAppStore((state) => state.bootstrapReady);
  const bootstrapError = useAppStore((state) => state.bootstrapError);
  const authStatus = useAppStore((state) => state.auth.status);
  const runtimeDefaults = useAppStore((state) => state.runtimeDefaults);
  const bridge = useMemo(() => new DefaultExperienceBridge(buildRuntimeAdapter()), []);
  const inputs = useMemo<UpstreamInputs>(() => {
    const runtimeReady = Boolean(runtimeDefaults);
    return {
      runtimeDaemon: runtimeDaemonState(bootstrapReady, bootstrapError),
      account: accountState(authStatus),
      defaultExperienceProfile: runtimeDefaultsState(runtimeReady),
      materialization: runtimeDefaultsState(runtimeReady),
      appRegistry: 'unavailable',
      cognitionMemory: 'unavailable',
    };
  }, [authStatus, bootstrapError, bootstrapReady, runtimeDefaults]);
  const [projection, setProjection] = useState<FirstRunReadinessProjection | null>(null);

  useEffect(() => {
    let cancelled = false;
    void projectFirstRunReadiness(bridge, inputs).then((next) => {
      if (!cancelled) setProjection(next);
    });
    return () => {
      cancelled = true;
    };
  }, [bridge, inputs]);

  return projection;
}

function useAppRegistryProjections(): {
  library: LibraryProjection | null;
  discovery: DiscoveryProjection | null;
} {
  const client = useMemo(() => new NimiAppClient(unavailableAppTransport), []);
  const [library, setLibrary] = useState<LibraryProjection | null>(null);
  const [discovery, setDiscovery] = useState<DiscoveryProjection | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([projectLibrary(client), projectDiscovery(client)]).then(([nextLibrary, nextDiscovery]) => {
      if (cancelled) return;
      setLibrary(nextLibrary);
      setDiscovery(nextDiscovery);
    });
    return () => {
      cancelled = true;
    };
  }, [client]);

  return { library, discovery };
}

function LoadingProjection({ label }: { label: string }): ReactElement {
  return (
    <section data-testid={`nimi-home-${label}-loading`} className="text-sm text-[var(--nimi-text-secondary)]">
      Loading {label}...
    </section>
  );
}

export function NimiHomePanel(): ReactElement {
  const readiness = useFirstRunReadinessProjection();
  const { library, discovery } = useAppRegistryProjections();
  const agentChatBinding = useMemo<AgentChatBinding>(() => ({
    scopeRef: { kind: 'first-run', scopeId: 'nimi-home-agent-chat' },
    conversationAnchorId: UNAVAILABLE_AGENT_ANCHOR_ID,
  }), []);
  const agentChatExecutor = useMemo<AgentChatExecutor>(() => ({
    async applyProfile() {
      return { applied: false };
    },
  }), []);

  return (
    <div data-testid="nimi-home-panel" className="flex min-h-0 flex-1 flex-col">
      <ScrollArea
        className="flex-1"
        viewportClassName="bg-transparent"
        contentClassName="mx-auto flex w-full max-w-6xl flex-col gap-4 px-5 py-5"
      >
        <header className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--nimi-text-secondary)]">
            Nimi
          </p>
          <h1 className="text-2xl font-semibold text-[var(--nimi-text-primary)]">Home</h1>
        </header>

        <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <Surface tone="panel" material="glass-regular" padding="none" className="p-5">
            {readiness ? <FirstRunReadinessView projection={readiness} /> : <LoadingProjection label="readiness" />}
          </Surface>
          <Surface tone="panel" material="glass-regular" padding="none" className="p-5">
            <AgentChatReference binding={agentChatBinding} executor={agentChatExecutor} />
          </Surface>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Surface tone="panel" material="glass-regular" padding="none" className="p-5">
            {library ? <LibraryView projection={library} /> : <LoadingProjection label="library" />}
          </Surface>
          <Surface tone="panel" material="glass-regular" padding="none" className="p-5">
            {discovery ? <DiscoveryView projection={discovery} /> : <LoadingProjection label="discovery" />}
          </Surface>
        </div>
      </ScrollArea>
    </div>
  );
}
