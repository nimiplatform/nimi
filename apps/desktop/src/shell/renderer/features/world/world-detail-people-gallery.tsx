import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollArea } from '@nimiplatform/kit/ui';
import type { WorldCharacter } from './world-detail-types.js';
import { characterMeta, formatNum } from './world-detail-template-model';
import { PAPER, PAPER_RADIUS, PAPER_SERIF } from './world-detail-paper-model';
import {
  IconChat,
  IconChevron,
  IconUsers,
  PaperAvatar,
  PaperTag,
  paperGhostButton,
  paperPrimaryButton,
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

function relationLabel(character: WorldCharacter, t: ReturnType<typeof useTranslation>['t']): string {
  if (character.relation?.state === 'connected') return t('WorldDetail.paper.characters.connected');
  if (character.relation?.state === 'unavailable') return t('WorldDetail.paper.characters.unavailable');
  return t('WorldDetail.paper.characters.connect');
}

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
  PRIMARY: { bg: PAPER.greenSoftBg, color: PAPER.green },
  SECONDARY: { bg: 'rgba(150,120,60,.14)', color: '#8a6a2f' },
  BACKGROUND: { bg: 'rgba(120,108,80,.12)', color: PAPER.muted },
};

const PEOPLE_GALLERY_SHELL_TITLEBAR_HEIGHT_PX = 56;
const PEOPLE_GALLERY_TITLEBAR_GAP_PX = 16;
const PEOPLE_GALLERY_TOP_OFFSET_PX = PEOPLE_GALLERY_SHELL_TITLEBAR_HEIGHT_PX + PEOPLE_GALLERY_TITLEBAR_GAP_PX;
const PEOPLE_GALLERY_BOTTOM_GUTTER_PX = 24;
const PEOPLE_GALLERY_SIDE_GUTTER_PX = 20;

