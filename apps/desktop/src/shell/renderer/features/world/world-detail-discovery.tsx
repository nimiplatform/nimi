import { MediaImage, MediaAvatar } from '@nimiplatform/kit/features/media';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ArrowUpRight, BookOpen, Bookmark, Compass, MapPin, ScrollText, X } from 'lucide-react';
import { Button, EmptyState, IconButton, LoadingSkeleton, NimiText, SearchField } from '@nimiplatform/kit/ui';
import type { WorldDetailPageProps } from './world-detail-template.js';
import type { WorldCharacter, WorldPeopleCatalogState, WorldSceneItem } from './world-detail-types.js';
import { PeopleCatalogFirstPageStatus, PeopleCatalogMoreControl } from './world-detail-people-catalog-status.js';
import { worldSummary, worldSummaryLead } from './world-detail-template-model.js';
import { worldReadingEntries } from './world-detail-reading-model.js';
import { WorldDetailReader } from './world-detail-reader.js';
import { worldTimeDisplay } from './world-detail-paper-model.js';
import { formatLocaleDateTime } from '../../i18n/index.js';

// The people section shows the Realm people catalog inline: portraits in a five-per-row
// grid with server-side search and cursor paging, so every person of the world is
// reachable here without a separate archive page.
const PEOPLE_GALLERY_GRID = 'grid grid-cols-2 gap-5 @min-[640px]:grid-cols-3 @min-[1120px]:grid-cols-5';

