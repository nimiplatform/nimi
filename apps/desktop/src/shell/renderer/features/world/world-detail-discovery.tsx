import { MediaImage } from '@nimiplatform/kit/features/media';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Bookmark, BookOpen, MapPin, UsersRound } from 'lucide-react';
import { Button, EmptyState, IconButton, LoadingSkeleton, NimiText, SearchField } from '@nimiplatform/kit/ui';
import type { WorldDetailPageProps } from './world-detail-template.js';
import type { WorldCharacter, WorldPeopleCatalogState, WorldSceneItem } from './world-detail-types.js';
import { PeopleCatalogFirstPageStatus, PeopleCatalogMoreControl } from './world-detail-people-catalog-status.js';
import { worldSummary, worldSummaryLead } from './world-detail-template-model.js';
import { worldReadingEntries } from './world-detail-reading-model.js';
import { WorldDetailStory } from './world-detail-story.js';
import { worldTitlePhrases } from './world-title-phrases.js';
import { worldIllustrations } from './world-detail-illustrations.js';
import { worldTimeDisplay } from './world-detail-paper-model.js';
import { formatLocaleDateTime } from '../../i18n/index.js';
import { CharacterVoicePreviewButton, stopCharacterVoicePreview } from '../explore/character-voice-preview.js';

