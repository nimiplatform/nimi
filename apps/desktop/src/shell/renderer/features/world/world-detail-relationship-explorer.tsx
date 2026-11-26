import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';
import { EmptyState, SearchField } from '@nimiplatform/kit/ui';
import {
  buildWorldRelationshipExplorerModel,
  sameIdentityCharacters,
} from './world-detail-relationship-model.js';
import type { WorldCharacter, WorldDetailData, WorldPeopleCatalogState } from './world-detail-types.js';
import { PeopleCatalogFirstPageStatus, PeopleCatalogMoreControl } from './world-detail-people-catalog-status.js';
import { formatNum } from './world-detail-paper-model.js';
import { WORLD_DETAIL_PAPER_CONTENT_PADDING } from './world-detail-layout.js';
import {
  IconArrow,
  PaperAvatar,
  PaperTag,
} from './world-detail-paper-primitives.js';
import { characterMeta } from './world-detail-template-model.js';
import {
  identityTags,
  panelStyle,
  softPanelStyle,
} from './world-detail-relationship-explorer-model.js';

type WorldRelationshipExplorerProps = {
  readonly world: WorldDetailData;
  // The World's people as loaded from the Realm catalog; `catalog` searches and pages them.
  readonly characters: readonly WorldCharacter[];
  readonly catalog: WorldPeopleCatalogState;
  readonly onBack: () => void;
  readonly onSelectCharacter?: (characterId: string) => void;
  readonly onViewCharacter?: (character: WorldCharacter) => void;
};

function CharacterMiniList({
  title,
  characters,
  onSelect,
}: {
  readonly title: string;
  readonly characters: readonly WorldCharacter[];
  readonly onSelect: (characterId: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ marginBottom: 8, fontSize: 12, fontWeight: 600, color: 'var(--nimi-text-primary)' }}>{title}</div>
      {characters.length > 0 ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 7 }}>
          {characters.map((character) => (
            <button
              key={character.id}
              type="button"
              onClick={() => onSelect(character.id)}
              style={{ ...softPanelStyle(), fontFamily: 'inherit' }}
              className="flex cursor-pointer items-center gap-2 px-2.5 py-[9px] text-left transition-[border-color,background-color,transform] duration-150 hover:border-[var(--nimi-action-primary-bg)] hover:bg-[var(--nimi-surface-active)] active:scale-[0.98] motion-reduce:transform-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nimi-focus-ring-color)] focus-visible:ring-offset-1"
            >
              <PaperAvatar name={character.name} imageUrl={character.avatarUrl} media={character.avatarMedia} size={30} />
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--nimi-text-primary)' }}>{character.name}</span>
                <span style={{ display: 'block', marginTop: 2, fontSize: 11, color: 'var(--nimi-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{characterMeta(character)}</span>
              </span>
            </button>
          ))}
        </div>
      ) : <div style={{ fontSize: 12, color: 'var(--nimi-text-muted)' }}>{t('WorldDetail.paper.relationshipExplorer.profile.noRelated')}</div>}
    </div>
  );
}

