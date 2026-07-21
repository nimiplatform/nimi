import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import type { CharacterSourceRefV3 } from '../realm-source/realm-source-identity.js';
import {
  ArrowRight,
  Check,
  Heart,
  Plus,
} from 'lucide-react';
import {
  Avatar,
  Button,
  DataList,
  EmptyState,
  IconButton,
  LoadingSkeleton,
  NimiText,
  StatisticGroup,
  StatusBadge,
  Surface,
} from '@nimiplatform/kit/ui';
import { worldInitial } from './world-list-atoms';
import { displayTags, sourceCount } from './world-list-catalog-model';
import { WorldCover } from './world-list-cover';
import { WORLD_EXPLORER_THEME } from './world-list-theme';
import { fetchWorldPrimaryDisplayDetail, worldPrimaryDisplayDetailQueryKey } from './world-detail-queries.js';
import type { WorldCharacter } from './world-detail-types';
import type { WorldCharacterItem, WorldListItem } from './world-list-model';

type PreviewPerson = {
  id: string;
  name: string;
  blurb: string;
  avatarUrl: string | null;
  sourceRef: CharacterSourceRefV3 | null;
  character: WorldCharacter | null;
};

function previewPeople(world: WorldListItem, loaded: readonly WorldCharacter[] | undefined): PreviewPerson[] {
  const fromLoaded = (loaded ?? []).filter((character) => Boolean(character.name)).map((character) => ({
    id: character.id,
    name: character.name,
    blurb: character.bio ?? character.role ?? '',
    avatarUrl: character.avatarUrl ?? null,
    sourceRef: character.sourceRef,
    character,
  }));
  if (fromLoaded.length > 0) {
    return fromLoaded.slice(0, 3);
  }
  const fromCharacters = (world.characters ?? []).map((character: WorldCharacterItem) => ({
    id: character.id,
    name: character.name,
    blurb: character.bio ?? character.role ?? '',
    avatarUrl: character.avatarUrl ?? null,
    sourceRef: character.sourceRef ?? null,
    character: null,
  }));
  if (fromCharacters.length > 0) {
    return fromCharacters.slice(0, 3);
  }
  const fromRecommended = world.computed.entry.recommendedCharacters.map((character) => ({
    id: character.id,
    name: character.name,
    blurb: '',
    avatarUrl: character.avatarUrl ?? null,
    sourceRef: null,
    character: null,
  }));
  return fromRecommended.slice(0, 3);
}

function friendCount(world: WorldListItem): number {
  return (world.characters ?? []).filter((character) => character.ownership === 'userOwned').length;
}

function localAgentActionLabel(person: PreviewPerson, t: ReturnType<typeof useTranslation>['t']): string {
  const state = person.character?.relation?.state;
  if (state === 'connected') {
    return t('World.atlas.preview.people.localAgentReady');
  }
  if (state === 'unavailable' || !person.character) {
    return t('World.atlas.preview.people.localAgentUnavailable');
  }
  return t('World.atlas.preview.people.joinLocalAgent');
}

function formatPanelMetric(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(Math.round(n));
}