// The people section shows the Realm people catalog inline: portraits in a four-per-row
// grid with server-side search and cursor paging, so every person of the world is
// reachable here without a separate archive page.
const PEOPLE_GALLERY_GRID = 'grid grid-cols-2 gap-5 @min-[640px]:grid-cols-3 @min-[1120px]:grid-cols-4';

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
        {showSearch ? <SearchField value={catalog.query} onChange={(event) => catalog.onQueryChange(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') catalog.onQueryChange(''); }}
          onClear={() => catalog.onQueryChange('')} clearLabel={t('World.clearSearch')}
          placeholder={t('WorldDetail.discovery.searchPeople')} aria-label={t('WorldDetail.discovery.searchPeople')} className="w-full sm:w-64" /> : null}
      </div>
      {catalog.status === 'partial' ? <PeopleCatalogFirstPageStatus catalog={catalog} /> : null}
      {loading && !characters.length && catalog.status === 'loading' ? <LoadingSkeleton lines={3} label={t('WorldDetail.charactersLoading')} /> : catalog.status !== 'ready' && catalog.status !== 'partial' ? <PeopleCatalogFirstPageStatus catalog={catalog} /> : characters.length ? (
        <div className={PEOPLE_GALLERY_GRID}>
          {characters.map((character) => {
            const image = character.portraitUrl || character.mediaAssets?.portrait?.externalUrl || character.avatarUrl || character.mediaAssets?.avatar?.externalUrl || null;
            const delivery = character.mediaAssets?.portrait?.delivery ?? character.avatarMedia;
            // Gallery artwork needs display-sized renditions, even when authored in the avatar slot.
            const imagePurpose = delivery?.images.some((set) => set.purpose === 'detail') ? 'detail' : 'avatar';
            const age = character.ageDescription?.trim() || '';
            const role = character.role?.trim() || '';
            const faction = character.faction?.trim() || '';
            const identity = [
              age && (age.length <= 10 || (!role && !faction)) ? age : '',
              role,
              faction,
            ].filter((value): value is string => Boolean(value));
            const bio = character.bio.trim();
            const voiceUrl = character.voiceSampleUrl || character.mediaAssets?.voiceSample?.delivery?.previewUrl || null;
            return (
              <article
                key={`${character.sourceRef.kind}:${character.id}`}
                className="group relative flex min-w-0 flex-col items-start text-left"
                data-testid="world-person-card"
              >
                <div className="relative w-full">
                  <button
                    type="button"
                    onClick={() => { stopCharacterVoicePreview(); onView(character); }}
                    aria-label={t('WorldDetail.discovery.viewNamedCharacter', { name: character.name })}
                    className="flex w-full min-w-0 flex-col items-start text-left focus-visible:rounded-[12px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
                  >
                    <MediaImage delivery={delivery} externalUrl={image} purpose={imagePurpose} sizes="auto, 220px" alt={character.name} className="block h-auto w-full rounded-[12px] bg-[color-mix(in_srgb,var(--nimi-surface-panel)_88%,var(--nimi-action-primary-bg)_12%)] text-2xl transition-transform duration-200 group-hover:-translate-y-0.5" />
                    <div className="relative z-10 -mt-2 w-full rounded-[12px] bg-[color-mix(in_srgb,var(--nimi-surface-panel)_97%,transparent)] p-3.5 transition-colors duration-200 group-hover:bg-[var(--nimi-surface-panel)]">
                      <div className="flex w-full items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <NimiText as="span" role="card-title" className="line-clamp-1 break-words text-[17px] font-semibold leading-6 tracking-normal" title={character.name}>{character.name}</NimiText>
                          {identity.length ? <NimiText as="span" role="caption" className="mt-1 line-clamp-1 w-full break-words font-normal leading-5 tracking-[0.01em] text-[var(--nimi-text-secondary)]" title={identity.join(' | ')} data-testid="world-person-meta">{identity.join(' | ')}</NimiText> : null}
                        </div>
                        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center text-[var(--nimi-text-muted)] transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-[var(--nimi-text-primary)] group-focus-visible:text-[var(--nimi-text-primary)]">
                          <ArrowRight size={17} strokeWidth={1.6} />
                        </span>
                      </div>
                      {bio ? <NimiText as="span" role="body" className="mt-2.5 line-clamp-2 min-h-10 w-full text-pretty break-words text-[13px] font-normal leading-5 tracking-[0.01em] text-[var(--nimi-text-secondary)]" title={bio} data-testid="world-person-bio">{bio}</NimiText> : null}
                    </div>
                  </button>
                  {voiceUrl ? (
                    <div className="absolute right-2.5 top-2.5 z-20">
                      <CharacterVoicePreviewButton src={voiceUrl} characterName={character.name} />
                    </div>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      ) : catalog.status === 'partial' ? null : <EmptyState title={t(catalog.query ? 'WorldDetail.discovery.noPeopleMatch' : 'WorldDetail.discovery.noPeople')} />}
      <PeopleCatalogMoreControl catalog={catalog} loadedCount={characters.length} />
    </section>
  );
}

function WorldScenesDiscovery({ scenes }: { scenes: readonly WorldSceneItem[] }) {
  const { t } = useTranslation();
  if (scenes.length === 0) return null;
  return (
    <section id="world-detail-scenes" data-testid="world-detail-scenes" className="space-y-4">
      <div className="flex items-baseline gap-3">
        <NimiText role="section-title">{t('WorldDetail.discovery.places')}</NimiText>
        <NimiText role="caption">{scenes.length} {t('World.atlas.preview.metrics.scenes')}</NimiText>
      </div>
      <div className="grid grid-cols-1 gap-3.5 @min-[640px]:grid-cols-2 @min-[1120px]:grid-cols-4">
        {scenes.map((scene) => (
          <article
            key={scene.id}
            data-testid="world-scene-card"
            className="flex min-w-0 flex-col gap-2 rounded-[14px] border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-panel)_72%,transparent)] p-4"
          >
            <div className="flex items-start gap-2">
              <MapPin size={15} className="mt-0.5 shrink-0 text-[var(--nimi-action-primary-bg)]" aria-hidden />
              <h3 className="min-w-0 break-words text-[15px] font-semibold leading-snug text-[var(--nimi-text-primary)]">{scene.name}</h3>
            </div>
            {scene.description ? (
              <p className="line-clamp-3 text-[13px] leading-relaxed text-[var(--nimi-text-secondary)]">{scene.description}</p>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

// @nimi-authority: rule.nimi.desktop.shell-ui.r011
// @nimi-authority: rule.nimi.desktop.shell-ui.r012
// @nimi-authority: rule.nimi.desktop.shell-ui.r013
export function WorldDetailDiscovery({ props, scenes = [], onViewCharacter, onReadWorld }: {
  props: WorldDetailPageProps;
  scenes?: readonly WorldSceneItem[];
  onReadWorld: () => void;
  onViewCharacter: (character: WorldCharacter) => void;
}) {
  const { t, i18n } = useTranslation();
  const [bannerFailed, setBannerFailed] = useState(false);
  useEffect(() => () => { stopCharacterVoicePreview(); }, []);
  const world = props.world;
  const category = (world.topicIds ?? []).flatMap((topicId) => {
    const topic = props.topics?.find((item) => item.id === topicId);
    return topic ? [i18n.language.startsWith('zh') ? topic.title : topic.titleEn] : [];
  }).join(' · ') || world.genre;
  const summary = worldSummary(world);
  const summaryLead = summary ? worldSummaryLead(summary) : null;
  const settings = worldReadingEntries(world, props.semantic, props.history).filter((entry) => entry.section !== 'description');
  const rawTimeLabel = worldTimeDisplay(world.time, formatLocaleDateTime)?.trim() || null;
  const timeLabel = rawTimeLabel && rawTimeLabel !== '进入时刻' ? rawTimeLabel : null;
  const metaLine = timeLabel || world.era?.trim() || null;
  const heroCaption = [world.motto, world.tagline]
    .map((value) => value?.trim() ?? '')
    .find((value) => value && value !== summary.trim()) || null;
  const showBanner = Boolean((world.bannerMedia || world.bannerUrl) && !bannerFailed);
  const illustrations = worldIllustrations(props.publicAssets);
  // Some worlds publish their setting as structured systems instead of prose.
  // Preview those supplied descriptions without repeating the hero overview.
  const systemDescriptions = props.semantic.powerSystems
    .map((system) => system.description?.trim())
    .filter((description) => description && description !== summaryLead)
    .join('\n\n');
  const expandedSummary = summary !== summaryLead ? summary : '';
  const story = world.setting?.trim() || expandedSummary || systemDescriptions || summary;
  const hasReading = Boolean(story || settings.length);
  const showExcerpt = Boolean(world.setting?.trim() || story !== summaryLead);
  const peopleTotal = props.peopleCatalog.status === 'ready'
    ? props.peopleCatalog.totalCount
    : world.characterCount + (world.personaCharacterCount ?? 0);
  const sceneTotal = scenes.length || (world.sceneCount ?? 0);
  const followButton = props.onFollowWorld ? <IconButton tone="secondary" size="sm" className={showBanner ? 'absolute top-3 right-3 z-10 rounded-full' : 'rounded-full'} icon={props.worldFollowed ? <Bookmark size={16} fill="currentColor" className="text-[var(--nimi-action-primary-bg)]" /> : <Bookmark size={16} />} aria-pressed={Boolean(props.worldFollowed)} aria-label={t(props.worldFollowed ? 'WorldDetail.discovery.followed' : 'WorldDetail.discovery.follow')} onClick={() => props.onFollowWorld?.(world)} data-testid="world-detail-follow-world" /> : null;
  return (
    <main className="world-detail-content @container mx-auto w-full max-w-[1440px] space-y-10 p-6 @min-[1120px]:px-10" data-nimi-density="regular" data-testid="world-detail-discovery">
      <section data-testid="world-detail-overview" className={showBanner ? 'grid items-center gap-6 @min-[1120px]:grid-cols-[minmax(0,3fr)_minmax(0,7fr)] @min-[1120px]:gap-10' : 'max-w-[720px]'}>
        <div className="order-2 space-y-4 @min-[1120px]:order-1" data-nimi-density="expressive">
          {category ? <NimiText role="overline" className="tracking-[0.24em]" data-testid="world-detail-category">{category}</NimiText> : null}
          <NimiText role="hero-title" className="world-detail-title" title={world.name}>{worldTitlePhrases(world.name).map((phrase, index) => <span key={index} className="world-title-phrase">{phrase}</span>)}</NimiText>
          {metaLine ? <NimiText role="caption" className="line-clamp-1 text-[var(--nimi-text-secondary)]" data-testid="world-detail-meta-line">{metaLine}</NimiText> : null}
          {summaryLead ? <NimiText role="body" className="whitespace-pre-wrap break-words" data-testid="world-detail-summary">{summaryLead}</NimiText> : null}
          {peopleTotal > 0 || sceneTotal > 0 ? (
            <div className="flex flex-wrap items-center gap-4 pt-1 text-xs font-medium text-[var(--nimi-text-secondary)]" data-testid="world-detail-stats">
              {peopleTotal > 0 ? <span className="inline-flex items-center gap-1.5"><UsersRound size={14} aria-hidden />{t('WorldDetail.discovery.peopleCount', { count: peopleTotal })}</span> : null}
              {sceneTotal > 0 ? <span className="inline-flex items-center gap-1.5"><MapPin size={14} aria-hidden />{sceneTotal} {t('World.atlas.preview.metrics.scenes')}</span> : null}
            </div>
          ) : null}
          {hasReading ? (
            <div className="flex flex-wrap items-center gap-2.5 pt-1">
              <Button tone="secondary" size="sm" leadingIcon={<BookOpen size={15} />} onClick={onReadWorld} data-testid="world-detail-hero-read">
                {t('WorldDetail.discovery.readWorld')}
              </Button>
              {!showBanner && props.onFollowWorld ? followButton : null}
            </div>
          ) : !showBanner && props.onFollowWorld ? (
            <div className="flex flex-wrap items-center justify-end gap-2.5 pt-2">{followButton}</div>
          ) : null}
        </div>
        {showBanner ? (
          <div className="relative order-1 overflow-hidden rounded-[14px] bg-[color-mix(in_srgb,var(--nimi-surface-panel)_88%,var(--nimi-action-primary-bg)_12%)] @min-[1120px]:order-2" data-testid="world-detail-banner-frame">
            <MediaImage delivery={world.bannerMedia} externalUrl={world.bannerUrl} purpose="hero" sizes="auto, 960px" loading="eager" fetchPriority="high" alt="" className="block h-auto w-full rounded-[14px]" onUnavailable={() => setBannerFailed(true)} data-testid="world-detail-banner" />
            {followButton}
            {heroCaption ? (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-end bg-gradient-to-t from-black/65 via-black/25 to-transparent px-4 pb-3 pt-10">
                <NimiText as="span" role="caption" className="line-clamp-1 max-w-[75%] text-right text-white [text-shadow:0_1px_8px_rgba(0,0,0,0.65)]" title={heroCaption}>{heroCaption}</NimiText>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
      <WorldPeopleGallery characters={props.peopleCharacters} catalog={props.peopleCatalog} loading={props.charactersLoading} onView={onViewCharacter} />
      <WorldDetailStory key={world.id} worldName={world.name} story={story} showExcerpt={showExcerpt} hasReading={hasReading} illustrations={illustrations} onReadWorld={onReadWorld} />
      <WorldScenesDiscovery scenes={scenes} />
      {props.readingIncomplete ? <EmptyState title={t('WorldDetail.discovery.readingIncomplete')} action={props.onRetryReading ? <Button tone="secondary" size="sm" onClick={props.onRetryReading}>{t('WorldDetail.paper.gallery.retry')}</Button> : undefined} /> : null}
      {props.semanticLoading ? <LoadingSkeleton lines={2} label={t('WorldDetail.loading')} /> : null}
      {props.publicAssetsIncomplete ? <EmptyState title={t('WorldDetail.discovery.placesIncomplete')} action={props.onRetryReading ? <Button tone="secondary" size="sm" onClick={props.onRetryReading}>{t('WorldDetail.paper.gallery.retry')}</Button> : undefined} /> : null}
    </main>
  );
}
