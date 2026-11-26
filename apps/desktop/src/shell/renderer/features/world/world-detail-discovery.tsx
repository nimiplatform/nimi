import { MediaImage } from '@nimiplatform/kit/features/media';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Bookmark, BookOpen, MapPin, UsersRound } from 'lucide-react';
import { Button, EmptyState, IconButton, LoadingSkeleton, NimiText, SearchField, Tooltip } from '@nimiplatform/kit/ui';
import type { WorldDetailPageProps } from './world-detail-template.js';
import type { WorldCharacter, WorldPeopleCatalogState, WorldSceneItem } from './world-detail-types.js';
import { PeopleCatalogFirstPageStatus, PeopleCatalogMoreControl } from './world-detail-people-catalog-status.js';
import { worldSummary, worldSummaryLead } from './world-detail-template-model.js';
import { worldReadingEntries } from './world-detail-reading-model.js';
import { WorldDetailStory } from './world-detail-story.js';
import { WorldSceneViewer, selectDistinctSceneImageMedia } from './world-scene-viewer.js';
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
            const hasPortrait = Boolean(character.portraitUrl || character.mediaAssets?.portrait?.externalUrl || character.mediaAssets?.portrait?.delivery);
            const image = hasPortrait
              ? (character.portraitUrl || character.mediaAssets?.portrait?.externalUrl || null)
              : (character.avatarUrl || character.mediaAssets?.avatar?.externalUrl || null);
            const delivery = hasPortrait
              ? (character.mediaAssets?.portrait?.delivery ?? null)
              : (character.avatarMedia ?? null);
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
                    <div className="aspect-[3/4] w-full overflow-hidden rounded-[12px] bg-[color-mix(in_srgb,var(--nimi-surface-panel)_88%,var(--nimi-action-primary-bg)_12%)]">
                      <MediaImage delivery={delivery} externalUrl={image} purpose={imagePurpose} sizes="auto, 220px" alt={character.name} className={`block h-full w-full object-cover text-2xl transition-transform duration-300 group-hover:scale-[1.03] motion-reduce:transform-none motion-reduce:transition-none ${hasPortrait ? 'object-top' : 'object-[center_20%]'}`} />
                    </div>
                    <div className="relative z-10 -mt-2 w-full rounded-[12px] bg-[color-mix(in_srgb,var(--nimi-surface-panel)_97%,transparent)] p-3.5 transition-colors duration-200 group-hover:bg-[var(--nimi-surface-panel)]">
                      <div className="flex w-full items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <NimiText as="span" role="card-title" className="line-clamp-1 break-words text-[17px] font-semibold leading-6 tracking-normal" title={character.name}>{character.name}</NimiText>
                          {identity.length ? <NimiText as="span" role="caption" className="mt-1 line-clamp-1 w-full break-words font-normal leading-5 tracking-[0.01em] text-[var(--nimi-text-secondary)]" title={identity.join(' | ')} data-testid="world-person-meta">{identity.join(' | ')}</NimiText> : null}
                        </div>
                        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center text-[var(--nimi-text-muted)] transition-[transform,color] duration-200 group-hover:translate-x-0.5 group-hover:text-[var(--nimi-text-primary)] group-focus-visible:text-[var(--nimi-text-primary)] motion-reduce:transform-none motion-reduce:transition-none">
                          <ArrowRight size={17} strokeWidth={1.6} />
                        </span>
                      </div>
                      {bio ? <NimiText as="span" role="body" className="mt-2.5 line-clamp-2 min-h-10 w-full text-pretty break-words text-[13px] font-normal leading-5 tracking-[0.01em] text-[var(--nimi-text-secondary)]" title={bio} data-testid="world-person-bio">{bio}</NimiText> : null}
                    </div>
                  </button>
                  {voiceUrl ? (
                    <div className="absolute right-2.5 top-2.5 z-20">
                      <CharacterVoicePreviewButton src={voiceUrl} characterName={character.name} iconOnly />
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

function WorldScenesDiscovery({ worldId, scenes, sharedMediaKeys, onViewCharacter }: {
  worldId: string;
  scenes: readonly WorldSceneItem[];
  sharedMediaKeys?: ReadonlySet<string>;
  onViewCharacter: (character: WorldCharacter) => void;
}) {
  const { t } = useTranslation();
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [failedCardMediaIds, setFailedCardMediaIds] = useState<Set<string>>(() => new Set());
  if (scenes.length === 0) return null;
  const activeScene = (selectedSceneId ? scenes.find((item) => item.id === selectedSceneId) : null) ?? scenes[0] ?? null;
  const openScene = (id: string) => {
    setSelectedSceneId(id);
    setViewerOpen(true);
  };
  const markCardMediaUnavailable = (assetId: string) => {
    setFailedCardMediaIds((previous) => {
      if (previous.has(assetId)) return previous;
      const next = new Set(previous);
      next.add(assetId);
      return next;
    });
  };
  const scenePrimaryMedia = scenes.map((scene) => (
    selectDistinctSceneImageMedia(scene, scenes, sharedMediaKeys)
      .find((asset) => !failedCardMediaIds.has(asset.id)) ?? null
  ));
  const hasIllustratedScenes = scenePrimaryMedia.some(Boolean);
  return (
    <section id="world-detail-scenes" data-testid="world-detail-scenes" className="space-y-4">
      <div className="flex items-baseline gap-3">
        <NimiText role="section-title">{t('WorldDetail.discovery.places')}</NimiText>
        <NimiText role="caption">{scenes.length} {t('World.atlas.preview.metrics.scenes')}</NimiText>
      </div>
      <div className={hasIllustratedScenes
        ? 'grid grid-cols-1 gap-4 @min-[640px]:grid-cols-2 @min-[1120px]:grid-cols-3'
        : 'grid grid-cols-1 gap-3.5 @min-[640px]:grid-cols-2 @min-[1120px]:grid-cols-4'}
      >
        {scenes.map((scene, sceneIndex) => {
          const primaryVisual = scenePrimaryMedia[sceneIndex] ?? null;
          const imagePurpose = primaryVisual?.delivery?.images.some((set) => set.purpose === 'detail')
            ? 'detail'
            : primaryVisual?.delivery?.images.some((set) => set.purpose === 'hero')
              ? 'hero'
              : 'card';
          const settingLabel = scene.spatial?.settingType
            ? t(`WorldDetail.discovery.sceneSettingType.${scene.spatial.settingType}`)
            : null;
          return (
            <button
              key={scene.id}
              type="button"
              data-testid="world-scene-card"
              aria-haspopup="dialog"
              aria-label={t('WorldDetail.discovery.openNamedScene', { name: scene.name })}
              onClick={() => openScene(scene.id)}
              className="group flex min-w-0 cursor-pointer flex-col overflow-hidden rounded-[14px] border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-panel)_72%,transparent)] text-left transition-colors duration-200 hover:border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_42%,var(--nimi-border-subtle))] hover:bg-[var(--nimi-surface-panel)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
            >
              {primaryVisual ? (
                <div
                  data-testid="world-scene-card-media"
                  className="aspect-[3/2] w-full overflow-hidden bg-[color-mix(in_srgb,var(--nimi-surface-panel)_88%,var(--nimi-action-primary-bg)_12%)]"
                >
                  <MediaImage
                    delivery={primaryVisual.delivery}
                    externalUrl={primaryVisual.externalUrl}
                    purpose={imagePurpose}
                    sizes="(min-width: 1120px) 440px, (min-width: 640px) 46vw, 94vw"
                    alt={scene.name}
                    className="block h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03] motion-reduce:transform-none motion-reduce:transition-none"
                    onUnavailable={() => markCardMediaUnavailable(primaryVisual.id)}
                  />
                </div>
              ) : null}
              <div className="flex flex-1 flex-col gap-2.5 p-4">
                <div className="flex w-full items-start gap-2">
                  <MapPin size={15} className="mt-0.5 shrink-0 text-[var(--nimi-action-primary-bg)]" aria-hidden />
                  <span className="min-w-0 flex-1 break-words text-[15px] font-semibold leading-snug text-[var(--nimi-text-primary)]">{scene.name}</span>
                </div>
                {scene.description ? (
                  <p className={primaryVisual ? 'line-clamp-2 text-[13px] leading-relaxed text-[var(--nimi-text-secondary)]' : 'line-clamp-3 text-[13px] leading-relaxed text-[var(--nimi-text-secondary)]'}>
                    {scene.description}
                  </p>
                ) : null}
                <div className="mt-auto flex w-full items-center justify-between gap-2 pt-1">
                  <div className="flex min-w-0 items-center gap-2 truncate">
                    {settingLabel ? (
                      <NimiText as="span" role="caption" className="shrink-0">
                        {settingLabel}
                      </NimiText>
                    ) : null}
                    {scene.relatedCharacters.length > 0 ? (
                      <NimiText as="span" role="caption" className="truncate">
                        {t('WorldDetail.discovery.peopleCount', { count: scene.relatedCharacters.length })}
                      </NimiText>
                    ) : null}
                  </div>
                  <span className="inline-flex shrink-0 items-center gap-1 text-[12px] font-medium text-[var(--nimi-text-secondary)] transition-colors duration-200 group-hover:text-[var(--nimi-action-primary-bg)] group-focus-visible:text-[var(--nimi-action-primary-bg)]">
                    {t('WorldDetail.discovery.viewScene')}
                    <ArrowRight size={13} strokeWidth={1.8} className="transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transform-none motion-reduce:transition-none" aria-hidden />
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
      {activeScene ? (
        <WorldSceneViewer
          open={viewerOpen}
          worldId={worldId}
          scene={activeScene}
          scenes={scenes}
          sharedMediaKeys={sharedMediaKeys}
          onSelect={setSelectedSceneId}
          onClose={() => setViewerOpen(false)}
          onViewCharacter={onViewCharacter}
        />
      ) : null}
    </section>
  );
}

function WorldFollowButton({
  followed,
  overlay,
  onToggle,
}: {
  followed: boolean;
  overlay: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const prevFollowedRef = useRef(followed);
  const [motionState, setMotionState] = useState<'idle' | 'collect' | 'uncollect'>('idle');

  useEffect(() => {
    if (prevFollowedRef.current === followed) return;
    prevFollowedRef.current = followed;
    setMotionState(followed ? 'collect' : 'uncollect');
    const timer = window.setTimeout(() => setMotionState('idle'), 420);
    return () => window.clearTimeout(timer);
  }, [followed]);

  const label = t(followed ? 'WorldDetail.discovery.followed' : 'WorldDetail.discovery.follow');
  const overlayGlassClass = overlay
    ? 'world-hero-bookmark--overlay nimi-material-glass-thin backdrop-blur-[var(--nimi-backdrop-blur-thin)] backdrop-saturate-[var(--nimi-backdrop-saturate)] absolute top-3 right-3 z-10 h-9 w-9 min-h-9'
    : 'world-hero-bookmark--surface relative h-[38px] w-[38px] min-h-[38px]';

  return (
    <Tooltip content={label} placement={overlay ? 'left' : 'top'}>
      <IconButton
        tone="secondary"
        size="sm"
        className={`world-hero-bookmark rounded-full active:scale-[0.92] motion-reduce:transform-none ${overlayGlassClass}`}
        icon={<Bookmark size={17} strokeWidth={1.85} fill="currentColor" className="world-hero-bookmark__icon" aria-hidden />}
        aria-pressed={followed}
        aria-label={label}
        data-nimi-material={overlay ? 'glass-thin' : undefined}
        data-followed={followed ? 'true' : 'false'}
        data-bookmark-motion={motionState}
        onClick={onToggle}
        data-testid="world-detail-follow-world"
      />
    </Tooltip>
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
  const sharedSceneMediaKeys = new Set<string>(
    [
      world.bannerMedia?.resourceId,
      world.bannerUrl,
      world.iconMedia?.resourceId,
      world.iconUrl,
      ...(props.publicAssets.mediaAssets ?? [])
        .filter((asset) => asset.kind === 'hero' || asset.kind === 'highlight' || asset.kind === 'icon')
        .flatMap((asset) => [asset.id, asset.delivery?.resourceId, asset.externalUrl]),
      ...illustrations.flatMap((item) => [item.id, item.delivery?.resourceId, item.url]),
    ]
      .map((value) => value?.trim() ?? '')
      .filter(Boolean),
  );
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
  const followButton = props.onFollowWorld ? (
    <WorldFollowButton
      followed={Boolean(props.worldFollowed)}
      overlay={showBanner}
      onToggle={() => props.onFollowWorld?.(world)}
    />
  ) : null;
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
            <div className="flex flex-wrap items-center gap-2.5 pt-2">
              <Button
                tone="secondary"
                size="sm"
                leadingIcon={<BookOpen size={15} strokeWidth={1.85} className="world-hero-read-cta__book" aria-hidden />}
                trailingIcon={<ArrowRight size={14} strokeWidth={1.9} className="world-hero-read-cta__arrow" aria-hidden />}
                onClick={onReadWorld}
                className="world-hero-read-cta min-h-[38px] rounded-full px-[18px] text-[13.5px] font-medium tracking-[0.01em] active:scale-[0.97] motion-reduce:transform-none"
                data-testid="world-detail-hero-read"
              >
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
      <WorldScenesDiscovery worldId={world.id} scenes={scenes} sharedMediaKeys={sharedSceneMediaKeys} onViewCharacter={onViewCharacter} />
      {props.readingIncomplete ? <EmptyState title={t('WorldDetail.discovery.readingIncomplete')} action={props.onRetryReading ? <Button tone="secondary" size="sm" onClick={props.onRetryReading}>{t('WorldDetail.paper.gallery.retry')}</Button> : undefined} /> : null}
      {props.semanticLoading ? <LoadingSkeleton lines={2} label={t('WorldDetail.loading')} /> : null}
      {props.publicAssetsIncomplete ? <EmptyState title={t('WorldDetail.discovery.placesIncomplete')} action={props.onRetryReading ? <Button tone="secondary" size="sm" onClick={props.onRetryReading}>{t('WorldDetail.paper.gallery.retry')}</Button> : undefined} /> : null}
    </main>
  );
}
