import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState, ScrollArea } from '@nimiplatform/kit/ui';
import type { WorldCharacter } from './world-detail-types.js';
import { characterMeta, formatNum } from './world-detail-template-model';
import { worldDetailPaperContentFrameStyle } from './world-detail-layout.js';
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
  filterPeople,
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

const tierBadgeTone: Record<WorldCharacter['importance'], { bg: string; color: string }> = {
  PRIMARY: { bg: 'color-mix(in srgb, var(--nimi-action-primary-bg) 14%, transparent)', color: 'var(--nimi-action-primary-bg)' },
  SECONDARY: { bg: 'var(--nimi-status-warning-soft-bg)', color: 'var(--nimi-status-warning-soft-text)' },
  BACKGROUND: { bg: 'var(--nimi-status-neutral-soft-bg)', color: 'var(--nimi-text-muted)' },
};

const PEOPLE_GALLERY_SHELL_TITLEBAR_HEIGHT_PX = 56;
const PEOPLE_GALLERY_TITLEBAR_GAP_PX = 16;
const PEOPLE_GALLERY_TOP_OFFSET_PX = PEOPLE_GALLERY_SHELL_TITLEBAR_HEIGHT_PX + PEOPLE_GALLERY_TITLEBAR_GAP_PX;
const PEOPLE_GALLERY_BOTTOM_GUTTER_PX = 24;
const PEOPLE_GALLERY_SIDE_GUTTER_PX = 20;
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
    return (
      <button
        type="button"
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
  const tier = tierBadgeTone[character.importance];
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

      <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10.5, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: tier.bg, color: tier.color }}>
          {t(`WorldDetail.paper.gallery.tier.${character.importance}.label`)}
        </span>
        {typeof vitality === 'number' && vitality > 0 ? (
          <span style={{ fontSize: 11.5, color: 'var(--nimi-text-muted)' }}>
            {t('WorldDetail.paper.characters.vitality')}{' '}
            <span style={{ fontWeight: 700, color: 'var(--nimi-text-primary)' }}>{formatNum(Math.round(vitality))}</span>
          </span>
        ) : null}
      </div>
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

export function WorldPeopleGallery({
  characters,
  onClose,
  onSelect,
  onViewCharacter,
  onMaterializeSource,
  onOpenConversation,
}: {
  characters: readonly WorldCharacter[];
  onClose: () => void;
  onSelect: (characterId: string) => void;
  onViewCharacter?: (character: WorldCharacter) => void;
  onMaterializeSource?: (character: WorldCharacter) => Promise<void> | void;
  onOpenConversation?: (character: WorldCharacter) => Promise<void> | void;
}) {
  const { t } = useTranslation();
  const axes = useMemo(() => availableGroupBys(characters), [characters]);
  const [groupBy, setGroupBy] = useState<PeopleGroupBy>(() => defaultPeopleGroupBy(characters));
  const [query, setQuery] = useState('');

  const effectiveGroupBy = axes.includes(groupBy) ? groupBy : axes[0] ?? 'tier';

  const filtered = useMemo(() => filterPeople(characters, query), [characters, query]);
  const groups = useMemo(() => buildPeopleGroups(filtered, effectiveGroupBy), [filtered, effectiveGroupBy]);
  const connectable = useMemo(() => connectableCount(characters), [characters]);

  return (
    <PeopleArchiveShell
      effectiveGroupBy={effectiveGroupBy}
      groups={groups}
      onAction={onClose}
      onMaterializeSource={onMaterializeSource}
      onOpenConversation={onOpenConversation}
      onViewCharacter={onViewCharacter}
      onGroupByChange={setGroupBy}
      onQueryChange={setQuery}
      onSelect={onSelect}
      query={query}
      axes={axes}
      title={t('WorldDetail.paper.gallery.title')}
      subtitle={t('WorldDetail.paper.gallery.subtitle', { total: formatNum(characters.length), connectable: formatNum(connectable) })}
      actionLabel={t('WorldDetail.paper.gallery.close')}
      modal
    />
  );
}

