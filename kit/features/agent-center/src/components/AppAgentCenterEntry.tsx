import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  NimiLocalAppAgentHandle,
  NimiLocalAppAgentReference,
  NimiLocalAppClient,
} from '@nimiplatform/kit/core/sdk-contract';
import { Avatar, Button, InlineAlert, LoadingSkeleton, Surface } from '@nimiplatform/kit/ui';
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
};

export type AppAgentCenterEntryProps = Readonly<{
  readonly client: AppAgentCenterEntryClient;
  readonly initialAgentHandle?: NimiLocalAppAgentHandle | null;
  readonly initialAgentReference?: NimiLocalAppAgentReference | null;
  readonly conversationAnchorId?: string | null;
  readonly hostMechanics?: AgentCenterHostMechanics | null;
  readonly resourcePackPlacement?: AgentCenterResourcePackPlacementAdapter | null;
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
    description: 'Choose a current Agent, then manage the same canonical owner surface available to every covered App.',
    loading: 'Loading current Agents…',
    loadFailed: 'Current Agents could not be loaded.',
    retry: 'Retry',
    empty: 'No current Agent is available for this App session.',
    select: 'Open Agent Center',
    selected: 'Current Agent',
  }),
  zh: Object.freeze({
    title: 'Agent Center',
    description: '选择当前 Agent，然后使用所有同 coverage App 共用的规范 owner surface。',
    loading: '正在加载当前 Agent…',
    loadFailed: '无法加载当前 Agent。',
    retry: '重试',
    empty: '当前 App session 没有可用 Agent。',
    select: '打开 Agent Center',
    selected: '当前 Agent',
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
  const [selectedExplicitly, setSelectedExplicitly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState('');
  const [session, setSession] = useState<AgentCenterSession | null>(null);
  const sessionRef = useRef<AgentCenterSession | null>(null);
  const loadEpochRef = useRef(0);

  const loadReferences = useCallback(async () => {
    if (initialHandle) {
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
    setSelectedExplicitly(false);
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
        ...(props.conversationAnchorId
          && initialHandle === selectedHandle
          && !selectedExplicitly
          ? { conversationAnchorId: props.conversationAnchorId }
          : {}),
        hostMechanics: props.hostMechanics ?? null,
        resourcePackPlacement: props.resourcePackPlacement ?? null,
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
    initialHandle,
    selectedExplicitly,
    selectedHandle,
  ]);

  const selected = references?.find((entry) => entry.agentHandle === selectedHandle) ?? null;
  return (
    <div className={props.className} data-nimi-app-agent-center-entry="true">
      <Surface tone="panel" className="space-y-3 p-4">
        <div>
          <h2 className="m-0 text-[length:var(--nimi-type-section-title-size)] font-semibold text-[var(--nimi-text-primary)]">{copy.title}</h2>
          <p className="m-0 mt-1 text-sm text-[var(--nimi-text-secondary)]">{copy.description}</p>
        </div>
        {loading ? <LoadingSkeleton lines={2} label={copy.loading} /> : null}
        {failure ? (
          <div className="space-y-2">
            <InlineAlert tone="warning">{failure}</InlineAlert>
            <Button size="sm" tone="secondary" onClick={() => { void loadReferences(); }}>{copy.retry}</Button>
          </div>
        ) : null}
        {!loading && !failure && references?.length === 0 ? <InlineAlert tone="warning">{copy.empty}</InlineAlert> : null}
        {!loading && !failure && references && references.length > 1 ? (
          <div className="grid gap-2" data-nimi-app-agent-center-selector="true">
            {references.map((reference) => (
              <Button
                key={reference.agentHandle}
                tone={reference.agentHandle === selectedHandle ? 'primary' : 'secondary'}
                disabled={reference.agentHandle === selectedHandle}
                onClick={() => {
                  setSelectedExplicitly(true);
                  setSelectedHandle(reference.agentHandle);
                }}
                data-nimi-app-agent-center-agent-handle={reference.agentHandle}
              >
                <Avatar
                  size="sm"
                  src={reference.avatarUrl || undefined}
                  alt={reference.displayName}
                  fallback={reference.displayName.slice(0, 1)}
                />
                <span>{reference.displayName}</span>
                <span className="text-xs opacity-70">
                  {reference.agentHandle === selectedHandle ? copy.selected : copy.select}
                </span>
              </Button>
            ))}
          </div>
        ) : null}
      </Surface>
      {session ? (
        <AgentCenter
          session={session}
          i18n={i18n}
          identity={selected ? { displayName: selected.displayName, avatarUrl: selected.avatarUrl } : null}
          chrome="embedded"
          placementActions={props.placementActions}
        />
      ) : null}
    </div>
  );
}
