import { MediaImage, MediaAvatar } from '@nimiplatform/kit/features/media';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, BookOpen, Bookmark, Compass, MapPin, ScrollText } from 'lucide-react';
import { Button, EmptyState, IconButton, LoadingSkeleton, NimiText, SearchField } from '@nimiplatform/kit/ui';
import type { WorldDetailPageProps } from './world-detail-template.js';
import type { WorldCharacter, WorldPeopleCatalogState, WorldSceneItem } from './world-detail-types.js';
import { PeopleCatalogFirstPageStatus, PeopleCatalogMoreControl } from './world-detail-people-catalog-status.js';
import { worldSummary, worldSummaryLead } from './world-detail-template-model.js';
import { worldReadingEntries } from './world-detail-reading-model.js';
import { WorldStoryMarkdown } from './world-story-markdown.js';
import { WorldDetailIllustrations, worldIllustrations } from './world-detail-illustrations.js';
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
          {showSearch ? <SearchField value={catalog.query} onChange={(event) => catalog.onQueryChange(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') catalog.onQueryChange(''); }}
            onClear={() => catalog.onQueryChange('')} clearLabel={t('World.clearSearch')}
            placeholder={t('WorldDetail.discovery.searchPeople')} aria-label={t('WorldDetail.discovery.searchPeople')} className="w-full sm:w-64" /> : null}
        </div>
      </div>
      {catalog.status === 'partial' ? <PeopleCatalogFirstPageStatus catalog={catalog} /> : null}
      {loading && !characters.length && catalog.status === 'loading' ? <LoadingSkeleton lines={3} label={t('WorldDetail.charactersLoading')} /> : catalog.status !== 'ready' && catalog.status !== 'partial' ? <PeopleCatalogFirstPageStatus catalog={catalog} /> : characters.length ? (
        <div className={PEOPLE_GALLERY_GRID}>
          {characters.map((character) => {
            const image = character.portraitUrl || character.mediaAssets?.portrait?.externalUrl || character.avatarUrl || character.mediaAssets?.avatar?.externalUrl || null;
            const portraitDelivery = character.mediaAssets?.portrait?.delivery;
            const identity = [character.ageDescription, character.role, character.faction]
              .map((value) => value?.trim())
              .filter((value): value is string => Boolean(value));
            const bio = character.bio.trim();
            return (
              <button
                key={`${character.sourceRef.kind}:${character.id}`}
                type="button"
                onClick={() => onView(character)}
                aria-label={t('WorldDetail.discovery.viewNamedCharacter', { name: character.name })}
                className="group flex min-w-0 flex-col items-start text-left"
                data-testid="world-person-card"
              >
                <MediaImage delivery={portraitDelivery ?? character.avatarMedia} externalUrl={image} purpose={portraitDelivery ? 'detail' : 'avatar'} sizes="auto, 220px" alt={character.name} className="h-auto w-full rounded-[12px] bg-[var(--nimi-surface-panel)] text-2xl transition-transform duration-200 group-hover:-translate-y-0.5" />
                <div className="mt-3 w-full rounded-[12px] bg-[color-mix(in_srgb,var(--nimi-surface-panel)_72%,transparent)] p-4 transition-colors duration-200 group-hover:bg-[var(--nimi-surface-panel)]">
                  <div className="flex w-full items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <NimiText as="span" role="card-title" className="line-clamp-1 break-words text-[22px] font-semibold leading-7 tracking-normal" title={character.name}>{character.name}</NimiText>
                      {identity.length ? <NimiText as="span" role="caption" className="mt-1 line-clamp-1 w-full break-words font-normal leading-5 tracking-[0.01em] text-[var(--nimi-text-secondary)]" title={identity.join(' | ')} data-testid="world-person-meta">{identity.join(' | ')}</NimiText> : null}
                    </div>
                    <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center text-[var(--nimi-text-muted)] transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-[var(--nimi-text-primary)] group-focus-visible:text-[var(--nimi-text-primary)]">
                      <ArrowRight size={19} strokeWidth={1.6} />
                    </span>
                  </div>
                  {bio ? <NimiText as="span" role="body" className="mt-3 line-clamp-2 min-h-10 w-full text-pretty break-words text-[13px] font-normal leading-5 tracking-[0.01em] text-[var(--nimi-text-secondary)]" title={bio} data-testid="world-person-bio">{bio}</NimiText> : null}
                </div>
              </button>
            );
          })}
        </div>
      ) : catalog.status === 'partial' ? null : <EmptyState title={t(catalog.query ? 'WorldDetail.discovery.noPeopleMatch' : 'WorldDetail.discovery.noPeople')} />}
      <PeopleCatalogMoreControl catalog={catalog} loadedCount={characters.length} />
    </section>
  );
}

