import { useMemo, useState, type ReactNode } from 'react';
import { useWorldMaterialization } from './world-materialization-context.js';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState, ScrollArea } from '@nimiplatform/kit/ui';
import type { WorldCharacter, WorldPeopleCatalogState } from './world-detail-types.js';
import { characterMeta, formatNum } from './world-detail-template-model';
import { worldDetailPaperContentFrameStyle } from './world-detail-layout.js';
import { PeopleCatalogFirstPageStatus, PeopleCatalogMoreControl } from './world-detail-people-catalog-status.js';
import {
  IconChat,
  IconChevron,
  IconPlus,
  IconUsers,
  PaperAvatar,
} from './world-detail-paper-primitives';
import {
  availableGroupBys,
  buildPeopleGroups,
  connectableCount,
  defaultPeopleGroupBy,
  type PeopleGroup,
  type PeopleGroupBy,
} from './world-detail-people-gallery-model';

function groupTitle(group: PeopleGroup, t: ReturnType<typeof useTranslation>['t']): string {
  if (group.kind === 'faction') {
    return group.label ?? t('WorldDetail.paper.gallery.faction.ungrouped.label');
  }
  return t(`WorldDetail.paper.gallery.${group.kind}.${group.labelKey}.label`);
}

function groupCaption(group: PeopleGroup, t: ReturnType<typeof useTranslation>['t']): string {
  if (group.kind === 'faction') {
    return group.label
      ? t('WorldDetail.paper.gallery.faction.member', { count: group.characters.length })
      : t('WorldDetail.paper.gallery.faction.ungrouped.caption');
  }
  return t(`WorldDetail.paper.gallery.${group.kind}.${group.labelKey}.caption`);
}

const PEOPLE_ARCHIVE_PANEL_MIN_HEIGHT_PX = 560;

/** Compact pill action pinned to the card header — replaces the old full-width bottom button. */
function PeopleCardAction({
  character,
  onMaterializeSource,
  onOpenConversation,
}: {
  character: WorldCharacter;
  onMaterializeSource?: (character: WorldCharacter) => Promise<void> | void;
  onOpenConversation?: (character: WorldCharacter) => Promise<void> | void;
}) {
  const { t } = useTranslation();
  const materialization = useWorldMaterialization();
  const state = character.relation?.state;
  if (state === 'connected') {
    return (
      <button
        type="button"
        onClick={() => onOpenConversation?.(character)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0,
          padding: '5px 11px', borderRadius: 999, border: 'none',
          background: 'var(--nimi-action-primary-bg)', color: 'var(--nimi-action-primary-text)',
          fontFamily: 'var(--nimi-font-sans)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
        }}
      >
        <IconChat size={13} color="currentColor" strokeWidth={2.2} />
        {t('WorldDetail.paper.characters.chatNow')}
      </button>
    );
  }
  if (state === 'connectable') {
    const blocked = !materialization.ready || materialization.isPending(character);
    return (
      <button
        type="button"
        disabled={blocked}
        aria-busy={materialization.isPending(character) || undefined}
        onClick={() => onMaterializeSource?.(character)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0,
          padding: '5px 11px', borderRadius: 999,
          border: '1px solid color-mix(in srgb, var(--nimi-action-primary-bg) 32%, transparent)',
          background: 'color-mix(in srgb, var(--nimi-action-primary-bg) 8%, transparent)',
          color: 'var(--nimi-action-primary-bg)',
          fontFamily: 'var(--nimi-font-sans)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
        }}
      >
        <IconPlus size={13} color="currentColor" strokeWidth={2.2} />
        {t('WorldDetail.paper.characters.connect')}
      </button>
    );
  }
  return (
    <span
      style={{
        flexShrink: 0, padding: '4px 9px', borderRadius: 999,
        fontSize: 11, fontWeight: 600, color: 'var(--nimi-text-muted)',
        background: 'color-mix(in srgb, var(--nimi-text-muted) 10%, transparent)',
      }}
    >
      {t('WorldDetail.paper.characters.unavailable')}
    </span>
  );
}