// Profile of the selected character built only from its explicit fields. No
// relationship, era, work, or contemporary is inferred.
function CharacterProfile({
  center,
  characters,
  onSelect,
  onOpenProfile,
}: {
  readonly center: WorldCharacter;
  readonly characters: readonly WorldCharacter[];
  readonly onSelect: (characterId: string) => void;
  readonly onOpenProfile: (characterId: string) => void;
}) {
  const { t } = useTranslation();
  const tags = identityTags(center, t);
  const topicCount = center.topics?.length ?? 0;
  const materials = [
    center.bio ? t('WorldDetail.paper.relationshipExplorer.profile.bioMaterial') : null,
    topicCount > 0 ? t('WorldDetail.paper.relationshipExplorer.profile.topicMaterial', { count: topicCount }) : null,
    center.location ? t('WorldDetail.paper.relationshipExplorer.profile.placeMaterial', { place: center.location }) : null,
  ].filter((item): item is string => Boolean(item));
  const directions = [
    center.faction ? t('WorldDetail.paper.relationshipExplorer.profile.directionFaction', { value: center.faction }) : null,
    center.role ? t('WorldDetail.paper.relationshipExplorer.profile.directionRole', { value: center.role }) : null,
    center.location ? t('WorldDetail.paper.relationshipExplorer.profile.directionPlace', { value: center.location }) : null,
  ].filter((item): item is string => Boolean(item));

  return (
    <div data-testid="world-relationship-profile" style={{ ...panelStyle(), padding: 22, minHeight: 452 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 18 }}>
        <PaperAvatar name={center.name} imageUrl={center.avatarUrl} media={center.avatarMedia} size={64} />
        <div style={{ minWidth: 0 }}>
          <PaperTag>{t('WorldDetail.paper.relationshipExplorer.profile.status')}</PaperTag>
          <h3 style={{ margin: '10px 0 6px', fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--nimi-text-primary)' }}>{center.name}</h3>
          {center.bio ? (
            <p style={{ margin: 0, maxWidth: 680, fontSize: 13.5, lineHeight: 1.75, color: 'var(--nimi-text-muted)' }}>{center.bio}</p>
          ) : null}
        </div>
      </div>
      <div className={directions.length > 0 ? 'grid grid-cols-1 gap-3.5 md:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]' : 'grid grid-cols-1 gap-3.5'}>
        <div style={{ ...softPanelStyle(), padding: 15 }}>
          {tags.length > 0 ? (
            <>
              <div style={{ marginBottom: 10, fontSize: 12, fontWeight: 600, color: 'var(--nimi-text-primary)' }}>{t('WorldDetail.paper.relationshipExplorer.profile.identity')}</div>
              <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 14 }}>
                {tags.map((tag) => <PaperTag key={tag} tone="neutral">{tag}</PaperTag>)}
              </div>
            </>
          ) : null}
          <div style={{ marginBottom: 8, fontSize: 12, fontWeight: 600, color: 'var(--nimi-text-primary)' }}>{t('WorldDetail.paper.relationshipExplorer.profile.materials')}</div>
          <ul style={{ margin: 0, paddingLeft: 16, color: 'var(--nimi-text-muted)', fontSize: 12.5, lineHeight: 1.7 }}>
            {(materials.length > 0 ? materials : [t('WorldDetail.paper.relationshipExplorer.profile.basicMaterial')]).map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
        {directions.length > 0 ? (
          <div style={{ ...softPanelStyle(), padding: 15 }}>
            <div style={{ marginBottom: 8, fontSize: 12, fontWeight: 600, color: 'var(--nimi-text-primary)' }}>{t('WorldDetail.paper.relationshipExplorer.profile.directions')}</div>
            <ul style={{ margin: 0, paddingLeft: 16, color: 'var(--nimi-text-muted)', fontSize: 12.5, lineHeight: 1.7 }}>
              {directions.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
        ) : null}
      </div>
      <div style={{ marginTop: 14 }}>
        <CharacterMiniList title={t('WorldDetail.paper.relationshipExplorer.profile.sameIdentity')} characters={sameIdentityCharacters(center, characters)} onSelect={onSelect} />
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
        <button
          type="button"
          onClick={() => onOpenProfile(center.id)}
          className="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-[var(--nimi-radius-action)] bg-[var(--nimi-action-primary-bg)] px-[15px] py-2 text-[length:var(--nimi-type-body-sm-size)] font-medium text-[var(--nimi-action-primary-text)] transition-[background-color,transform] duration-150 hover:bg-[var(--nimi-action-primary-bg-hover)] active:scale-[0.97] motion-reduce:transform-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nimi-focus-ring-color)] focus-visible:ring-offset-1"
        >
          {t('WorldDetail.paper.relationshipExplorer.profile.viewProfile')} <IconArrow size={13} />
        </button>
      </div>
    </div>
  );
}

function PeoplePanel({
  people,
  catalog,
  selectedId,
  onSelect,
}: {
  readonly people: readonly WorldCharacter[];
  readonly catalog: WorldPeopleCatalogState;
  readonly selectedId: string | null;
  readonly onSelect: (characterId: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <aside
      data-testid="world-relationship-people-panel"
      style={{
        ...panelStyle(),
        display: 'flex',
        flexDirection: 'column',
        maxHeight: 'calc(100vh - 120px)',
        boxSizing: 'border-box',
        position: 'sticky',
        top: 12,
        overflow: 'hidden',
      }}
    >
      <div style={{ padding: '14px 14px 12px', borderBottom: '1px solid var(--nimi-border-subtle)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--nimi-text-primary)' }}>{t('WorldDetail.paper.relationshipExplorer.peopleList.title')}</h2>
          {catalog.status === 'ready' ? (
            <span style={{ fontSize: 12, color: 'var(--nimi-text-muted)', fontWeight: 600 }}>{people.length} / {catalog.totalCount}</span>
          ) : null}
        </div>
        <SearchField
          className="w-full"
          value={catalog.query}
          onChange={(event) => catalog.onQueryChange(event.target.value)}
          onClear={() => catalog.onQueryChange('')}
          clearLabel={t('Common.clear')}
          placeholder={t('WorldDetail.paper.relationshipExplorer.peopleList.searchPlaceholder')}
          aria-label={t('WorldDetail.paper.relationshipExplorer.peopleList.searchPlaceholder')}
        />
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 10, scrollbarGutter: 'stable' }}>
        {catalog.status === 'partial' ? <PeopleCatalogFirstPageStatus catalog={catalog} /> : null}
        {catalog.status !== 'ready' && catalog.status !== 'partial' ? (
          <PeopleCatalogFirstPageStatus catalog={catalog} />
        ) : people.length > 0 ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr)', gap: 4 }}>
            {people.map((character) => {
              const selected = character.id === selectedId;
              return (
                <button
                  key={character.id}
                  type="button"
                  onClick={() => onSelect(character.id)}
                  className={`box-border flex w-full cursor-pointer items-center gap-2.5 rounded-xl border px-2.5 py-[9px] text-left transition-[background-color,border-color,transform] duration-150 active:scale-[0.985] motion-reduce:transform-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nimi-focus-ring-color)] focus-visible:ring-offset-1 ${
                    selected
                      ? 'border-[var(--nimi-action-primary-bg)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_14%,transparent)]'
                      : 'border-transparent bg-transparent hover:bg-[var(--nimi-surface-panel)]'
                  }`}
                >
                  <PaperAvatar name={character.name} imageUrl={character.avatarUrl} media={character.avatarMedia} size={38} />
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span data-testid="world-relationship-person-title-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, minWidth: 0 }}>
                      <span style={{ minWidth: 0, fontSize: 13, fontWeight: 600, color: 'var(--nimi-text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{character.name}</span>
                    </span>
                    <span style={{ display: 'block', marginTop: 2, fontSize: 11, color: 'var(--nimi-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{characterMeta(character)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        ) : catalog.status === 'partial' ? null : <EmptyState title={t('WorldDetail.paper.relationshipExplorer.peopleList.empty')} style={{ margin: '20px 12px' }} />}
        <PeopleCatalogMoreControl catalog={catalog} loadedCount={people.length} />
      </div>
    </aside>
  );
}

function TopStat({ value, label }: { readonly value: string; readonly label: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--nimi-text-primary)', lineHeight: 1 }}>{value}</div>
      <div style={{ marginTop: 4, fontSize: 10.5, color: 'var(--nimi-text-muted)', whiteSpace: 'nowrap' }}>{label}</div>
    </div>
  );
}

export function WorldRelationshipExplorer({
  world,
  characters,
  catalog,
  onBack,
  onSelectCharacter,
  onViewCharacter,
}: WorldRelationshipExplorerProps) {
  const { t } = useTranslation();
  const [selectedCenterId, setSelectedCenterId] = useState<string | null>(null);
  const model = useMemo(() => buildWorldRelationshipExplorerModel({
    world,
    characters,
    preferredCenterId: selectedCenterId,
  }), [characters, selectedCenterId, world]);

  const openCharacterProfile = (characterId: string) => {
    const character = characters.find((item) => item.id === characterId) ?? null;
    if (character && onViewCharacter) {
      onViewCharacter(character);
      return;
    }
    onSelectCharacter?.(characterId);
  };

  return (
    <div
      data-testid="world-relationship-explorer"
      style={{
        minHeight: '100%',
        color: 'var(--nimi-text-primary)',
        background: 'transparent',
        padding: WORLD_DETAIL_PAPER_CONTENT_PADDING,
        boxSizing: 'border-box',
        display: 'grid',
        gridTemplateRows: 'auto minmax(0,1fr)',
      }}
    >
      <header data-testid="world-relationship-topbar" style={{ display: 'grid', gridTemplateColumns: 'minmax(170px,auto) minmax(0,1fr) auto', alignItems: 'center', gap: 18, padding: '9px 18px', minHeight: 58, background: 'transparent' }}>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex cursor-pointer items-center justify-start gap-1.5 rounded-[var(--nimi-radius-action)] px-1.5 py-1 text-[length:var(--nimi-type-body-sm-size)] font-medium text-[var(--nimi-text-muted)] transition-[color,background-color,transform] duration-150 hover:bg-[var(--nimi-surface-panel)] hover:text-[var(--nimi-text-primary)] active:scale-[0.97] motion-reduce:transform-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nimi-focus-ring-color)] focus-visible:ring-offset-1"
        >
          <ArrowLeft size={14} aria-hidden="true" className="shrink-0 text-[var(--nimi-action-primary-bg)]" /> {t('WorldDetail.paper.relationshipExplorer.back')}
        </button>
        <div style={{ minWidth: 0, textAlign: 'center' }}>
          <div style={{ fontSize: 15.5, fontWeight: 700, color: 'var(--nimi-text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{world.name}</div>
          <div style={{ marginTop: 3, fontSize: 11.5, color: 'var(--nimi-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t('WorldDetail.paper.relationshipExplorer.topbar.current', { name: model.center?.name ?? '--' })}</div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 22, flexWrap: 'wrap' }}>
          {catalog.status === 'ready' ? (
            <TopStat value={formatNum(catalog.totalCount)} label={t('WorldDetail.paper.relationshipExplorer.metrics.people')} />
          ) : null}
          {model.summary.relationshipCount !== null ? (
            <TopStat value={formatNum(model.summary.relationshipCount)} label={t('WorldDetail.paper.relationshipExplorer.metrics.relationships')} />
          ) : null}
        </div>
      </header>

      <div className="grid grid-cols-1 items-start gap-3 pt-3 lg:grid-cols-[minmax(220px,280px)_minmax(0,1fr)]">
        <PeoplePanel
          people={model.people}
          catalog={catalog}
          selectedId={model.center?.id ?? null}
          onSelect={setSelectedCenterId}
        />

        <main style={{ minWidth: 0 }}>
          {catalog.status !== 'ready' && catalog.status !== 'partial' ? null : model.center ? (
            <CharacterProfile
              center={model.center}
              characters={characters}
              onSelect={setSelectedCenterId}
              onOpenProfile={openCharacterProfile}
            />
          ) : catalog.status === 'partial' ? null : (
            <div style={{ ...panelStyle(), padding: 24 }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--nimi-text-primary)' }}>{t('WorldDetail.paper.relationshipExplorer.noCharactersTitle')}</h2>
              <p style={{ margin: '8px 0 0', fontSize: 12.5, lineHeight: 1.65, color: 'var(--nimi-text-muted)' }}>{t('WorldDetail.paper.relationshipExplorer.noCharactersDesc')}</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
