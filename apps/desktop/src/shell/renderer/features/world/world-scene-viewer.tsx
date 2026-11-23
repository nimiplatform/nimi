import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ArrowRight, MapPin, X } from 'lucide-react';
import { MediaImage } from '@nimiplatform/kit/features/media';
import { Button, IconButton, NimiText, OverlayShell, ScrollArea } from '@nimiplatform/kit/ui';
import { EntityAvatar } from '../../components/entity-avatar.js';
import type { WorldCharacter, WorldPublicMediaAsset, WorldSceneItem } from './world-detail-types.js';

function isInternalSlugTitle(value: string): boolean {
  return /^[a-z0-9]+(?:[-_:][a-z0-9]+)+$/i.test(value);
}

function isEditableEventTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
}

function sceneMediaAssetKeys(asset: WorldPublicMediaAsset): string[] {
  return [
    asset.delivery?.resourceId?.trim() ?? '',
    asset.id.trim(),
    asset.externalUrl?.trim() ?? '',
  ].filter(Boolean);
}

export function selectDistinctSceneImageMedia(
  scene: WorldSceneItem,
  scenes: readonly WorldSceneItem[],
  sharedMediaKeys?: ReadonlySet<string>,
): WorldPublicMediaAsset[] {
  const keySceneCounts = new Map<string, number>();
  for (const item of scenes) {
    const keysInScene = new Set<string>();
    for (const asset of item.media) {
      if (asset.mimeType && !asset.mimeType.startsWith('image/')) continue;
      if (!asset.delivery && !asset.externalUrl) continue;
      for (const key of sceneMediaAssetKeys(asset)) keysInScene.add(key);
    }
    for (const key of keysInScene) {
      keySceneCounts.set(key, (keySceneCounts.get(key) ?? 0) + 1);
    }
  }

  return scene.media.filter((asset) => {
    if (asset.mimeType && !asset.mimeType.startsWith('image/')) return false;
    if (!asset.delivery && !asset.externalUrl) return false;
    const keys = sceneMediaAssetKeys(asset);
    if (keys.length === 0) return false;
    // Skip world-level banner/highlight imagery or fallback artwork repeated across scenes.
    if (sharedMediaKeys && keys.some((key) => sharedMediaKeys.has(key))) return false;
    if (scenes.length > 1 && keys.some((key) => (keySceneCounts.get(key) ?? 0) > 1)) return false;
    return true;
  });
}