export function SelectedWorldPanel({
  world,
  onOpen,
  onOpenPerson,
  onMaterializePerson,
  followed = false,
  followAvailable = false,
  onToggleFollow,
}: {
  world: WorldListItem;
  onOpen: () => void;
  onOpenPerson?: (sourceRef: CharacterSourceRefV3) => void;
  onMaterializePerson?: (character: WorldCharacter) => Promise<void> | void;
  followed?: boolean;
  followAvailable?: boolean;
  onToggleFollow?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const tags = displayTags(world, 2, i18n.language);
  const peopleCount = sourceCount(world);
  const relationships = world.relationshipCount;

  const peopleQuery = useQuery({
    queryKey: worldPrimaryDisplayDetailQueryKey(world.id),
    queryFn: () => fetchWorldPrimaryDisplayDetail(world.id),
    enabled: Boolean(world.id),
    staleTime: 30_000,
  });
  const people = useMemo(
    () => previewPeople(world, peopleQuery.data?.characters),
    [world, peopleQuery.data],
  );
  const peopleLoading = people.length === 0 && (peopleQuery.isPending || peopleQuery.isFetching);
  const peopleEmptyTitle = peopleCount > 0
    ? t('World.atlas.preview.people.unavailable')
    : t('World.atlas.preview.people.empty');

  const friends = friendCount(world);
  const intro = world.description || world.tagline || world.overview || t('World.atlas.preview.introFallback');

  const peopleItems = people.map((person) => ({
    id: person.id,
    title: person.sourceRef && onOpenPerson ? (
      <button
        type="button"
        className="max-w-full truncate text-left text-sm font-semibold text-[var(--world-explorer-text)] hover:text-[var(--world-explorer-brand)]"
        aria-label={t('World.atlas.preview.people.openProfile', { name: person.name })}
        onClick={() => onOpenPerson(person.sourceRef as CharacterSourceRefV3)}
      >
        {person.name}
      </button>
    ) : person.name,
    leading: person.sourceRef && onOpenPerson ? (
      <button
        type="button"
        className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[var(--world-explorer-brand)] focus-visible:ring-offset-2"
        aria-label={t('World.atlas.preview.people.openProfile', { name: person.name })}
        onClick={() => onOpenPerson(person.sourceRef as CharacterSourceRefV3)}
      >
        <Avatar
          alt={person.name}
          src={person.avatarUrl}
          size="md"
          fallback={worldInitial(person.name)}
          fallbackClassName="bg-[image:var(--nimi-surface-hero)] text-[var(--nimi-action-primary-text)]"
        />
      </button>
    ) : (
      <Avatar
        alt={person.name}
        src={person.avatarUrl}
        size="md"
        fallback={worldInitial(person.name)}
        fallbackClassName="bg-[image:var(--nimi-surface-hero)] text-[var(--nimi-action-primary-text)]"
      />
    ),
    actions: (
      <Button
        type="button"
        tone="secondary"
        size="sm"
        disabled={!person.character || person.character.relation?.state !== 'connectable' || !onMaterializePerson}
        onClick={() => {
          if (person.character) {
            void onMaterializePerson?.(person.character);
          }
        }}
        leadingIcon={<Plus size={14} aria-hidden="true" />}
        className="rounded-full border-[var(--world-explorer-border)] bg-[var(--world-explorer-surface)] text-[var(--world-explorer-brand)] hover:bg-[var(--world-explorer-brand-soft)]"
      >
        {localAgentActionLabel(person, t)}
      </Button>
    ),
  }));

  return (
    <Surface
      as="aside"
      tone="panel"
      material="solid"
      elevation="base"
      padding="none"
      data-testid="world-atlas-selected-panel"
      className="w-full min-w-0 max-w-full overflow-hidden rounded-[32px] min-[1180px]:sticky min-[1180px]:top-3"
      style={WORLD_EXPLORER_THEME.panel}
    >
      <div className="p-4 pb-0 sm:p-5 sm:pb-0">
        <WorldCover world={world} variant="panel" overlay>
          <div className="absolute right-3 top-3">
            <IconButton
              type="button"
              data-testid="world-panel-follow-toggle"
              aria-label={followed ? t('World.atlas.followed.unfollow') : t('World.atlas.followed.follow')}
              aria-pressed={followed}
              title={followAvailable ? undefined : t('World.atlas.followed.unavailable')}
              disabled={!followAvailable || !onToggleFollow}
              icon={<Heart size={16} fill={followed ? 'currentColor' : 'none'} aria-hidden="true" />}
              tone="secondary"
              size="sm"
              className={followed
                ? 'rounded-full text-[var(--world-explorer-favorite)]'
                : 'rounded-full text-[var(--world-explorer-text-muted)]'}
              style={WORLD_EXPLORER_THEME.iconButton}
              onClick={() => onToggleFollow?.()}
            />
          </div>
          <div className="absolute right-4 bottom-4 left-4 flex flex-wrap gap-1.5">
            {tags.length > 0 ? (
              tags.map((tag) => (
                <StatusBadge key={tag} tone="neutral" shape="soft" className="bg-white/80 text-[var(--world-explorer-text)]">
                  {tag}
                </StatusBadge>
              ))
            ) : null}
          </div>
        </WorldCover>
      </div>

      <div className="p-4 sm:p-6">
        <NimiText
          as="h2"
          role="section-title"
          data-testid="world-atlas-hero-title"
          title={world.name}
          className="w-full truncate text-center text-[20px] font-bold text-[var(--world-explorer-text)]"
        >
          {world.name}
        </NimiText>

        <StatisticGroup
          data-testid="world-atlas-preview-overview"
          className="mt-4 grid-cols-2 gap-1 min-[460px]:grid-cols-4"
        >
          <PanelMetric value={formatPanelMetric(peopleCount)} helper={t('World.atlas.preview.metrics.people')} />
          <PanelMetric value={formatPanelMetric(world.entityCount)} helper={t('World.atlas.preview.metrics.materials')} />
          <PanelMetric value={formatPanelMetric(world.sceneCount)} helper={t('World.atlas.preview.metrics.scenes')} />
          <PanelMetric
            value={relationships > 0 ? formatPanelMetric(relationships) : '0'}
            helper={t('World.atlas.preview.metrics.networkCompact')}
          />
        </StatisticGroup>
        <NimiText
          data-testid="world-atlas-preview-intro"
          role="body"
          className="mt-3 text-[13.5px] font-medium leading-[1.65] text-[var(--world-explorer-text-secondary)]"
        >
          {intro}
        </NimiText>

        <section data-testid="world-atlas-preview-people" className="mt-5">
          <PanelHeading title={t('World.atlas.preview.people.title')} />
          <div className="mt-3">
            {peopleLoading ? (
              <Surface tone="card" material="solid" padding="md" className="grid gap-3 rounded-[16px]" style={WORLD_EXPLORER_THEME.weakBlock}>
                <LoadingSkeleton lines={2} />
                <LoadingSkeleton lines={2} />
                <LoadingSkeleton lines={2} />
              </Surface>
            ) : peopleItems.length > 0 ? (
              <DataList
                items={peopleItems}
                ariaLabel={t('World.atlas.preview.people.title')}
                className="min-w-0 overflow-visible border-0 bg-transparent [&_.nimi-data-list__aside_.nimi-action]:min-h-8 [&_.nimi-data-list__aside_.nimi-action]:px-3 [&_.nimi-data-list__description]:text-[var(--world-explorer-text-muted)] [&_.nimi-data-list__item]:mb-2 [&_.nimi-data-list__item]:min-w-0 [&_.nimi-data-list__item]:rounded-[16px] [&_.nimi-data-list__item]:border [&_.nimi-data-list__item]:border-[var(--world-explorer-border)] [&_.nimi-data-list__item]:!border-b [&_.nimi-data-list__item]:!border-b-[var(--world-explorer-border)] [&_.nimi-data-list__item]:bg-[var(--world-explorer-surface)] [&_.nimi-data-list__item]:px-2.5 [&_.nimi-data-list__item]:py-2.5 last:[&_.nimi-data-list__item]:mb-0"
              />
            ) : (
              <EmptyState title={peopleEmptyTitle} className="py-4" />
            )}
          </div>
        </section>

        {friends > 0 ? (
          <Surface
            data-testid="world-atlas-preview-status"
            tone="card"
            material="solid"
            elevation="base"
            padding="sm"
            className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[14px]"
            style={WORLD_EXPLORER_THEME.weakBlock}
          >
            <StatusBadge tone="success" shape="dot">
              <Check size={13} aria-hidden="true" />
              {t('World.atlas.preview.status.friends', { count: friends })}
            </StatusBadge>
          </Surface>
        ) : null}

        <div className="mt-4">
          <Button
            type="button"
            tone="primary"
            size="lg"
            fullWidth
            trailingIcon={<ArrowRight size={16} aria-hidden="true" />}
            className="world-panel-primary-action rounded-[20px] border-transparent bg-[var(--world-explorer-brand)] text-[var(--nimi-action-primary-text)] hover:bg-[var(--world-explorer-brand-hover)]"
            style={WORLD_EXPLORER_THEME.primaryAction}
            onClick={onOpen}
          >
            {t('World.card.view')}
          </Button>
        </div>
      </div>
    </Surface>
  );
}

function PanelMetric({ value, helper }: { value: string; helper: string }) {
  return (
    <div className="grid min-w-0 justify-items-center gap-1 py-1 text-center">
      <span className="max-w-full overflow-visible text-clip whitespace-nowrap text-[17px] font-extrabold leading-5 text-[var(--world-explorer-text)]">
        {value}
      </span>
      <span className="overflow-visible text-clip whitespace-normal text-[11px] font-semibold text-[var(--world-explorer-text-secondary)]">
        {helper}
      </span>
    </div>
  );
}

function PanelHeading({ title }: { title: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <NimiText as="h3" role="card-title" className="text-[15px] font-bold text-[var(--world-explorer-text)]">{title}</NimiText>
    </div>
  );
}
