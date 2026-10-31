import { MediaImage } from '@nimiplatform/kit/features/media';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Bookmark } from 'lucide-react';
import { Button, EmptyState, IconButton, LoadingSkeleton, NimiText, SearchField } from '@nimiplatform/kit/ui';
import type { WorldDetailPageProps } from './world-detail-template.js';
import type { WorldCharacter, WorldPeopleCatalogState } from './world-detail-types.js';
import { PeopleCatalogFirstPageStatus, PeopleCatalogMoreControl } from './world-detail-people-catalog-status.js';
import { worldSummary, worldSummaryLead } from './world-detail-template-model.js';
import { worldReadingEntries } from './world-detail-reading-model.js';
import { WorldDetailStory } from './world-detail-story.js';
import { worldTitlePhrases } from './world-title-phrases.js';
import { worldIllustrations } from './world-detail-illustrations.js';
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
            const delivery = character.mediaAssets?.portrait?.delivery ?? character.avatarMedia;
            // Gallery artwork needs display-sized renditions, even when authored in the avatar slot.
            const imagePurpose = delivery?.images.some((set) => set.purpose === 'detail') ? 'detail' : 'avatar';
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
                <MediaImage delivery={delivery} externalUrl={image} purpose={imagePurpose} sizes="auto, 220px" alt={character.name} className="h-auto w-full rounded-[12px] bg-[var(--nimi-surface-panel)] text-2xl transition-transform duration-200 group-hover:-translate-y-0.5" />
                <div className="relative z-10 -mt-2 w-full rounded-[12px] bg-[color-mix(in_srgb,var(--nimi-surface-panel)_97%,transparent)] p-4 transition-colors duration-200 group-hover:bg-[var(--nimi-surface-panel)]">
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

// @nimi-authority: rule.nimi.desktop.shell-ui.r011
// @nimi-authority: rule.nimi.desktop.shell-ui.r012
export function WorldDetailDiscovery({ props, onViewCharacter, onReadWorld }: {
  props: WorldDetailPageProps;
  onReadWorld: () => void;
  onViewCharacter: (character: WorldCharacter) => void;
}) {
  const { t, i18n } = useTranslation();
  const [bannerFailed, setBannerFailed] = useState(false);
  const world = props.world;
  const category = (world.topicIds ?? []).flatMap((topicId) => {
    const topic = props.topics?.find((item) => item.id === topicId);
    return topic ? [i18n.language.startsWith('zh') ? topic.title : topic.titleEn] : [];
  }).join(' · ') || world.genre;
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
  const illustrations = worldIllustrations(props.publicAssets);
  const story = world.setting?.trim() || summary;
  const hasReading = Boolean(story || settings.length);
  const showExcerpt = Boolean(world.setting?.trim() || story !== summaryLead);
  const followButton = props.onFollowWorld ? <IconButton tone="secondary" size="sm" className={showBanner ? 'absolute top-3 right-3 z-10 rounded-full border-white/15 bg-black/45 text-white shadow-none backdrop-blur-md hover:border-white/30 hover:bg-black/60 hover:shadow-none' : 'rounded-full'} icon={props.worldFollowed ? <Bookmark size={16} fill="currentColor" className="text-[var(--nimi-action-primary-bg)]" /> : <Bookmark size={16} />} aria-pressed={Boolean(props.worldFollowed)} aria-label={t(props.worldFollowed ? 'WorldDetail.discovery.followed' : 'WorldDetail.discovery.follow')} onClick={() => props.onFollowWorld?.(world)} data-testid="world-detail-follow-world" /> : null;
  return (
    <main className="world-detail-content @container mx-auto w-full max-w-[1440px] space-y-10 p-6 @min-[1120px]:px-10" data-nimi-density="regular" data-testid="world-detail-discovery">
      <section data-testid="world-detail-overview" className={showBanner ? 'grid items-center gap-6 @min-[1120px]:grid-cols-[minmax(0,3fr)_minmax(0,7fr)] @min-[1120px]:gap-10' : 'max-w-[720px]'}>
        <div className="order-2 space-y-4 @min-[1120px]:order-1" data-nimi-density="expressive">
          {category ? <NimiText role="overline" className="tracking-[0.24em]" data-testid="world-detail-category">{category}</NimiText> : null}
          <NimiText role="hero-title" className="world-detail-title" title={world.name}>{worldTitlePhrases(world.name).map((phrase, index) => <span key={index} className="world-title-phrase">{phrase}</span>)}</NimiText>
          {metaLine ? <NimiText role="helper" className="invisible line-clamp-1" aria-hidden="true">{metaLine}</NimiText> : null}
          {summaryLead ? <NimiText role="body" className="whitespace-pre-wrap break-words" data-testid="world-detail-summary">{summaryLead}</NimiText> : null}
          {!showBanner && props.onFollowWorld ? <div className="flex flex-wrap items-center justify-end gap-2.5 pt-2">{followButton}</div> : null}
        </div>
        {showBanner ? (
          <div className={useContainedBanner ? 'relative order-1 aspect-[16/9] overflow-hidden rounded-[14px] bg-[var(--nimi-surface-panel)] @min-[1120px]:order-2' : 'relative order-1 @min-[1120px]:order-2'} data-testid="world-detail-banner-frame">
            {useContainedBanner ? <MediaImage delivery={world.bannerMedia} externalUrl={world.bannerUrl} purpose="hero" sizes="auto, 960px" loading="eager" fetchPriority="low" alt="" aria-hidden="true" className="absolute inset-0 h-full w-full scale-110 object-cover blur-2xl" onUnavailable={() => setBannerFailed(true)} /> : null}
            <MediaImage delivery={world.bannerMedia} externalUrl={world.bannerUrl} purpose="hero" sizes="auto, 960px" loading="eager" fetchPriority="high" alt="" className={useContainedBanner ? 'relative h-full w-full object-contain' : 'h-auto w-full rounded-[14px]'} onUnavailable={() => setBannerFailed(true)} data-testid="world-detail-banner" />
            {followButton}
            {heroCaption ? <NimiText as="span" role="caption" className="absolute right-3 bottom-3 line-clamp-1 max-w-[70%] text-white [text-shadow:0_1px_8px_rgba(0,0,0,0.5)]" title={heroCaption}>{heroCaption}</NimiText> : null}
          </div>
        ) : null}
      </section>
      <WorldDetailStory key={world.id} worldName={world.name} story={story} showExcerpt={showExcerpt} hasReading={hasReading} illustrations={illustrations} onReadWorld={onReadWorld} />
      <WorldPeopleGallery characters={props.peopleCharacters} catalog={props.peopleCatalog} loading={props.charactersLoading} onView={onViewCharacter} />
      {props.readingIncomplete ? <EmptyState title={t('WorldDetail.discovery.readingIncomplete')} action={props.onRetryReading ? <Button tone="secondary" size="sm" onClick={props.onRetryReading}>{t('WorldDetail.paper.gallery.retry')}</Button> : undefined} /> : null}
      {props.semanticLoading ? <LoadingSkeleton lines={2} label={t('WorldDetail.loading')} /> : null}
      {props.publicAssetsIncomplete ? <EmptyState title={t('WorldDetail.discovery.placesIncomplete')} action={props.onRetryReading ? <Button tone="secondary" size="sm" onClick={props.onRetryReading}>{t('WorldDetail.paper.gallery.retry')}</Button> : undefined} /> : null}
    </main>
  );
}
