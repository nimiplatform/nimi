import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  Archive,
  ArrowRight,
  Check,
  Clock3,
  Heart,
  Image,
  MoreHorizontal,
  Network,
  Plus,
  Share2,
  Users,
} from 'lucide-react';
import {
  Avatar,
  Button,
  DataList,
  EmptyState,
  IconButton,
  LoadingSkeleton,
  NimiText,
  Statistic,
  StatisticGroup,
  StatusBadge,
  Surface,
} from '@nimiplatform/kit/ui';
import { formatNum, worldInitial } from './world-list-atoms';
import { displayTags, sourceCount } from './world-list-catalog-model';
import { WorldCover } from './world-list-cover';
import { WORLD_EXPLORER_THEME } from './world-list-theme';
import { fetchWorldDisplayDetail, worldDisplayDetailQueryKey } from './world-detail-queries.js';
import type { WorldListItem } from './world-list-model';

type PreviewPerson = {
  id: string;
  name: string;
  blurb: string;
  avatarUrl: string | null;
};

type LoadedPerson = {
  id: string;
  name?: string;
  bio?: string | null;
  avatarUrl?: string | null;
  role?: string | null;
  display?: {
    role?: string | null;
  } | null;
};

function previewPeople(world: WorldListItem, loaded: LoadedPerson[] | undefined): PreviewPerson[] {
  const fromLoaded = (loaded ?? []).filter((character) => Boolean(character.name)).map((character) => ({
    id: character.id,
    name: character.name ?? '',
    blurb: character.bio ?? character.role ?? character.display?.role ?? '',
    avatarUrl: character.avatarUrl ?? null,
  }));
  if (fromLoaded.length > 0) {
    return fromLoaded.slice(0, 3);
  }
  const fromCharacters = (world.characters ?? []).map((character) => ({
    id: character.id,
    name: character.name,
    blurb: character.bio ?? character.role ?? '',
    avatarUrl: character.avatarUrl ?? null,
  }));
  if (fromCharacters.length > 0) {
    return fromCharacters.slice(0, 3);
  }
  const fromRecommended = world.computed.entry.recommendedCharacters.map((character) => ({
    id: character.id,
    name: character.name,
    blurb: '',
    avatarUrl: character.avatarUrl ?? null,
  }));
  return fromRecommended.slice(0, 3);
}

function friendCount(world: WorldListItem): number {
  return (world.characters ?? []).filter((character) => character.ownership === 'userOwned').length;
}

