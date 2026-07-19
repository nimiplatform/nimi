import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Bot } from 'lucide-react';
import {
  Button,
  EmptyState,
  LoadingSkeleton,
  ScrollArea,
  SearchField,
  Surface,
} from '@nimiplatform/kit/ui';
import { EntityAvatar } from '@renderer/components/entity-avatar.js';
import { E2E_IDS } from '@renderer/testability/e2e-ids';
import {
  fetchSourceDisplayDetail,
  sourceDisplayDetailQueryKey,
} from '@renderer/features/source-detail/source-detail-queries';
import type { LocalAgentListItem } from './local-agent-list-model';
import type { AuthStatus } from '@renderer/app-shell/providers/app-store';

const ICON_AGENT_EMPTY = <Bot size={20} aria-hidden="true" />;

function LocalAgentCard({
  item,
  worldName,
  onOpen,
}: {
  item: LocalAgentListItem;
  worldName: string | null;
  onOpen: () => void;
}) {
  const detailQuery = useQuery({
    queryKey: sourceDisplayDetailQueryKey(item.sourceRef),
    queryFn: async () => fetchSourceDisplayDetail(item.sourceRef),
    staleTime: 60_000,
  });
  const source = detailQuery.data?.source ?? null;
  const displayName = source?.displayName || item.displayName;
  const handle = source?.handle || item.sourceRef.id;
  const bio = source?.bio ?? null;

  return (
    <Surface
      as="button"
      type="button"
      tone="card"
      material="glass-thin"
      padding="md"
      data-testid={E2E_IDS.agentsCard(item.localAgentRef)}
      onClick={onOpen}
      className="flex min-w-0 items-start gap-3 text-left transition-shadow duration-150 hover:shadow-[0_10px_30px_rgba(15,23,42,0.10)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nimi-focus-ring-color)]"
    >
      <EntityAvatar
        imageUrl={source?.avatarUrl ?? null}
        name={displayName}
        kind="agent"
        sizeClassName="h-12 w-12"
        className="shrink-0"
      />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-semibold text-[var(--nimi-text-primary)]">
            {displayName}
          </span>
          {worldName ? (
            <span className="shrink-0 rounded-full bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)] px-2 py-0.5 text-[10px] font-medium text-[var(--nimi-action-primary-bg)]">
              {worldName}
            </span>
          ) : null}
        </span>
        <span className="truncate text-xs text-[var(--nimi-text-secondary)]">@{handle}</span>
        {bio ? (
          <span className="line-clamp-2 text-xs leading-relaxed text-[var(--nimi-text-secondary)]">
            {bio}
          </span>
        ) : null}
      </span>
    </Surface>
  );
}

export type AgentsPanelViewProps = {
  authStatus: AuthStatus;
  agents: LocalAgentListItem[];
  agentsPending: boolean;
  agentsErrorMessage: string | null;
  worldNameById: ReadonlyMap<string, string>;
  onRetry: () => void;
  onOpenAgent: (item: LocalAgentListItem) => void;
  onBrowseExplore: () => void;
};

export function AgentsPanelView(props: AgentsPanelViewProps) {
  const { t } = useTranslation();
  const [searchText, setSearchText] = useState('');

  const filteredAgents = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    if (!query) return props.agents;
    return props.agents.filter((item) => {
      const worldName = props.worldNameById.get(item.sourceRef.worldId) || '';
      return item.displayName.toLowerCase().includes(query)
        || item.sourceRef.id.toLowerCase().includes(query)
        || worldName.toLowerCase().includes(query);
    });
  }, [props.agents, props.worldNameById, searchText]);

  let body: ReactNode;
  if (props.authStatus !== 'authenticated') {
    body = (
      <EmptyState
        icon={ICON_AGENT_EMPTY}
        title={t('Agents.signedOutTitle', { defaultValue: 'Sign in to see your characters' })}
        description={t('Agents.signedOutDescription', {
          defaultValue: 'Your local characters are tied to your account.',
        })}
        className="mx-auto mt-16 max-w-[420px]"
      />
    );
  } else if (props.agentsPending) {
    body = (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <Surface key={index} tone="card" material="glass-thin" padding="md">
            <LoadingSkeleton lines={2} />
          </Surface>
        ))}
      </div>
    );
  } else if (props.agentsErrorMessage !== null) {
    body = (
      <EmptyState
        icon={ICON_AGENT_EMPTY}
        title={t('Agents.loadErrorTitle', { defaultValue: 'Failed to load your characters' })}
        description={
          props.agentsErrorMessage.trim()
            || t('Agents.loadErrorDescription', { defaultValue: 'The local runtime did not return your character list.' })
        }
        action={(
          <Button size="sm" onClick={props.onRetry}>
            {t('Common.retry', { defaultValue: 'Retry' })}
          </Button>
        )}
        className="mx-auto mt-16 max-w-[420px]"
      />
    );
  } else if (props.agents.length === 0) {
    body = (
      <EmptyState
        icon={ICON_AGENT_EMPTY}
        title={t('Agents.emptyTitle', { defaultValue: 'No characters yet' })}
        description={t('Agents.emptyDescription', {
          defaultValue: 'Join characters from Explore or a world page and they will appear here.',
        })}
        action={(
          <Button size="sm" onClick={props.onBrowseExplore}>
            {t('Agents.emptyAction', { defaultValue: 'Browse Explore' })}
          </Button>
        )}
        className="mx-auto mt-16 max-w-[420px]"
      />
    );
  } else if (filteredAgents.length === 0) {
    body = (
      <EmptyState
        icon={ICON_AGENT_EMPTY}
        title={t('Agents.searchEmptyTitle', { defaultValue: 'No matching characters' })}
        description={t('Agents.searchEmptyDescription', {
          defaultValue: 'Try a different name or world.',
        })}
        className="mx-auto mt-16 max-w-[420px]"
      />
    );
  } else {
    body = (
      <div
        data-testid={E2E_IDS.agentsList}
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
      >
        {filteredAgents.map((item) => (
          <LocalAgentCard
            key={item.localAgentRef}
            item={item}
            worldName={props.worldNameById.get(item.sourceRef.worldId) || null}
            onOpen={() => props.onOpenAgent(item)}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-end gap-3 px-6 pb-3 pt-5">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-[var(--nimi-text-primary)]">
            {t('Agents.title', { defaultValue: 'My Characters' })}
          </h1>
          <p className="text-xs text-[var(--nimi-text-secondary)]">
            {t('Agents.subtitle', {
              defaultValue: 'Characters you joined, running as local agents on this device.',
            })}
          </p>
        </div>
        <div className="ml-auto w-full min-w-[220px] max-w-[360px]">
          <SearchField
            data-testid={E2E_IDS.agentsSearchField}
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder={t('Agents.searchPlaceholder', {
              defaultValue: 'Search characters by name or world...',
            })}
          />
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1" viewportClassName="px-6 pb-6 pt-1">
        {body}
      </ScrollArea>
    </div>
  );
}