function PeopleCard({
  character,
  onSelect,
  onViewCharacter,
  onMaterializeSource,
  onOpenConversation,
}: {
  character: WorldCharacter;
  onSelect: (characterId: string) => void;
  onViewCharacter?: (character: WorldCharacter) => void;
  onMaterializeSource?: (character: WorldCharacter) => Promise<void> | void;
  onOpenConversation?: (character: WorldCharacter) => Promise<void> | void;
}) {
  const { t } = useTranslation();
  const cardStyle: CSSProperties = {
    background: 'var(--nimi-surface-panel)',
    border: '1px solid var(--nimi-border-subtle)',
    borderRadius: 'var(--nimi-radius-md)',
    padding: 13,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  };
  const vitality = character.stats?.vitalityScore;
  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', gap: 11, alignItems: 'center' }}>
        <button
          type="button"
          aria-label={t('WorldDetail.paper.characters.openProfile', {
            name: character.name,
            defaultValue: `Open ${character.name} profile`,
          })}
          onClick={() => (onViewCharacter ? onViewCharacter(character) : onSelect(character.id))}
          style={{ border: 0, background: 'transparent', padding: 0, cursor: 'pointer', flexShrink: 0 }}
        >
          <PaperAvatar name={character.name} imageUrl={character.avatarUrl} size={44} />
        </button>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <button
              type="button"
              aria-label={t('WorldDetail.paper.characters.openProfile', {
                name: character.name,
                defaultValue: `Open ${character.name} profile`,
              })}
              onClick={() => (onViewCharacter ? onViewCharacter(character) : onSelect(character.id))}
              style={{ border: 0, background: 'transparent', padding: 0, cursor: 'pointer', fontSize: 15, fontWeight: 700, color: 'var(--nimi-text-primary)', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {character.name}
            </button>
          </div>
          <div style={{ fontSize: 12, color: 'var(--nimi-text-secondary)', lineHeight: 1.5, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {characterMeta(character)}
          </div>
        </div>
        <PeopleCardAction
          character={character}
          onMaterializeSource={onMaterializeSource}
          onOpenConversation={onOpenConversation}
        />
      </div>

      {typeof vitality === 'number' && vitality > 0 ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11.5, color: 'var(--nimi-text-muted)' }}>
            {t('WorldDetail.paper.characters.vitality')}{' '}
            <span style={{ fontWeight: 700, color: 'var(--nimi-text-primary)' }}>{formatNum(Math.round(vitality))}</span>
          </span>
        </div>
      ) : null}
    </div>
  );
}

function GroupBySwitch({
  axes,
  active,
  onChange,
}: {
  axes: readonly PeopleGroupBy[];
  active: PeopleGroupBy;
  onChange: (axis: PeopleGroupBy) => void;
}) {
  const { t } = useTranslation();
  return (
    <div style={{ display: 'inline-flex', gap: 4, padding: 4, borderRadius: 999, background: 'var(--nimi-surface-panel)', border: '1px solid var(--nimi-border-subtle)' }}>
      {axes.map((axis) => {
        const isActive = axis === active;
        return (
          <button
            key={axis}
            type="button"
            onClick={() => onChange(axis)}
            style={{
              fontFamily: 'inherit',
              fontSize: 12.5,
              fontWeight: 600,
              padding: '6px 14px',
              borderRadius: 999,
              border: 'none',
              cursor: 'pointer',
              background: isActive ? 'var(--nimi-action-primary-bg)' : 'transparent',
              color: isActive ? 'var(--nimi-action-primary-text)' : 'var(--nimi-text-secondary)',
              boxShadow: isActive ? 'var(--nimi-elevation-raised)' : 'none',
            }}
          >
            {t(`WorldDetail.paper.gallery.groupBy.${axis}`)}
          </button>
        );
      })}
    </div>
  );
}