export function SelectedWorldPanel({
  world,
  onOpen,
  onOpenRelationshipGraph,
  followed = false,
  followAvailable = false,
  onToggleFollow,
}: {
  world: WorldListItem;
  onOpen: () => void;
  onOpenRelationshipGraph: () => void;
  followed?: boolean;
  followAvailable?: boolean;
  onToggleFollow?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const tags = displayTags(world, 2, i18n.language);
  const peopleCount = sourceCount(world);
  const relationships = world.relationshipCount;

  const peopleQuery = useQuery({
    queryKey: worldDisplayDetailQueryKey(world.id),
    queryFn: () => fetchWorldDisplayDetail(world.id),
    enabled: peopleCount > 0,
    staleTime: 30_000,
  });
  const people = useMemo(
    () => previewPeople(world, peopleQuery.data?.characters as LoadedPerson[] | undefined),
    [world, peopleQuery.data],
  );
  const peopleLoading = peopleCount > 0 && people.length === 0 && (peopleQuery.isPending || peopleQuery.isFetching);
  const peopleEmptyTitle = peopleCount > 0
    ? t('World.atlas.preview.people.unavailable')
    : t('World.atlas.preview.people.empty');

  const friends = friendCount(world);
  const intro = world.description || world.tagline || world.overview || t('World.atlas.preview.introFallback');

  const quickEntries: { action: 'relationship-explorer' | 'world-detail'; icon: ReactNode; title: string; sub: string }[] = [
    { action: 'relationship-explorer', icon: <Users size={16} aria-hidden="true" />, title: t('World.atlas.preview.quick.people.title'), sub: t('World.atlas.preview.quick.people.sub') },
    { action: 'world-detail', icon: <Archive size={16} aria-hidden="true" />, title: t('World.atlas.preview.quick.library.title'), sub: t('World.atlas.preview.quick.library.sub') },
    { action: 'world-detail', icon: <Clock3 size={16} aria-hidden="true" />, title: t('World.atlas.preview.quick.timeline.title'), sub: t('World.atlas.preview.quick.timeline.sub') },
    { action: 'world-detail', icon: <Image size={16} aria-hidden="true" />, title: t('World.atlas.preview.quick.scenes.title'), sub: t('World.atlas.preview.quick.scenes.sub') },
  ];

  const peopleItems = people.map((person) => ({
    id: person.id,
    title: person.name,
    leading: (
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
        leadingIcon={<Plus size={14} aria-hidden="true" />}
        className="rounded-full border-[var(--world-explorer-border)] bg-[var(--world-explorer-surface)] text-[var(--world-explorer-brand)] hover:bg-[var(--world-explorer-brand-soft)]"
      >
        {t('World.atlas.preview.people.addFriend')}
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
      className="sticky top-3 min-w-0 overflow-hidden rounded-[28px]"
      style={WORLD_EXPLORER_THEME.panel}
    >
      <div className="p-4 pb-0">
        <WorldCover world={world} variant="panel" overlay>
          <div className="absolute right-3 top-3 flex gap-2">
            <IconButton
              aria-label={t('World.atlas.actions.shareWorld')}
              icon={<Share2 size={16} aria-hidden="true" />}
              tone="secondary"
              size="sm"
              className="rounded-full text-[var(--world-explorer-text-secondary)]"
              style={WORLD_EXPLORER_THEME.iconButton}
            />
            <IconButton
              aria-label={t('World.atlas.actions.moreWorldActions')}
              icon={<MoreHorizontal size={16} aria-hidden="true" />}
              tone="secondary"
              size="sm"
              className="rounded-full text-[var(--world-explorer-text-secondary)]"
              style={WORLD_EXPLORER_THEME.iconButton}
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

      <div className="p-5">
        <NimiText
          as="h2"
          role="section-title"
          data-testid="world-atlas-hero-title"
          title={world.name}
          className="truncate text-[20px] font-bold text-[var(--world-explorer-text)]"
        >
          {world.name}
        </NimiText>
        <NimiText
          data-testid="world-atlas-preview-intro"
          role="body"
          className="mt-2 text-[13.5px] font-medium leading-[1.65] text-[var(--world-explorer-text-secondary)]"
          style={WORLD_EXPLORER_THEME.introClamp}
        >
          {intro}
        </NimiText>

        <StatisticGroup
          data-testid="world-atlas-preview-overview"
          className="mt-4 grid-cols-4 gap-1 rounded-[16px] border border-[var(--world-explorer-border)] bg-[var(--world-explorer-surface)] p-2 [&_.nimi-statistic]:min-h-[58px] [&_.nimi-statistic]:content-center [&_.nimi-statistic]:justify-items-center [&_.nimi-statistic]:gap-1 [&_.nimi-statistic]:rounded-none [&_.nimi-statistic]:border-0 [&_.nimi-statistic]:bg-transparent [&_.nimi-statistic]:px-0 [&_.nimi-statistic]:py-1 [&_.nimi-statistic]:text-center [&_.nimi-statistic__label]:flex [&_.nimi-statistic__label]:justify-center [&_.nimi-statistic__label]:tracking-normal [&_.nimi-statistic__label]:normal-case [&_.nimi-statistic__label]:text-[var(--world-explorer-text-muted)] [&_.nimi-statistic__value]:max-w-full [&_.nimi-statistic__value]:justify-center [&_.nimi-statistic__value]:gap-0 [&_.nimi-statistic__value]:text-[17px] [&_.nimi-statistic__value]:leading-5 [&_.nimi-statistic__value]:font-extrabold [&_.nimi-statistic__value]:!text-[var(--world-explorer-text)] [&_.nimi-statistic__value>.truncate]:!overflow-visible [&_.nimi-statistic__value>.truncate]:!text-clip [&_.nimi-statistic__value>.truncate]:!whitespace-nowrap [&_.nimi-statistic__helper]:!overflow-visible [&_.nimi-statistic__helper]:!text-clip [&_.nimi-statistic__helper]:!whitespace-normal [&_.nimi-statistic__helper]:text-[11px] [&_.nimi-statistic__helper]:font-semibold [&_.nimi-statistic__helper]:text-[var(--world-explorer-text-secondary)]"
        >
          <Statistic value={formatNum(peopleCount)} label={<Users size={15} aria-hidden="true" />} helper={t('World.atlas.preview.metrics.people')} />
          <Statistic value={formatNum(world.entityCount)} label={<Archive size={15} aria-hidden="true" />} helper={t('World.atlas.preview.metrics.materials')} />
          <Statistic value={formatNum(world.sceneCount)} label={<Image size={15} aria-hidden="true" />} helper={t('World.atlas.preview.metrics.scenes')} />
          <Statistic
            value={relationships > 0 ? formatNum(relationships) : '0'}
            label={<Network size={15} aria-hidden="true" />}
            helper={t('World.atlas.preview.metrics.networkCompact')}
          />
        </StatisticGroup>

        <section data-testid="world-atlas-preview-people" className="mt-5">
          <PanelHeading title={t('World.atlas.preview.people.title')} action={t('World.atlas.preview.people.viewAll')} />
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
                className="overflow-visible border-0 bg-transparent [&_.nimi-data-list__aside_.nimi-action]:min-h-8 [&_.nimi-data-list__aside_.nimi-action]:px-3 [&_.nimi-data-list__description]:text-[var(--world-explorer-text-muted)] [&_.nimi-data-list__item]:mb-2 [&_.nimi-data-list__item]:rounded-[16px] [&_.nimi-data-list__item]:border [&_.nimi-data-list__item]:border-[var(--world-explorer-border)] [&_.nimi-data-list__item]:!border-b [&_.nimi-data-list__item]:!border-b-[var(--world-explorer-border)] [&_.nimi-data-list__item]:bg-[var(--world-explorer-surface)] [&_.nimi-data-list__item]:px-2.5 [&_.nimi-data-list__item]:py-2.5 last:[&_.nimi-data-list__item]:mb-0"
              />
            ) : (
              <EmptyState title={peopleEmptyTitle} className="py-4" />
            )}
          </div>
        </section>

        <section data-testid="world-atlas-preview-quick-entries" className="mt-5">
          <PanelHeading title={t('World.atlas.preview.quick.title')} />
          <div className="mt-3 grid grid-cols-2 gap-2">
            {quickEntries.map((entry) => (
              <Button
                key={entry.title}
                type="button"
                tone="secondary"
                size="md"
                fullWidth
                className="min-h-[74px] justify-start rounded-[16px] border-[var(--world-explorer-border)] bg-[var(--world-explorer-surface)] px-3 text-left shadow-none hover:bg-[var(--world-explorer-brand-soft)] hover:shadow-none [&>span]:w-full [&>span]:justify-start [&>span]:overflow-visible [&>span]:whitespace-normal"
                onClick={entry.action === 'relationship-explorer' ? onOpenRelationshipGraph : onOpen}
                title={entry.sub}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--world-explorer-brand-soft)] text-[var(--world-explorer-brand)]">
                    {entry.icon}
                  </span>
                  <span className="grid min-w-0 gap-1 text-left">
                    <span className="text-[13px] font-bold leading-tight text-[var(--world-explorer-text)]">{entry.title}</span>
                    <span className="text-[12px] font-medium leading-snug text-[var(--world-explorer-text-secondary)]">{entry.sub}</span>
                  </span>
                </span>
              </Button>
            ))}
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

        <div className="mt-4 grid grid-cols-[minmax(0,1fr)_52px] gap-3">
          <Button
            type="button"
            tone="primary"
            size="lg"
            fullWidth
            trailingIcon={<ArrowRight size={16} aria-hidden="true" />}
            className="world-panel-primary-action rounded-[16px] border-transparent bg-[var(--world-explorer-brand)] text-white hover:bg-[var(--world-explorer-brand-hover)]"
            style={WORLD_EXPLORER_THEME.primaryAction}
            onClick={onOpen}
          >
            {t('World.card.view')}
          </Button>
          <IconButton
            type="button"
            data-testid="world-panel-follow-toggle"
            aria-label={followed ? t('World.atlas.followed.unfollow') : t('World.atlas.followed.follow')}
            aria-pressed={followed}
            title={followAvailable ? undefined : t('World.atlas.followed.unavailable')}
            disabled={!followAvailable || !onToggleFollow}
            icon={<Heart size={19} fill={followed ? 'currentColor' : 'none'} aria-hidden="true" />}
            tone="secondary"
            size="lg"
            className={followed
              ? 'rounded-[16px] text-[var(--world-explorer-favorite)]'
              : 'rounded-[16px] text-[var(--world-explorer-text-muted)]'}
            style={WORLD_EXPLORER_THEME.iconButton}
            onClick={() => onToggleFollow?.()}
          />
        </div>
      </div>
    </Surface>
  );
}

function PanelHeading({ title, action }: { title: string; action?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <NimiText as="h3" role="card-title" className="text-[15px] font-bold text-[var(--world-explorer-text)]">{title}</NimiText>
      {action ? (
        <Button type="button" tone="ghost" size="sm" className="px-0 text-[var(--world-explorer-text-secondary)] hover:bg-transparent hover:text-[var(--world-explorer-brand)]">
          {action}
        </Button>
      ) : null}
    </div>
  );
}
