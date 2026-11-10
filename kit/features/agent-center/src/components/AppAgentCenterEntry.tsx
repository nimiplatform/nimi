import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronRight, Settings2 } from 'lucide-react';
import type {
  NimiLocalAppAgentHandle,
  NimiLocalAppAgentReference,
  NimiLocalAppClient,
} from '@nimiplatform/kit/core/sdk-contract';
import { Avatar, Button, InlineAlert, LoadingSkeleton, Surface, cn } from '@nimiplatform/kit/ui';
import { createAgentCenterI18n } from '../locales/index.js';
import { createAppAgentCenterSession } from '../session.js';
import type {
  AgentCenterHostMechanics,
  AgentCenterPlacementActions,
  AgentCenterResourcePackPlacementAdapter,
  AgentCenterSession,
} from '../types.js';
import { AgentCenter } from './AgentCenter.js';

type AppAgentCenterEntryClient = Pick<NimiLocalAppClient, 'agentConfigure'> & {
  readonly agents?: NimiLocalAppClient['agents'];
  readonly ai?: Pick<NimiLocalAppClient['ai'], 'scenarioJobs'>;
  readonly aiConfig?: NimiLocalAppClient['aiConfig'];
};

export type AppAgentCenterEntryProps = Readonly<{
  readonly client: AppAgentCenterEntryClient;
  readonly initialAgentHandle?: NimiLocalAppAgentHandle | null;
  readonly initialAgentReference?: NimiLocalAppAgentReference | null;
  readonly conversationAnchorId?: string | null;
  readonly hostMechanics?: AgentCenterHostMechanics | null;
  readonly showResourcePack?: boolean;
  readonly resourcePackPlacement?: AgentCenterResourcePackPlacementAdapter | null;
  readonly resourcePackPlacementForAgent?: (handle: NimiLocalAppAgentHandle) => AgentCenterResourcePackPlacementAdapter | null;
  readonly onSelectedAgentChange?: (handle: NimiLocalAppAgentHandle) => void;
  readonly placementActions?: AgentCenterPlacementActions;
  readonly language?: string | null;
  readonly className?: string;
}>;

type EntryCopy = Readonly<{
  title: string;
  description: string;
  loading: string;
  loadFailed: string;
  retry: string;
  empty: string;
  select: string;
  selected: string;
}>;

const ENTRY_COPY = Object.freeze({
  en: Object.freeze({
    title: 'Agent Center',
    description: 'Manage a partner’s appearance, models, and behavior. Changes apply in every App that uses this partner.',
    loading: 'Loading current Agents…',
    loadFailed: 'Current Agents could not be loaded.',
    retry: 'Retry',
    empty: 'No current Agent is available for this App session.',
    select: 'Open Agent Center',
    selected: 'Managing',
  }),
  zh: Object.freeze({
    title: '伙伴中心',
    description: '管理伙伴的外观、模型和行为。更改会应用到使用这位伙伴的所有应用。',
    loading: '正在加载伙伴…',
    loadFailed: '无法加载伙伴。',
    retry: '重试',
    empty: '当前应用没有可管理的伙伴。',
    select: '管理此伙伴',
    selected: '正在管理',
  }),
});

function resolveEntryCopy(language: string | null | undefined): EntryCopy {
  return language?.trim().toLowerCase().startsWith('zh') ? ENTRY_COPY.zh : ENTRY_COPY.en;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message.trim() : fallback;
}