function PeopleArchiveShell({
  axes,
  effectiveGroupBy,
  groups,
  listStatus,
  onMaterializeSource,
  onOpenConversation,
  onGroupByChange,
  onQueryChange,
  onSelect,
  onViewCharacter,
  query,
  subtitle,
  title,
}: {
  axes: readonly PeopleGroupBy[];
  effectiveGroupBy: PeopleGroupBy;
  groups: readonly PeopleGroup[];
  // Replaces the list while the first page of the current query is loading or failed.
  listStatus: ReactNode;
  onMaterializeSource?: (character: WorldCharacter) => Promise<void> | void;
  onOpenConversation?: (character: WorldCharacter) => Promise<void> | void;
  onGroupByChange: (axis: PeopleGroupBy) => void;
  onQueryChange: (value: string) => void;
  onSelect: (characterId: string) => void;
  onViewCharacter?: (character: WorldCharacter) => void;
  query: string;
  subtitle: string;
  title: string;
}) {
  const { t } = useTranslation();
  return (
    <section
      style={{
        position: 'relative',
        zIndex: 1,
        width: '100%',
        maxWidth: 1080,
        minHeight: PEOPLE_ARCHIVE_PANEL_MIN_HEIGHT_PX,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--nimi-surface-card)',
        border: '1px solid var(--nimi-border-subtle)',
        borderRadius: 'var(--nimi-radius-xl)',
        boxShadow: 'var(--nimi-elevation-raised)',
        overflow: 'hidden',
      }}
    >
      <div style={{ padding: '22px 26px 16px', borderBottom: '1px solid var(--nimi-border-subtle)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <span style={{ width: 4, height: 20, borderRadius: 2, background: 'var(--nimi-action-primary-bg)', flexShrink: 0 }} />
              <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--nimi-text-primary)' }}>
                {title}
              </h2>
            </div>
            <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--nimi-text-secondary)', lineHeight: 1.6 }}>
              {subtitle}
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 16 }}>
          <GroupBySwitch axes={axes} active={effectiveGroupBy} onChange={onGroupByChange} />
          <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
            <input
              type="text"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder={t('WorldDetail.paper.gallery.searchPlaceholder')}
              style={{
                width: '100%',
                fontFamily: 'inherit',
                fontSize: 13,
                color: 'var(--nimi-text-primary)',
                padding: '9px 14px',
                borderRadius: 999,
                border: '1px solid var(--nimi-border-subtle)',
                background: 'var(--nimi-surface-panel)',
                outline: 'none',
              }}
            />
          </div>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1" viewportClassName="px-6 py-5">
        {listStatus ?? (groups.length === 0 ? (
          <EmptyState
            icon={<IconUsers size={30} color="var(--nimi-text-muted)" strokeWidth={1.5} />}
            title={t('WorldDetail.paper.gallery.empty')}
            style={{ margin: '36px 20px' }}
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
            {groups.map((group) => (
              <div key={`${group.kind}-${group.id}`}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
                  <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--nimi-text-primary)' }}>
                    {groupTitle(group, t)}
                  </h3>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--nimi-action-primary-bg)', padding: '1px 9px', borderRadius: 999, background: 'color-mix(in srgb, var(--nimi-action-primary-bg) 14%, transparent)' }}>
                    {t('WorldDetail.paper.gallery.count', { count: group.characters.length })}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--nimi-text-muted)' }}>{groupCaption(group, t)}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(248px,1fr))', gap: 13 }}>
                  {group.characters.map((character) => (
                    <PeopleCard
                      key={character.id}
                      character={character}
                      onSelect={onSelect}
                      onViewCharacter={onViewCharacter}
                      onMaterializeSource={onMaterializeSource}
                      onOpenConversation={onOpenConversation}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}
      </ScrollArea>
    </section>
  );
}

export function WorldPeopleArchivePage({
  characters,
  catalog,
  onBack,
  onSelect,
  onViewCharacter,
  onMaterializeSource,
  onOpenConversation,
}: {
  characters: readonly WorldCharacter[];
  catalog: WorldPeopleCatalogState;
  onBack: () => void;
  onSelect: (characterId: string) => void;
  onViewCharacter?: (character: WorldCharacter) => void;
  onMaterializeSource?: (character: WorldCharacter) => Promise<void> | void;
  onOpenConversation?: (character: WorldCharacter) => Promise<void> | void;
}) {
  const { t } = useTranslation();
  const axes = useMemo(() => availableGroupBys(characters), [characters]);
  const [groupBy, setGroupBy] = useState<PeopleGroupBy>(() => defaultPeopleGroupBy(characters));
  // Search runs on Realm over the whole population; the loaded pages are shown as returned.
  const effectiveGroupBy = axes.includes(groupBy) ? groupBy : axes[0] ?? 'tier';
  const groups = useMemo(() => buildPeopleGroups(characters, effectiveGroupBy), [characters, effectiveGroupBy]);
  const connectable = useMemo(() => connectableCount(characters), [characters]);
  const ready = catalog.status === 'ready';

  return (
    <div
      data-testid="world-detail-people-archive-page"
      style={{ position: 'relative', minHeight: '100%', fontFamily: 'var(--nimi-font-sans)' }}
    >
      <div style={worldDetailPaperContentFrameStyle()}>
        <button
          type="button"
          onClick={onBack}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 7, marginBottom: 14, fontFamily: 'inherit', fontSize: 13, fontWeight: 600, color: 'var(--nimi-action-primary-bg)', border: '1px solid var(--nimi-border-subtle)', borderRadius: 999, background: 'var(--nimi-surface-card)', padding: '8px 13px', cursor: 'pointer', boxShadow: 'var(--nimi-elevation-base)' }}
        >
          <span style={{ transform: 'rotate(180deg)', display: 'inline-flex' }}>
            <IconChevron size={13} color="var(--nimi-action-primary-bg)" />
          </span>
          {t('WorldDetail.paper.gallery.backToWorld')}
        </button>
        <PeopleArchiveShell
          effectiveGroupBy={effectiveGroupBy}
          groups={groups}
          listStatus={ready ? null : <PeopleCatalogFirstPageStatus catalog={catalog} />}
          onMaterializeSource={onMaterializeSource}
          onOpenConversation={onOpenConversation}
          onViewCharacter={onViewCharacter}
          onGroupByChange={setGroupBy}
          onQueryChange={catalog.onQueryChange}
          onSelect={onSelect}
          query={catalog.query}
          axes={axes}
          title={t('WorldDetail.paper.gallery.title')}
          subtitle={ready
            ? t('WorldDetail.paper.gallery.subtitle', { total: formatNum(catalog.totalCount), connectable: formatNum(connectable) })
            : ''}
        />
        <PeopleCatalogMoreControl catalog={catalog} loadedCount={characters.length} />
      </div>
    </div>
  );
}