function PeopleCard({
  character,
  onSelect,
  onViewCharacter,
  onMaterializeSource,
}: {
  character: WorldCharacter;
  onSelect: (characterId: string) => void;
  onViewCharacter?: (character: WorldCharacter) => void;
  onMaterializeSource?: (character: WorldCharacter) => Promise<void> | void;
}) {
  const { t } = useTranslation();
  const connectable = character.relation?.state === 'connectable';
  const isPersona = character.ownership === 'userOwned' || character.sourceKind === 'realmPersona';
  const tier = tierBadgeTone[character.importance];
  const cardStyle: CSSProperties = {
    background: PAPER.cardSoft,
    border: `1px solid ${PAPER.borderSoft}`,
    borderRadius: PAPER_RADIUS.md,
    padding: 15,
    display: 'flex',
    flexDirection: 'column',
  };
  const vitality = character.stats?.vitalityScore;
  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', gap: 11, alignItems: 'flex-start' }}>
        <button
          type="button"
          aria-label={t('WorldDetail.paper.characters.openProfile', {
            name: character.name,
            defaultValue: `Open ${character.name} profile`,
          })}
          onClick={() => (onViewCharacter ? onViewCharacter(character) : onSelect(character.id))}
          style={{ border: 0, background: 'transparent', padding: 0, cursor: 'pointer' }}
        >
          <PaperAvatar name={character.name} imageUrl={character.avatarUrl} size={48} />
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
              style={{ border: 0, background: 'transparent', padding: 0, cursor: 'pointer', fontFamily: PAPER_SERIF, fontSize: 16, fontWeight: 700, color: PAPER.inkStrong, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {character.name}
            </button>
            <PaperTag>{isPersona ? t('WorldDetail.glass.characters.persona') : t('WorldDetail.glass.characters.character')}</PaperTag>
          </div>
          <div style={{ fontSize: 12, color: PAPER.bodySoft, lineHeight: 1.5, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {characterMeta(character)}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', margin: '12px 0 13px' }}>
        <span style={{ fontSize: 10.5, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: tier.bg, color: tier.color }}>
          {t(`WorldDetail.paper.gallery.tier.${character.importance}.label`)}
        </span>
        {typeof vitality === 'number' && vitality > 0 ? (
          <span style={{ fontSize: 11.5, color: PAPER.faint }}>
            {t('WorldDetail.paper.characters.vitality')}{' '}
            <span style={{ fontFamily: PAPER_SERIF, fontWeight: 700, color: PAPER.ink }}>{formatNum(Math.round(vitality))}</span>
          </span>
        ) : null}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
        <button
          type="button"
          disabled={!connectable}
          onClick={() => onMaterializeSource?.(character)}
          style={{
            ...paperPrimaryButton,
            flex: 1,
            background: connectable ? PAPER.green : 'rgba(120,108,80,.18)',
            color: connectable ? '#f6f2e7' : PAPER.muted,
            cursor: connectable ? 'pointer' : 'default',
          }}
        >
          {relationLabel(character, t)}
        </button>
        <button type="button" onClick={() => onSelect(character.id)} style={{ ...paperGhostButton, flex: 1 }}>
          <IconChat size={14} color={PAPER.ink} strokeWidth={1.7} />
          {t('WorldDetail.paper.characters.chat')}
        </button>
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
    <div style={{ display: 'inline-flex', gap: 4, padding: 4, borderRadius: 999, background: 'rgba(120,108,80,.1)', border: `1px solid ${PAPER.borderSoft}` }}>
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
              background: isActive ? PAPER.green : 'transparent',
              color: isActive ? '#f6f2e7' : PAPER.bodySoft,
              boxShadow: isActive ? '0 3px 9px rgba(29,95,67,.24)' : 'none',
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
}: {
  characters: readonly WorldCharacter[];
  onClose: () => void;
  onSelect: (characterId: string) => void;
  onViewCharacter?: (character: WorldCharacter) => void;
  onMaterializeSource?: (character: WorldCharacter) => Promise<void> | void;
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
  onGroupByChange,
  onQueryChange,
  onSelect,
  onViewCharacter,
  query,
  subtitle,
  title,
}: {
  actionLabel: string;
  axes: readonly PeopleGroupBy[];
  effectiveGroupBy: PeopleGroupBy;
  groups: readonly PeopleGroup[];
  modal?: boolean;
  onAction: () => void;
  onMaterializeSource?: (character: WorldCharacter) => Promise<void> | void;
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
        maxHeight: modal ? `calc(100vh - ${PEOPLE_GALLERY_TOP_OFFSET_PX}px - ${PEOPLE_GALLERY_BOTTOM_GUTTER_PX}px)` : undefined,
        minHeight: modal ? undefined : 'calc(100vh - 154px)',
        display: 'flex',
        flexDirection: 'column',
        background: PAPER.card,
        border: `1px solid ${PAPER.border}`,
        borderRadius: PAPER_RADIUS.xl,
        boxShadow: modal ? '0 28px 80px rgba(38,32,23,.34)' : PAPER.cardShadowStrong,
        overflow: 'hidden',
      }}
    >
      <div style={{ padding: '22px 26px 16px', borderBottom: `1px solid ${PAPER.divider}` }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <span style={{ width: 4, height: 20, borderRadius: 2, background: PAPER.green, flexShrink: 0 }} />
              <h2 style={{ margin: 0, fontFamily: PAPER_SERIF, fontSize: 22, fontWeight: 700, color: PAPER.inkStrong }}>
                {title}
              </h2>
            </div>
            <p style={{ margin: '8px 0 0', fontSize: 13, color: PAPER.bodySoft, lineHeight: 1.6 }}>
              {subtitle}
            </p>
          </div>
          <button
            type="button"
            onClick={onAction}
            style={{ flexShrink: 0, fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, padding: '7px 14px', borderRadius: 999, border: `1px solid ${PAPER.borderSoft}`, background: PAPER.cardSoft, color: PAPER.bodySoft, cursor: 'pointer' }}
          >
            {actionLabel}
          </button>
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
                color: PAPER.ink,
                padding: '9px 14px',
                borderRadius: 999,
                border: `1px solid ${PAPER.borderSoft}`,
                background: PAPER.cardSoft,
                outline: 'none',
              }}
            />
          </div>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1" viewportClassName="px-6 py-5">
        {groups.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '60px 20px', color: PAPER.bodySoft }}>
            <IconUsers size={30} color={PAPER.faint} strokeWidth={1.5} />
            <span style={{ fontSize: 13.5 }}>{t('WorldDetail.paper.gallery.empty')}</span>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
            {groups.map((group) => (
              <div key={`${group.kind}-${group.id}`}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
                  <h3 style={{ margin: 0, fontFamily: PAPER_SERIF, fontSize: 17, fontWeight: 700, color: PAPER.inkStrong }}>
                    {groupTitle(group, t)}
                  </h3>
                  <span style={{ fontSize: 12, fontWeight: 600, color: PAPER.green, padding: '1px 9px', borderRadius: 999, background: PAPER.greenSoftBg }}>
                    {t('WorldDetail.paper.gallery.count', { count: group.characters.length })}
                  </span>
                  <span style={{ fontSize: 12, color: PAPER.faint }}>{groupCaption(group, t)}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(248px,1fr))', gap: 13 }}>
                  {group.characters.map((character) => (
                    <PeopleCard
                      key={character.id}
                      character={character}
                      onSelect={onSelect}
                      onViewCharacter={onViewCharacter}
                      onMaterializeSource={onMaterializeSource}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>

      <div style={{ padding: '12px 26px', borderTop: `1px solid ${PAPER.divider}`, display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: PAPER.faint }}>
        <IconChevron size={13} color={PAPER.faint} />
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
        style={{ position: 'absolute', inset: 0, border: 0, background: 'rgba(38,32,23,.5)', backdropFilter: 'blur(2px)', cursor: 'default' }}
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
}: {
  characters: readonly WorldCharacter[];
  onBack: () => void;
  onSelect: (characterId: string) => void;
  onViewCharacter?: (character: WorldCharacter) => void;
  onMaterializeSource?: (character: WorldCharacter) => Promise<void> | void;
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
      <div aria-hidden="true" style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none', background: PAPER.pageGradient }} />
      <div style={{ position: 'relative', zIndex: 1, maxWidth: 1180, margin: '0 auto', padding: '22px 28px 80px' }}>
        <button
          type="button"
          onClick={onBack}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 7, marginBottom: 14, fontFamily: 'inherit', fontSize: 13, fontWeight: 600, color: PAPER.green, border: `1px solid ${PAPER.borderSoft}`, borderRadius: 999, background: PAPER.card, padding: '8px 13px', cursor: 'pointer', boxShadow: PAPER.cardShadow }}
        >
          <span style={{ transform: 'rotate(180deg)', display: 'inline-flex' }}>
            <IconChevron size={13} color={PAPER.green} />
          </span>
          {t('WorldDetail.paper.gallery.backToWorld')}
        </button>
        <PeopleArchiveShell
          effectiveGroupBy={effectiveGroupBy}
          groups={groups}
          onAction={onBack}
          onMaterializeSource={onMaterializeSource}
          onViewCharacter={onViewCharacter}
          onGroupByChange={setGroupBy}
          onQueryChange={setQuery}
          onSelect={onSelect}
          query={query}
          axes={axes}
          title={t('WorldDetail.paper.materials.cat.people.title')}
          subtitle={t('WorldDetail.paper.gallery.subtitle', { total: formatNum(characters.length), connectable: formatNum(connectable) })}
          actionLabel={t('WorldDetail.paper.gallery.backToWorld')}
        />
      </div>
    </div>
  );
}
