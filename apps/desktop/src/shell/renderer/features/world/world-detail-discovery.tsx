import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, BookOpen, Bookmark, Check, ChevronRight, MapPin, X } from 'lucide-react';
import { Button, EmptyState, IconButton, LoadingSkeleton, NimiText, SearchField, Surface } from '@nimiplatform/kit/ui';
import type { WorldDetailPageProps } from './world-detail-template.js';
import type { WorldCharacter, WorldPeopleCatalogState, WorldSceneItem } from './world-detail-types.js';
import { WorldCharacterCard } from './world-character-card.js';
import { PeopleCatalogFirstPageStatus, PeopleCatalogMoreControl } from './world-detail-people-catalog-status.js';
import { worldSummary } from './world-detail-template-model.js';
import { worldReadingEntries } from './world-detail-reading-model.js';
import { WorldDetailReader } from './world-detail-reader.js';
import { worldTimeDisplay } from './world-detail-paper-model.js';
import { formatLocaleDateTime } from '../../i18n/index.js';

export function WorldCharactersSection({ characters, catalog, loading, onView }: {
  characters: readonly WorldCharacter[];
  catalog: WorldPeopleCatalogState;
  loading?: boolean;
  onView: (character: WorldCharacter) => void;
}) {
  const { t } = useTranslation();
  return (
    <section id="world-detail-characters" data-testid="world-detail-characters" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <NimiText role="section-title">{t('WorldDetail.discovery.people')}</NimiText>
          {catalog.status === 'ready' ? <NimiText role="caption">{t('WorldDetail.discovery.peopleCount', { count: catalog.totalCount })}</NimiText> : null}
        </div>
        <div className="flex max-w-full items-center gap-1">
          <SearchField value={catalog.query} onChange={(event) => catalog.onQueryChange(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') catalog.onQueryChange(''); }} placeholder={t('WorldDetail.discovery.searchPeople')} aria-label={t('WorldDetail.discovery.searchPeople')} className="w-full sm:w-64" />
          {catalog.query ? <IconButton tone="ghost" size="sm" icon={<X size={15} />} aria-label={t('World.clearSearch')} onClick={() => catalog.onQueryChange('')} /> : null}
        </div>
      </div>
      {loading ? <LoadingSkeleton lines={3} label={t('WorldDetail.charactersLoading')} /> : catalog.status !== 'ready' ? <PeopleCatalogFirstPageStatus catalog={catalog} /> : characters.length ? (
        <div className="grid grid-cols-1 gap-4 @min-[640px]:grid-cols-2 @min-[1120px]:grid-cols-4">
          {characters.map((character) => <WorldCharacterCard key={`${character.sourceRef.kind}:${character.id}`} character={character} onView={onView} />)}
        </div>
      ) : <EmptyState title={t(catalog.query ? 'WorldDetail.discovery.noPeopleMatch' : 'WorldDetail.discovery.noPeople')} />}
      <PeopleCatalogMoreControl catalog={catalog} loadedCount={characters.length} />
    </section>
  );
}

// @nimi-authority: rule.nimi.desktop.shell-ui.r011
// @nimi-authority: rule.nimi.desktop.shell-ui.r012
export function WorldDetailDiscovery({ props, scenes, onViewCharacter, onViewScene, onViewResources }: {
  props: WorldDetailPageProps;
  scenes: readonly WorldSceneItem[];
  onViewCharacter: (character: WorldCharacter) => void;
  onViewScene: (id: string) => void;
  onViewResources: () => void;
}) {
  const { t } = useTranslation();
  const [readerOpen, setReaderOpen] = useState(false);
  const [bannerFailed, setBannerFailed] = useState(false);
  const world = props.world;
  const summary = worldSummary(world);
  const settings = worldReadingEntries(world, props.semantic, props.history).filter((entry) => entry.section !== 'description');
  const previews = settings.slice(0, 3);
  const hasResources = props.publicAssets.resourceRefs.length + props.publicAssets.externalRefs.length + props.publicAssets.intents.length > 0;
  const timeLabel = worldTimeDisplay(world.time, formatLocaleDateTime);
  return (
    <main className="@container mx-auto w-full max-w-[1440px] space-y-5 p-4" data-nimi-density="regular" data-testid="world-detail-discovery">
      {props.onBack ? <Button tone="ghost" size="sm" leadingIcon={<ArrowLeft size={16} />} onClick={props.onBack}>{t('WorldDetail.glass.backToAtlas')}</Button> : null}
      <Surface as="section" tone="card" padding="none" className="overflow-hidden shadow-none" data-testid="world-detail-overview">
        {world.bannerUrl && !bannerFailed ? <img src={world.bannerUrl} alt="" className="h-32 w-full object-cover" onError={() => setBannerFailed(true)} data-testid="world-detail-banner" /> : null}
        <div className="space-y-2 p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 space-y-2" data-nimi-density="expressive">
              <NimiText role="hero-title" className="line-clamp-2 break-words text-2xl" title={world.name}>{world.name}</NimiText>
              {world.genre || timeLabel || world.era ? <NimiText role="helper" className="line-clamp-1" title={[world.genre, world.era, timeLabel].filter(Boolean).join(' · ')}>{[...new Set([world.genre, world.era, timeLabel].filter(Boolean))].join(' · ')}</NimiText> : null}
            </div>
            {props.onFollowWorld ? <Button tone="secondary" size="sm" leadingIcon={props.worldFollowed ? <Check size={15} /> : <Bookmark size={15} />} aria-pressed={Boolean(props.worldFollowed)} onClick={() => props.onFollowWorld?.(world)} data-testid="world-detail-follow-world">{t(props.worldFollowed ? 'WorldDetail.discovery.followed' : 'WorldDetail.discovery.follow')}</Button> : null}
          </div>
          {summary ? <NimiText role="body" className="line-clamp-2 whitespace-pre-wrap break-words" data-testid="world-detail-summary">{summary}</NimiText> : null}
          {summary || settings.length ? <Button tone="ghost" size="sm" leadingIcon={<BookOpen size={15} />} onClick={() => setReaderOpen(true)} data-testid="world-detail-open-reader">{t('WorldDetail.discovery.readWorld')}</Button> : null}
        </div>
      </Surface>
      <WorldCharactersSection characters={props.peopleCharacters} catalog={props.peopleCatalog} loading={props.charactersLoading} onView={onViewCharacter} />
      {props.readingIncomplete ? <EmptyState title={t('WorldDetail.discovery.readingIncomplete')} action={props.onRetryReading ? <Button tone="secondary" size="sm" onClick={props.onRetryReading}>{t('WorldDetail.paper.gallery.retry')}</Button> : undefined} /> : null}
      {props.semanticLoading ? <LoadingSkeleton lines={2} label={t('WorldDetail.loading')} /> : previews.length ? (
        <section className="space-y-3" data-testid="world-detail-settings-preview">
          <div className="flex items-center justify-between gap-3"><NimiText role="section-title">{t('WorldDetail.discovery.settings')}</NimiText><Button tone="ghost" size="sm" trailingIcon={<ChevronRight size={14} />} onClick={() => setReaderOpen(true)}>{t('WorldDetail.discovery.readAll')}</Button></div>
          <div className="grid gap-3 @min-[800px]:grid-cols-3">
            {previews.map((entry) => <Surface key={entry.id} tone="card" padding="md" className="shadow-none"><NimiText role="caption">{t(`WorldDetail.discovery.reading.${entry.section}`)}</NimiText><NimiText role="body" className="mt-2 line-clamp-2 break-words">{entry.text.join(' · ')}</NimiText></Surface>)}
          </div>
        </section>
      ) : null}
      {scenes.length ? (
        <section id="world-detail-scenes" className="space-y-3" data-testid="world-detail-scenes">
          <NimiText role="section-title">{t('WorldDetail.discovery.scenes')}</NimiText>
          <div className="grid gap-3 @min-[640px]:grid-cols-2 @min-[1120px]:grid-cols-3">
            {scenes.map((scene) => <Surface key={scene.id} as="article" tone="card" padding="md" className="flex min-w-0 items-start gap-3 shadow-none"><MapPin size={20} className="shrink-0 text-[var(--nimi-text-muted)]" /><div className="min-w-0 flex-1 space-y-2"><NimiText role="card-title" className="line-clamp-2 break-words" title={scene.name}>{scene.name}</NimiText>{scene.description ? <NimiText role="helper" className="line-clamp-2 break-words">{scene.description}</NimiText> : null}<Button tone="ghost" size="sm" onClick={() => onViewScene(scene.id)}>{t('WorldDetail.discovery.viewScene')}</Button></div></Surface>)}
          </div>
        </section>
      ) : null}
      {hasResources ? <Button tone="ghost" size="sm" onClick={onViewResources}>{t('WorldDetail.discovery.resources')}</Button> : null}
      {props.publicAssetsIncomplete ? <EmptyState title={t('WorldDetail.discovery.placesIncomplete')} action={props.onRetryReading ? <Button tone="secondary" size="sm" onClick={props.onRetryReading}>{t('WorldDetail.paper.gallery.retry')}</Button> : undefined} /> : null}
      {readerOpen ? <WorldDetailReader world={world} semantic={props.semantic} history={props.history} loading={props.semanticLoading || props.historyLoading} incomplete={props.readingIncomplete} onRetry={props.onRetryReading} onClose={() => setReaderOpen(false)} /> : null}
    </main>
  );
}