function WorldPeopleGallery({ characters, catalog, loading, onView }: {
  characters: readonly WorldCharacter[];
  catalog: WorldPeopleCatalogState;
  loading?: boolean;
  onView: (character: WorldCharacter) => void;
}) {
  const { t } = useTranslation();
  const showSearch = catalog.query.trim().length > 0 || catalog.totalCount > 5;
  return (
    <section id="world-detail-characters" data-testid="world-detail-characters" className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <NimiText role="section-title">{t('WorldDetail.discovery.people')}</NimiText>
          {catalog.status === 'ready' ? <NimiText role="caption">{t('WorldDetail.discovery.peopleCount', { count: catalog.totalCount })}</NimiText> : null}
        </div>
        <div className="flex max-w-full items-center gap-1">
          {showSearch ? <SearchField value={catalog.query} onChange={(event) => catalog.onQueryChange(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') catalog.onQueryChange(''); }} placeholder={t('WorldDetail.discovery.searchPeople')} aria-label={t('WorldDetail.discovery.searchPeople')} className="w-full sm:w-64" /> : null}
          {catalog.query ? <IconButton tone="ghost" size="sm" icon={<X size={15} />} aria-label={t('World.clearSearch')} onClick={() => catalog.onQueryChange('')} /> : null}
        </div>
      </div>
      {loading ? <LoadingSkeleton lines={3} label={t('WorldDetail.charactersLoading')} /> : catalog.status !== 'ready' ? <PeopleCatalogFirstPageStatus catalog={catalog} /> : characters.length ? (
        <div className={PEOPLE_GALLERY_GRID}>
          {characters.map((character) => {
            const image = character.portraitUrl || character.mediaAssets?.portrait?.externalUrl || character.avatarUrl || character.mediaAssets?.avatar?.externalUrl || null;
            const identity = character.role || character.faction || '';
            return (
              <button
                key={`${character.sourceRef.kind}:${character.id}`}
                type="button"
                onClick={() => onView(character)}
                aria-label={t('WorldDetail.discovery.viewNamedCharacter', { name: character.name })}
                className="group min-w-0 text-left"
                data-testid="world-person-card"
              >
                <MediaImage delivery={character.mediaAssets?.portrait?.delivery ?? character.avatarMedia} externalUrl={image} purpose="detail" sizes="auto, 220px" alt={character.name} className="aspect-[5/4] h-auto w-full rounded-[12px] bg-[var(--nimi-surface-panel)] text-2xl transition-transform duration-200 group-hover:-translate-y-0.5 [&_img]:object-[50%_30%]" />
                <div className="mt-2.5 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <NimiText as="span" role="card-title" className="block line-clamp-1 break-words" title={character.name}>{character.name}</NimiText>
                    {identity ? <NimiText as="span" role="caption" className="mt-0.5 block line-clamp-1" title={identity}>{identity}</NimiText> : null}
                  </div>
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--nimi-border-subtle)] text-[var(--nimi-text-muted)] transition-colors group-hover:border-[var(--nimi-border-strong)] group-hover:text-[var(--nimi-text-primary)]">
                    <ArrowUpRight size={13} />
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      ) : <EmptyState title={t(catalog.query ? 'WorldDetail.discovery.noPeopleMatch' : 'WorldDetail.discovery.noPeople')} />}
      <PeopleCatalogMoreControl catalog={catalog} loadedCount={characters.length} />
    </section>
  );
}

function WorldSceneRow({ scene, onViewCharacter }: {
  scene: WorldSceneItem;
  onViewCharacter: (character: WorldCharacter) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex w-full min-w-0 items-start gap-3 py-3.5 first:pt-0 last:pb-0" data-testid="world-scene-row">
      <span className={ITEM_TITLE_ICON}><MapPin size={15} /></span>
      <div className="min-w-0 flex-1">
        <NimiText as="span" role="card-title" className="block line-clamp-1 break-words" title={scene.name}>{scene.name}</NimiText>
        {scene.description ? <NimiText as="span" role="helper" className="mt-1 block break-words">{scene.description}</NimiText> : null}
        {scene.relatedCharacters.length ? (
          <div className="mt-2.5 flex flex-wrap items-center gap-x-3.5 gap-y-2">
            {scene.relatedCharacters.map((character) => {
              const avatar = character.avatarUrl || character.mediaAssets?.avatar?.externalUrl || character.portraitUrl || character.mediaAssets?.portrait?.externalUrl || null;
              return (
                <button
                  key={`${scene.id}:${character.sourceRef.kind}:${character.id}`}
                  type="button"
                  onClick={() => onViewCharacter(character)}
                  aria-label={t('WorldDetail.discovery.viewNamedCharacter', { name: character.name })}
                  className="group/person flex min-w-0 items-center gap-2"
                >
                  <MediaAvatar delivery={character.avatarMedia ?? character.mediaAssets?.portrait?.delivery} externalUrl={avatar} alt={character.name} size="sm" shape="circle" tone="neutral" className="transition-transform duration-200 group-hover/person:-translate-y-0.5" />
                  <NimiText as="span" role="caption" className="line-clamp-1 break-words transition-colors group-hover/person:text-[var(--nimi-text-primary)]">{character.name}</NimiText>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}

const ITEM_TITLE_ICON = 'flex h-[21px] w-5 shrink-0 items-center justify-center text-[var(--nimi-text-muted)]';

// @nimi-authority: rule.nimi.desktop.shell-ui.r011
// @nimi-authority: rule.nimi.desktop.shell-ui.r012
export function WorldDetailDiscovery({ props, scenes, onViewCharacter }: {
  props: WorldDetailPageProps;
  scenes: readonly WorldSceneItem[];
  onViewCharacter: (character: WorldCharacter) => void;
}) {
  const { t } = useTranslation();
  const [readerOpen, setReaderOpen] = useState(false);
  const [bannerFailed, setBannerFailed] = useState(false);
  const world = props.world;
  const summary = worldSummary(world);
  const summaryLead = summary ? worldSummaryLead(summary) : null;
  const settings = worldReadingEntries(world, props.semantic, props.history).filter((entry) => entry.section !== 'description');
  const timeLabel = worldTimeDisplay(world.time, formatLocaleDateTime);
  const metaLine = timeLabel || world.era;
  const heroCaption = [world.motto, world.tagline]
    .map((value) => value?.trim() ?? '')
    .find((value) => value && value !== summary.trim()) || null;
  const showBanner = Boolean((world.bannerMedia || world.bannerUrl) && !bannerFailed);
  const aboutSystems = props.semantic.powerSystems;
  const aboutRules = aboutSystems.length === 0 ? props.semantic.operationRules.slice(0, 3) : [];
  const showAbout = aboutSystems.length > 0 || aboutRules.length > 0;
  const listedScenes = scenes.slice(0, 4);
  const pairedAboutPlaces = showAbout && listedScenes.length > 0;
  return (
    <main className="@container mx-auto w-full max-w-[1440px] space-y-10 p-6 @min-[1120px]:px-10" data-nimi-density="regular" data-testid="world-detail-discovery">
      {props.onBack ? <Button tone="ghost" size="sm" leadingIcon={<ArrowLeft size={16} />} onClick={props.onBack}>{t('WorldDetail.glass.backToAtlas')}</Button> : null}
      <section data-testid="world-detail-overview" className={showBanner ? 'grid items-start gap-6 @min-[1120px]:grid-cols-[minmax(0,3fr)_minmax(0,7fr)] @min-[1120px]:gap-10' : 'max-w-[720px]'}>
        <div className="order-2 space-y-4 @min-[1120px]:order-1" data-nimi-density="expressive">
          {world.genre ? <NimiText role="overline">{world.genre}</NimiText> : null}
          <NimiText role="hero-title" className="line-clamp-2 break-words" title={world.name}>{world.name}</NimiText>
          {metaLine ? <NimiText role="helper" className="line-clamp-1" title={metaLine}>{metaLine}</NimiText> : null}
          {summaryLead ? <NimiText role="body" className="whitespace-pre-wrap break-words" data-testid="world-detail-summary">{summaryLead}</NimiText> : null}
          <div className="flex flex-wrap items-center justify-end gap-2.5 pt-2">
            {props.onFollowWorld ? <IconButton tone="secondary" size="sm" className="rounded-full" icon={props.worldFollowed ? <Bookmark size={16} fill="currentColor" className="text-[var(--nimi-action-primary-bg)]" /> : <Bookmark size={16} />} aria-pressed={Boolean(props.worldFollowed)} aria-label={t(props.worldFollowed ? 'WorldDetail.discovery.followed' : 'WorldDetail.discovery.follow')} onClick={() => props.onFollowWorld?.(world)} data-testid="world-detail-follow-world" /> : null}
            {summary || settings.length ? <Button tone="primary" size="sm" className="rounded-full px-4 shadow-[var(--nimi-elevation-base)]" leadingIcon={<BookOpen size={16} />} onClick={() => setReaderOpen(true)} data-testid="world-detail-open-reader">{t('WorldDetail.discovery.readWorld')}</Button> : null}
          </div>
        </div>
        {showBanner ? (
          <div className="relative order-1 @min-[1120px]:order-2">
            <MediaImage delivery={world.bannerMedia} externalUrl={world.bannerUrl} purpose="hero" sizes="auto, 960px" loading="eager" fetchPriority="high" alt="" className="h-60 w-full rounded-[14px] object-cover @min-[640px]:h-80 @min-[1120px]:h-[380px]" onUnavailable={() => setBannerFailed(true)} data-testid="world-detail-banner" />
            {heroCaption ? <NimiText as="span" role="caption" className="absolute right-3 bottom-3 line-clamp-1 max-w-[70%] text-white [text-shadow:0_1px_8px_rgba(0,0,0,0.5)]" title={heroCaption}>{heroCaption}</NimiText> : null}
          </div>
        ) : null}
      </section>
      <WorldPeopleGallery characters={props.peopleCharacters} catalog={props.peopleCatalog} loading={props.charactersLoading} onView={onViewCharacter} />
      {props.readingIncomplete ? <EmptyState title={t('WorldDetail.discovery.readingIncomplete')} action={props.onRetryReading ? <Button tone="secondary" size="sm" onClick={props.onRetryReading}>{t('WorldDetail.paper.gallery.retry')}</Button> : undefined} /> : null}
      {props.semanticLoading ? <LoadingSkeleton lines={2} label={t('WorldDetail.loading')} /> : null}
      {showAbout || listedScenes.length ? (
        <div className="rounded-[24px] bg-[color-mix(in_srgb,var(--nimi-surface-panel)_55%,transparent)] p-6 @min-[640px]:p-8 @min-[1120px]:p-10">
          <div className={pairedAboutPlaces ? 'grid items-start gap-8 @min-[1120px]:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] @min-[1120px]:gap-0' : 'grid gap-8'}>
            {showAbout ? (
              <section className={pairedAboutPlaces ? 'space-y-5 @min-[1120px]:pr-12' : 'space-y-5'} data-testid="world-detail-about">
                <NimiText role="section-title">{t('WorldDetail.discovery.about')}</NimiText>
                {aboutSystems.length || aboutRules.length ? (
                  <div className={aboutSystems.length ? 'space-y-6 pt-1' : 'grid gap-5 pt-1 @min-[640px]:grid-cols-3'} data-testid="world-detail-about-systems">
                    {aboutSystems.map((system, index) => {
                      const details = [...new Set(
                        [system.description, ...system.rules, ...system.levels.map((level) => [level.name, level.description, level.extra].filter(Boolean).join('\n'))]
                          .map((value) => value?.trim())
                          .filter((value): value is string => Boolean(value) && value !== system.name.trim()),
                      )];
                      return (
                        <div key={`system-${index}`} className="flex min-w-0 items-start gap-3">
                          <span className={ITEM_TITLE_ICON}><Compass size={15} /></span>
                          <div className="min-w-0 flex-1 space-y-1.5">
                            <NimiText as="p" role="card-title" className="break-words">{system.name}</NimiText>
                            {details.map((text, detailIndex) => (
                              <NimiText key={detailIndex} role="helper" className="whitespace-pre-wrap break-words">{text}</NimiText>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                    {aboutRules.map((rule) => (
                      <div key={rule.key} className="flex min-w-0 items-start gap-3">
                        <span className={ITEM_TITLE_ICON}><ScrollText size={15} /></span>
                        <div className="min-w-0 flex-1 space-y-1">
                          <NimiText as="p" role="card-title" className="line-clamp-2 break-words" title={rule.title}>{rule.title}</NimiText>
                          {rule.value ? <NimiText role="helper" className="line-clamp-2 break-words">{rule.value}</NimiText> : null}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </section>
            ) : null}
            {listedScenes.length ? (
              <section id="world-detail-scenes" className={pairedAboutPlaces ? 'space-y-5 border-t border-[var(--nimi-border-subtle)] pt-8 @min-[1120px]:border-t-0 @min-[1120px]:border-l @min-[1120px]:pt-0 @min-[1120px]:pl-12' : 'space-y-5'} data-testid="world-detail-scenes">
                <NimiText role="section-title">{t('WorldDetail.discovery.places')}</NimiText>
                <div className="divide-y divide-[var(--nimi-border-subtle)] pt-1">
                  {listedScenes.map((scene) => <WorldSceneRow key={scene.id} scene={scene} onViewCharacter={onViewCharacter} />)}
                </div>
              </section>
            ) : null}
          </div>
        </div>
      ) : null}
      {props.publicAssetsIncomplete ? <EmptyState title={t('WorldDetail.discovery.placesIncomplete')} action={props.onRetryReading ? <Button tone="secondary" size="sm" onClick={props.onRetryReading}>{t('WorldDetail.paper.gallery.retry')}</Button> : undefined} /> : null}
      {readerOpen ? <WorldDetailReader world={world} semantic={props.semantic} history={props.history} loading={props.semanticLoading || props.historyLoading} incomplete={props.readingIncomplete} onRetry={props.onRetryReading} onClose={() => setReaderOpen(false)} /> : null}
    </main>
  );
}