// @nimi-authority: rule.nimi.platform.ui-design-system.p-agent-center-001a
// @nimi-authority: rule.nimi.platform.ui-design-system.p-agent-center-010
export function AppAgentCenterEntry(props: AppAgentCenterEntryProps) {
  const copy = useMemo(() => resolveEntryCopy(props.language), [props.language]);
  const i18n = useMemo(() => createAgentCenterI18n({ language: props.language }), [props.language]);
  const initialHandle = props.initialAgentReference?.agentHandle ?? props.initialAgentHandle ?? null;
  const [references, setReferences] = useState<readonly NimiLocalAppAgentReference[] | null>(
    props.initialAgentReference ? [props.initialAgentReference] : null,
  );
  const [selectedHandle, setSelectedHandle] = useState<NimiLocalAppAgentHandle | null>(
    initialHandle,
  );
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState('');
  const [session, setSession] = useState<AgentCenterSession | null>(null);
  const sessionRef = useRef<AgentCenterSession | null>(null);
  const loadEpochRef = useRef(0);

  const loadReferences = useCallback(async () => {
    if (initialHandle && !props.client.agents) {
      loadEpochRef.current += 1;
      setReferences(props.initialAgentReference ? [props.initialAgentReference] : null);
      setSelectedHandle(initialHandle);
      setLoading(false);
      setFailure('');
      return;
    }
    const epoch = ++loadEpochRef.current;
    setLoading(true);
    setFailure('');
    try {
      if (!props.client.agents) throw new Error(copy.loadFailed);
      const next = await props.client.agents.listReferences();
      if (loadEpochRef.current !== epoch) return;
      setReferences(next);
      setSelectedHandle((current) => {
        if (current && next.some((entry) => entry.agentHandle === current)) return current;
        const soleReference = next.length === 1 ? next.at(0) : undefined;
        return soleReference?.agentHandle ?? null;
      });
    } catch (error) {
      if (loadEpochRef.current !== epoch) return;
      setReferences(null);
      setSelectedHandle(null);
      setFailure(errorMessage(error, copy.loadFailed));
    } finally {
      if (loadEpochRef.current === epoch) setLoading(false);
    }
  }, [copy.loadFailed, initialHandle, props.client, props.initialAgentReference]);

  useEffect(() => {
    void loadReferences();
    return () => { loadEpochRef.current += 1; };
  }, [copy.loadFailed, loadReferences]);

  useEffect(() => {
    sessionRef.current?.invalidate();
    sessionRef.current?.dispose();
    const next = selectedHandle
      ? createAppAgentCenterSession({
        handle: selectedHandle,
        client: props.client.agentConfigure,
        ...(props.client.agents && props.client.ai && props.client.aiConfig ? {
          referenceVoiceClient: { agentConfigure: props.client.agentConfigure, agents: props.client.agents, ai: props.client.ai, aiConfig: props.client.aiConfig },
        } : {}),
        ...(props.conversationAnchorId
          && initialHandle === selectedHandle
          ? { conversationAnchorId: props.conversationAnchorId }
          : {}),
        hostMechanics: props.hostMechanics ?? null,
        resourcePackPlacement: props.resourcePackPlacementForAgent?.(selectedHandle) ?? props.resourcePackPlacement ?? null,
      })
      : null;
    sessionRef.current = next;
    setSession(next);
    return () => {
      if (sessionRef.current === next) sessionRef.current = null;
      next?.invalidate();
      next?.dispose();
    };
  }, [
    props.client,
    props.conversationAnchorId,
    props.hostMechanics,
    props.resourcePackPlacement,
    props.resourcePackPlacementForAgent,
    initialHandle,
    selectedHandle,
  ]);

  const selected = references?.find((entry) => entry.agentHandle === selectedHandle) ?? null;
  const label = (reference: NimiLocalAppAgentReference) => references && references.filter(entry => entry.displayName === reference.displayName).length > 1
    ? `${reference.displayName} · ${reference.agentBinding.slice(-6)}` : reference.displayName;
  return (
    <div className={cn('@container mx-auto max-w-[76rem] space-y-5', props.className)} data-nimi-app-agent-center-entry="true">
      <header className="flex items-start gap-4 py-2">
        <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-[var(--nimi-surface-active)] text-[var(--nimi-action-primary-bg)]">
          <Settings2 className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h1 className="m-0 text-2xl font-semibold tracking-tight text-[var(--nimi-text-primary)]">{copy.title}</h1>
          <p className="m-0 mt-1 max-w-xl text-sm leading-relaxed text-[var(--nimi-text-secondary)]">{copy.description}</p>
        </div>
      </header>
      <div className={cn('grid items-start gap-4', session && references && references.length > 1 && '@min-[50rem]:grid-cols-[14rem_minmax(0,1fr)]')}>
        {loading ? <LoadingSkeleton lines={2} label={copy.loading} /> : null}
        {failure ? (
          <div className="space-y-2">
            <InlineAlert tone="warning">{failure}</InlineAlert>
            <Button size="sm" tone="secondary" onClick={() => { void loadReferences(); }}>{copy.retry}</Button>
          </div>
        ) : null}
        {!loading && !failure && references?.length === 0 ? <InlineAlert tone="warning">{copy.empty}</InlineAlert> : null}
        {!loading && !failure && references && references.length > 1 ? (
          <div className={cn('grid gap-2', session
            ? 'grid-cols-[repeat(auto-fill,minmax(min(100%,10rem),1fr))] @min-[50rem]:grid-cols-1'
            : 'grid-cols-[repeat(auto-fill,minmax(min(100%,13rem),1fr))]')} data-nimi-app-agent-center-selector="true">
            {references.map((reference) => (
              <Button
                key={reference.agentHandle}
                tone={reference.agentHandle === selectedHandle ? 'primary' : 'secondary'}
                aria-pressed={reference.agentHandle === selectedHandle}
                aria-label={`${label(reference)} · ${reference.agentHandle === selectedHandle ? copy.selected : copy.select}`}
                title={label(reference)}
                className="min-h-14 min-w-0 justify-start gap-3 px-3 text-left [&>span]:w-full [&>span]:justify-start"
                onClick={() => {
                  if (reference.agentHandle === selectedHandle) return;
                  setSelectedHandle(reference.agentHandle);
                  props.onSelectedAgentChange?.(reference.agentHandle);
                }}
                data-nimi-app-agent-center-agent-handle={reference.agentHandle}
              >
                <Avatar
                  size="md"
                  src={reference.avatarUrl || undefined}
                  alt=""
                  fallback={reference.displayName.slice(0, 1)}
                />
                <span className="min-w-0 flex-1 truncate">{label(reference)}</span>
                {reference.agentHandle === selectedHandle
                  ? <Check className="size-4 shrink-0" aria-hidden="true" />
                  : <ChevronRight className="size-4 shrink-0 opacity-60" aria-hidden="true" />}
              </Button>
            ))}
          </div>
        ) : null}
        {session ? (
          <Surface tone="panel" className="min-w-0 px-3 pb-3 @min-[36rem]:px-5 @min-[36rem]:pb-5">
          {selected ? <p className="m-0 border-b border-[var(--nimi-border-subtle)] px-1.5 py-4 text-base font-semibold" role="status">{label(selected)}</p> : null}
          <AgentCenter
            session={session}
            i18n={i18n}
            identity={selected ? { displayName: selected.displayName, avatarUrl: selected.avatarUrl } : null}
            chrome="embedded"
            placementActions={props.placementActions}
            showResourcePack={props.showResourcePack}
          />
          </Surface>
        ) : null}
      </div>
    </div>
  );
}