function PeopleArchiveShell({
  actionLabel,
  axes,
  effectiveGroupBy,
  groups,
  modal,
  onAction,
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
  actionLabel?: string;
  axes: readonly PeopleGroupBy[];
  effectiveGroupBy: PeopleGroupBy;
  groups: readonly PeopleGroup[];
  modal?: boolean;
  onAction: () => void;
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
  const panel = (
    <section
      style={{
        position: 'relative',
        zIndex: 1,
        width: '100%',
        maxWidth: 1080,
        maxHeight: modal ? `calc(100cqh - ${PEOPLE_GALLERY_TOP_OFFSET_PX}px - ${PEOPLE_GALLERY_BOTTOM_GUTTER_PX}px)` : undefined,
        minHeight: modal ? undefined : PEOPLE_ARCHIVE_PANEL_MIN_HEIGHT_PX,
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
          {actionLabel ? (
            <button
              type="button"
              onClick={onAction}
              style={{ flexShrink: 0, fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, padding: '7px 14px', borderRadius: 999, border: '1px solid var(--nimi-border-subtle)', background: 'var(--nimi-surface-panel)', color: 'var(--nimi-text-secondary)', cursor: 'pointer' }}
            >
              {actionLabel}
            </button>
          ) : null}
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
        {groups.length === 0 ? (
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
        )}
      </ScrollArea>

      <div style={{ padding: '12px 26px', borderTop: '1px solid var(--nimi-border-subtle)', display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'var(--nimi-text-muted)' }}>
        <IconChevron size={13} color="var(--nimi-text-muted)" />
        {t('WorldDetail.paper.gallery.footerHint')}
      </div>
    </section>
  );

  if (!modal) {
    return panel;
  }
  return (
    <div
      data-testid="world-detail-people-gallery"
      style={{
        position: 'fixed',
        inset: 0,
        // Keep the backdrop full-screen; only the modal layout area clears the
        // 56px shell titlebar so no top band disappears.
        paddingTop: PEOPLE_GALLERY_TOP_OFFSET_PX,
        paddingBottom: PEOPLE_GALLERY_BOTTOM_GUTTER_PX,
        paddingLeft: PEOPLE_GALLERY_SIDE_GUTTER_PX,
        paddingRight: PEOPLE_GALLERY_SIDE_GUTTER_PX,
        zIndex: 35,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <button
        type="button"
        aria-label={t('WorldDetail.paper.gallery.close')}
        onClick={onAction}
        className="nimi-material-glass-regular backdrop-blur-[var(--nimi-backdrop-blur-regular)]"
        style={{ position: 'absolute', inset: 0, border: 0, background: 'var(--nimi-overlay-backdrop)', cursor: 'default' }}
      />
      {panel}
    </div>
  );
}

export function WorldPeopleArchivePage({
  characters,
  onBack,
  onSelect,
  onViewCharacter,
  onMaterializeSource,
  onOpenConversation,
}: {
  characters: readonly WorldCharacter[];
  onBack: () => void;
  onSelect: (characterId: string) => void;
  onViewCharacter?: (character: WorldCharacter) => void;
  onMaterializeSource?: (character: WorldCharacter) => Promise<void> | void;
  onOpenConversation?: (character: WorldCharacter) => Promise<void> | void;
}) {
  const { t } = useTranslation();
  const axes = useMemo(() => availableGroupBys(characters), [characters]);
  const [groupBy, setGroupBy] = useState<PeopleGroupBy>(() => defaultPeopleGroupBy(characters));
  const [query, setQuery] = useState('');
  const effectiveGroupBy = axes.includes(groupBy) ? groupBy : axes[0] ?? 'tier';
  const filtered = useMemo(() => filterPeople(characters, query), [characters, query]);
  const groups = useMemo(() => buildPeopleGroups(filtered, effectiveGroupBy), [filtered, effectiveGroupBy]);
  const connectable = useMemo(() => connectableCount(characters), [characters]);

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
          onAction={onBack}
          onMaterializeSource={onMaterializeSource}
          onOpenConversation={onOpenConversation}
          onViewCharacter={onViewCharacter}
          onGroupByChange={setGroupBy}
          onQueryChange={setQuery}
          onSelect={onSelect}
          query={query}
          axes={axes}
          title={t('WorldDetail.paper.gallery.title')}
          subtitle={t('WorldDetail.paper.gallery.subtitle', { total: formatNum(characters.length), connectable: formatNum(connectable) })}
        />
      </div>
    </div>
  );
}