// @nimi-authority: rule.nimi.desktop.shell-ui.r012
// @nimi-authority: rule.nimi.desktop.shell-ui.r013
// @nimi-authority: rule.nimi.desktop.shell-ui.r014
export function WorldSceneViewer({
  open,
  scene,
  scenes,
  sharedMediaKeys,
  onSelect,
  onClose,
  onViewCharacter,
}: {
  open: boolean;
  scene: WorldSceneItem;
  scenes: readonly WorldSceneItem[];
  sharedMediaKeys?: ReadonlySet<string>;
  onSelect: (id: string) => void;
  onClose: () => void;
  onViewCharacter?: (character: WorldCharacter) => void;
}) {
  const { t } = useTranslation();
  const scrollViewportRef = useRef<HTMLDivElement | null>(null);
  const [unavailableMedia, setUnavailableMedia] = useState<Set<string>>(() => new Set());

  const index = scenes.findIndex((item) => item.id === scene.id);
  const hasPrevious = index > 0;
  const hasNext = index >= 0 && index < scenes.length - 1;

  useEffect(() => {
    if (open && scrollViewportRef.current) {
      scrollViewportRef.current.scrollTop = 0;
    }
  }, [open, scene.id]);

  useEffect(() => {
    if (!open || scenes.length <= 1) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (isEditableEventTarget(event.target)) return;
      if (event.key === 'ArrowLeft' && hasPrevious) {
        event.preventDefault();
        onSelect(scenes[index - 1]!.id);
      } else if (event.key === 'ArrowRight' && hasNext) {
        event.preventDefault();
        onSelect(scenes[index + 1]!.id);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, scenes, index, hasPrevious, hasNext, onSelect]);

  const description = scene.description.trim();
  const imageMedia = selectDistinctSceneImageMedia(scene, scenes, sharedMediaKeys)
    .filter((asset) => !unavailableMedia.has(asset.id));
  const relatedCharacterIds = new Set(scene.relatedCharacters.map((character) => character.id));
  const relatedCharacterNames = new Set(
    scene.relatedCharacters.map((character) => character.name.trim().toLocaleLowerCase()).filter(Boolean),
  );
  const entities = scene.activeEntities.filter((entity) => {
    const label = entity.label?.trim() ?? '';
    const summary = entity.summary?.trim() ?? '';
    if (!label && !summary) return false;
    if (relatedCharacterIds.has(entity.id)) return false;
    if (label && relatedCharacterNames.has(label.toLocaleLowerCase())) return false;
    return true;
  });
  const events = scene.relatedEvents.filter((event) => (
    Boolean(event.title.trim() || event.summary?.trim() || event.description.trim())
  ));
  const eventIds = new Set(events.map((event) => event.id));
  const eventTitles = new Set(
    events.map((event) => event.title.trim().toLocaleLowerCase()).filter(Boolean),
  );
  const eventBodies = new Set(
    events.flatMap((event) => [event.summary?.trim() ?? '', event.description.trim()]).filter(Boolean),
  );
  const resources = scene.relatedResources
    .map((resource) => {
      const rawTitle = resource.title.trim();
      const summary = resource.summary?.trim() ?? '';
      const displayTitle = summary && isInternalSlugTitle(rawTitle) ? '' : rawTitle;
      return { resource, rawTitle, displayTitle, summary };
    })
    .filter(({ resource, rawTitle, displayTitle, summary }) => {
      if (!displayTitle && !summary) return false;
      const matchesEvent = eventIds.has(resource.id)
        || resource.eventRefs.some((ref) => eventIds.has(ref))
        || (rawTitle !== '' && eventTitles.has(rawTitle.toLocaleLowerCase()));
      if (matchesEvent && (!summary || eventBodies.has(summary))) return false;
      const matchesCharacter = relatedCharacterIds.has(resource.id)
        || resource.entityRefs.some((ref) => relatedCharacterIds.has(ref))
        || (rawTitle !== '' && relatedCharacterNames.has(rawTitle.toLocaleLowerCase()));
      if (matchesCharacter && !summary) return false;
      return true;
    });
  const hasAnyContent = Boolean(
    description
    || imageMedia.length
    || scene.relatedCharacters.length
    || entities.length
    || events.length
    || resources.length,
  );

  const hideMedia = (id: string) => {
    setUnavailableMedia((previous) => {
      if (previous.has(id)) return previous;
      const next = new Set(previous);
      next.add(id);
      return next;
    });
  };

  return (
    <OverlayShell
      open={open}
      kind="dialog"
      size="md"
      onClose={onClose}
      data-testid="world-scene-viewer"
      panelStyle={{ maxWidth: 'min(640px, calc(100vw - 32px))', maxHeight: 'min(82dvh, 760px)' }}
      panelClassName="flex flex-col overflow-hidden"
      contentClassName="flex min-h-0 flex-1 flex-col px-0 py-0"
      title={(
        <div className="flex min-w-0 items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <NimiText as="span" role="overline" className="block tracking-[0.2em] text-[var(--nimi-text-muted)]">
              {t('WorldDetail.discovery.places')}
            </NimiText>
            <div className="mt-1.5 flex items-start gap-2">
              <MapPin size={18} className="mt-1 shrink-0 text-[var(--nimi-action-primary-bg)]" aria-hidden />
              <NimiText as="span" role="section-title" className="min-w-0 flex-1 break-words text-[var(--nimi-text-primary)]">
                {scene.name}
              </NimiText>
            </div>
          </div>
          <IconButton
            tone="ghost"
            size="sm"
            icon={<X size={18} />}
            aria-label={t('WorldDetail.discovery.closeScene')}
            data-testid="world-scene-close"
            onClick={onClose}
          />
        </div>
      )}
      footer={scenes.length > 1 ? (
        <div className="flex items-center justify-between gap-3 border-t border-[var(--nimi-border-subtle)] pt-3">
          <Button
            tone="secondary"
            size="sm"
            leadingIcon={<ArrowLeft size={16} />}
            disabled={!hasPrevious}
            data-testid="world-scene-prev"
            onClick={() => { if (hasPrevious) onSelect(scenes[index - 1]!.id); }}
          >
            {t('WorldDetail.discovery.previousScene')}
          </Button>
          <NimiText as="span" role="caption" className="tabular-nums" aria-live="polite" data-testid="world-scene-counter">
            {index >= 0 ? `${index + 1} / ${scenes.length}` : ''}
          </NimiText>
          <Button
            tone="secondary"
            size="sm"
            trailingIcon={<ArrowRight size={16} />}
            disabled={!hasNext}
            data-testid="world-scene-next"
            onClick={() => { if (hasNext) onSelect(scenes[index + 1]!.id); }}
          >
            {t('WorldDetail.discovery.nextScene')}
          </Button>
        </div>
      ) : undefined}
    >
      <ScrollArea
        className="flex min-h-0 flex-1 flex-col"
        viewportClassName="min-h-0 flex-1"
        viewportRef={scrollViewportRef}
        contentClassName="space-y-5 px-6 pt-2 pb-6"
      >
        {imageMedia.length > 0 ? (
          <div
            data-testid="world-scene-media"
            className={imageMedia.length === 1 ? 'space-y-3' : 'grid grid-cols-1 gap-3 sm:grid-cols-2'}
          >
            {imageMedia.map((asset) => (
              <div
                key={asset.id}
                className="overflow-hidden rounded-[12px] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)]"
              >
                <MediaImage
                  delivery={asset.delivery}
                  externalUrl={asset.externalUrl}
                  purpose="detail"
                  sizes={imageMedia.length === 1 ? '592px' : '(min-width: 640px) 290px, calc(100vw - 80px)'}
                  loading="eager"
                  alt={scene.name}
                  className={imageMedia.length === 1 ? 'block max-h-72 w-full object-cover' : 'block max-h-52 w-full object-cover'}
                  onUnavailable={() => hideMedia(asset.id)}
                />
              </div>
            ))}
          </div>
        ) : null}

        {description ? (
          <NimiText
            as="p"
            role="body"
            data-testid="world-scene-description"
            className="whitespace-pre-wrap break-words text-[15px] leading-[1.8] text-[var(--nimi-text-primary)]"
          >
            {description}
          </NimiText>
        ) : !hasAnyContent ? (
          <NimiText as="p" role="body" className="text-[var(--nimi-text-muted)]">
            {t('WorldDetail.noDescription')}
          </NimiText>
        ) : null}

        {scene.relatedCharacters.length > 0 ? (
          <section className="space-y-2.5" data-testid="world-scene-people">
            <NimiText as="h3" role="label" className="text-[var(--nimi-text-secondary)]">
              {t('WorldDetail.discovery.scenePeople')}
            </NimiText>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {scene.relatedCharacters.map((character) => {
                const subtitle = [character.role?.trim(), character.faction?.trim()].filter(Boolean).join(' · ');
                const body = (
                  <>
                    <EntityAvatar
                      imageUrl={character.avatarUrl}
                      media={character.avatarMedia}
                      name={character.name}
                      kind="source"
                      sizeClassName="h-9 w-9 shrink-0"
                      radiusClassName="rounded-[10px]"
                      innerRadiusClassName="rounded-[8px]"
                      textClassName="text-sm"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-[var(--nimi-text-primary)]">{character.name}</span>
                      {subtitle ? (
                        <span className="block truncate text-xs text-[var(--nimi-text-secondary)]">{subtitle}</span>
                      ) : null}
                    </span>
                    {onViewCharacter ? (
                      <ArrowRight size={14} className="shrink-0 text-[var(--nimi-text-muted)] transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-[var(--nimi-action-primary-bg)] motion-reduce:transition-none" aria-hidden />
                    ) : null}
                  </>
                );
                if (!onViewCharacter) {
                  return (
                    <div
                      key={`${character.sourceRef.kind}:${character.id}`}
                      className="flex min-w-0 items-center gap-2.5 rounded-[12px] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] px-3 py-2"
                    >
                      {body}
                    </div>
                  );
                }
                return (
                  <button
                    key={`${character.sourceRef.kind}:${character.id}`}
                    type="button"
                    onClick={() => {
                      onClose();
                      onViewCharacter(character);
                    }}
                    className="group flex min-w-0 cursor-pointer items-center gap-2.5 rounded-[12px] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] px-3 py-2 text-left transition-colors duration-200 hover:border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_42%,var(--nimi-border-subtle))] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
                  >
                    {body}
                  </button>
                );
              })}
            </div>
          </section>
        ) : null}

        {entities.length > 0 ? (
          <section className="space-y-2.5" data-testid="world-scene-entities">
            <NimiText as="h3" role="label" className="text-[var(--nimi-text-secondary)]">
              {t('WorldDetail.discovery.sceneEntities')}
            </NimiText>
            <ul className="space-y-2">
              {entities.map((entity) => (
                <li
                  key={entity.id}
                  className="rounded-[12px] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] px-3.5 py-2.5"
                >
                  {entity.label?.trim() ? (
                    <div className="text-sm font-medium text-[var(--nimi-text-primary)]">{entity.label.trim()}</div>
                  ) : null}
                  {entity.summary?.trim() ? (
                    <p className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-[var(--nimi-text-secondary)]">
                      {entity.summary.trim()}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {events.length > 0 ? (
          <section className="space-y-2.5" data-testid="world-scene-events">
            <NimiText as="h3" role="label" className="text-[var(--nimi-text-secondary)]">
              {t('WorldDetail.discovery.sceneEvents')}
            </NimiText>
            <ul className="space-y-2.5">
              {events.map((event) => {
                const detailParagraphs = [event.summary?.trim(), event.description.trim()]
                  .filter((value, paragraphIndex, list): value is string => Boolean(value) && list.indexOf(value) === paragraphIndex);
                return (
                  <li
                    key={event.id}
                    className="rounded-[12px] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] px-3.5 py-3"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      {event.title.trim() ? (
                        <span className="text-sm font-medium text-[var(--nimi-text-primary)]">{event.title.trim()}</span>
                      ) : null}
                      {event.time.trim() ? (
                        <NimiText as="span" role="caption">{event.time.trim()}</NimiText>
                      ) : null}
                    </div>
                    {detailParagraphs.map((text, paragraphIndex) => (
                      <p
                        key={paragraphIndex}
                        className="mt-1.5 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-[var(--nimi-text-secondary)]"
                      >
                        {text}
                      </p>
                    ))}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {resources.length > 0 ? (
          <section className="space-y-2.5" data-testid="world-scene-resources">
            <NimiText as="h3" role="label" className="text-[var(--nimi-text-secondary)]">
              {t('WorldDetail.discovery.sceneResources')}
            </NimiText>
            <ul className="space-y-2">
              {resources.map(({ resource, displayTitle, summary }) => (
                <li
                  key={resource.id}
                  className="rounded-[12px] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] px-3.5 py-2.5"
                >
                  {displayTitle ? (
                    <div className="text-sm font-medium text-[var(--nimi-text-primary)]">{displayTitle}</div>
                  ) : null}
                  {summary ? (
                    <p className={`${displayTitle ? 'mt-1 ' : ''}whitespace-pre-wrap break-words text-[13px] leading-relaxed text-[var(--nimi-text-secondary)]`}>
                      {summary}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </ScrollArea>
    </OverlayShell>
  );
}