function WorldSceneRow({ scene, onViewCharacter, standalone }: {
  standalone?: boolean;
  scene: WorldSceneItem;
  onViewCharacter: (character: WorldCharacter) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex w-full min-w-0 items-start gap-3 py-3.5 first:pt-0 last:pb-0" data-testid="world-scene-row">
      {!standalone ? <span className={ITEM_TITLE_ICON}><MapPin size={15} /></span> : null}
      <div className="min-w-0 flex-1">
        <NimiText as={standalone ? 'h2' : 'h3'} role={standalone ? 'section-title' : 'card-title'} className="break-words">{scene.name}</NimiText>
        {scene.description ? <NimiText role="body" className="mt-4 whitespace-pre-wrap break-words leading-relaxed">{scene.description}</NimiText> : null}
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
export function WorldDetailDiscovery({ props, scenes, onViewCharacter, onReadWorld }: {
  props: WorldDetailPageProps;
  onReadWorld: () => void;
  scenes: readonly WorldSceneItem[];
  onViewCharacter: (character: WorldCharacter) => void;
}) {
  const { t } = useTranslation();
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
  const useContainedBanner = world.id === 'x01';
  const aboutSystems = props.semantic.powerSystems;
  const aboutRules = aboutSystems.length === 0 ? props.semantic.operationRules.slice(0, 3) : [];
  const showAbout = aboutSystems.length > 0 || aboutRules.length > 0;
  const listedScenes = scenes.slice(0, 4);
  const illustrations = worldIllustrations(props.publicAssets);
  const story = world.setting?.trim() || summary;
  const hasReading = Boolean(story || settings.length);
  const showExcerpt = Boolean(world.setting?.trim() || story !== summaryLead);
  return (
    <main className="@container mx-auto w-full max-w-[1440px] space-y-10 p-6 @min-[1120px]:px-10" data-nimi-density="regular" data-testid="world-detail-discovery">
      <section data-testid="world-detail-overview" className={showBanner ? 'grid items-center gap-6 @min-[1120px]:grid-cols-[minmax(0,3fr)_minmax(0,7fr)] @min-[1120px]:gap-10' : 'max-w-[720px]'}>
        <div className="order-2 space-y-4 @min-[1120px]:order-1" data-nimi-density="expressive">
          {world.genre ? <NimiText role="overline">{world.genre}</NimiText> : null}
          <NimiText role="hero-title" className="line-clamp-2 break-words" title={world.name}>{world.name}</NimiText>
          {metaLine ? <NimiText role="helper" className="invisible line-clamp-1" aria-hidden="true">{metaLine}</NimiText> : null}
          {summaryLead ? <NimiText role="body" className="whitespace-pre-wrap break-words" data-testid="world-detail-summary">{summaryLead}</NimiText> : null}
          <div className="flex flex-wrap items-center justify-end gap-2.5 pt-2">
            {props.onFollowWorld ? <IconButton tone="secondary" size="sm" className="rounded-full" icon={props.worldFollowed ? <Bookmark size={16} fill="currentColor" className="text-[var(--nimi-action-primary-bg)]" /> : <Bookmark size={16} />} aria-pressed={Boolean(props.worldFollowed)} aria-label={t(props.worldFollowed ? 'WorldDetail.discovery.followed' : 'WorldDetail.discovery.follow')} onClick={() => props.onFollowWorld?.(world)} data-testid="world-detail-follow-world" /> : null}
          </div>
        </div>
        {showBanner ? (
          <div className={useContainedBanner ? 'relative order-1 aspect-[16/9] overflow-hidden rounded-[14px] bg-[var(--nimi-surface-panel)] @min-[1120px]:order-2' : 'relative order-1 @min-[1120px]:order-2'} data-testid="world-detail-banner-frame">
            {useContainedBanner ? <MediaImage delivery={world.bannerMedia} externalUrl={world.bannerUrl} purpose="hero" sizes="auto, 960px" loading="eager" fetchPriority="low" alt="" aria-hidden="true" className="absolute inset-0 h-full w-full scale-110 object-cover blur-2xl" onUnavailable={() => setBannerFailed(true)} /> : null}
            <MediaImage delivery={world.bannerMedia} externalUrl={world.bannerUrl} purpose="hero" sizes="auto, 960px" loading="eager" fetchPriority="high" alt="" className={useContainedBanner ? 'relative h-full w-full object-contain' : 'h-auto w-full rounded-[14px]'} onUnavailable={() => setBannerFailed(true)} data-testid="world-detail-banner" />
            {heroCaption ? <NimiText as="span" role="caption" className="absolute right-3 bottom-3 line-clamp-1 max-w-[70%] text-white [text-shadow:0_1px_8px_rgba(0,0,0,0.5)]" title={heroCaption}>{heroCaption}</NimiText> : null}
          </div>
        ) : null}
      </section>
      {hasReading ? (
        <section className="space-y-5 border-t border-[var(--nimi-border-subtle)] pt-8" data-testid="world-detail-story">
          <NimiText as="h2" role="section-title">{t('WorldDetail.discovery.story')}</NimiText>
          {showExcerpt ? <div className="max-w-[960px]"><WorldStoryMarkdown content={story} excerpt /></div> : null}
          <Button tone="primary" size="sm" className="rounded-full px-4" leadingIcon={<BookOpen size={16} />} onClick={onReadWorld} data-testid="world-detail-open-reader">{t('WorldDetail.discovery.readWorld')}</Button>
        </section>
      ) : null}
      <WorldPeopleGallery characters={props.peopleCharacters} catalog={props.peopleCatalog} loading={props.charactersLoading} onView={onViewCharacter} />
      {props.readingIncomplete ? <EmptyState title={t('WorldDetail.discovery.readingIncomplete')} action={props.onRetryReading ? <Button tone="secondary" size="sm" onClick={props.onRetryReading}>{t('WorldDetail.paper.gallery.retry')}</Button> : undefined} /> : null}
      {props.semanticLoading ? <LoadingSkeleton lines={2} label={t('WorldDetail.loading')} /> : null}
      {showAbout ? (
        <section className="space-y-5 border-t border-[var(--nimi-border-subtle)] pt-8" data-testid="world-detail-about">
          <NimiText as="h2" role="section-title">{t('WorldDetail.discovery.about')}</NimiText>
          <div className="grid gap-6 @min-[640px]:grid-cols-2">
            {aboutSystems.map((system, index) => {
              const details = [...new Set(
                [system.description, ...system.rules, ...system.levels.map((level) => [level.name, level.description, level.extra].filter(Boolean).join('\n'))]
                  .map((value) => value?.trim()).filter((value): value is string => Boolean(value) && value !== system.name.trim()),
              )];
              return <div key={index} className="flex min-w-0 items-start gap-3">
                <span className={ITEM_TITLE_ICON}><Compass size={15} /></span>
                <div className="min-w-0 space-y-2">
                  <NimiText as="p" role="card-title">{system.name}</NimiText>
                  {details.map((text, detailIndex) => <NimiText key={detailIndex} role="body" className="whitespace-pre-wrap break-words">{text}</NimiText>)}
                </div>
              </div>;
            })}
            {aboutRules.map((rule) => <div key={rule.key} className="flex min-w-0 items-start gap-3">
              <span className={ITEM_TITLE_ICON}><ScrollText size={15} /></span>
              <div className="min-w-0 space-y-2">
                <NimiText as="h3" role="card-title">{rule.title}</NimiText>
                {rule.value ? <NimiText role="body" className="whitespace-pre-wrap break-words">{rule.value}</NimiText> : null}
              </div>
            </div>)}
          </div>
        </section>
      ) : null}
      {illustrations.length || listedScenes.length ? (
        <div className={'grid items-start gap-8 border-t border-[var(--nimi-border-subtle)] pt-8 ' + (illustrations.length && listedScenes.length ? '@min-[1120px]:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] @min-[1120px]:gap-10' : '')}>
          {illustrations.length ? <WorldDetailIllustrations key={world.id} illustrations={illustrations} worldName={world.name} /> : null}
          {listedScenes.length ? <section id="world-detail-scenes" className="min-w-0 space-y-5" data-testid="world-detail-scenes">
            {listedScenes.length > 1 ? <NimiText as="h2" role="section-title">{t('WorldDetail.discovery.places')}</NimiText> : null}
            <div className="divide-y divide-[var(--nimi-border-subtle)]">
              {listedScenes.map((scene) => <WorldSceneRow key={scene.id} scene={scene} standalone={listedScenes.length === 1} onViewCharacter={onViewCharacter} />)}
            </div>
          </section> : null}
        </div>
      ) : null}
      {props.publicAssetsIncomplete ? <EmptyState title={t('WorldDetail.discovery.placesIncomplete')} action={props.onRetryReading ? <Button tone="secondary" size="sm" onClick={props.onRetryReading}>{t('WorldDetail.paper.gallery.retry')}</Button> : undefined} /> : null}
    </main>
  );
}
