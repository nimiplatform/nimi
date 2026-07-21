import { useTranslation } from 'react-i18next';
import { EntityAvatar } from '../../components/entity-avatar.js';
import { ScrollArea } from '@nimiplatform/kit/ui';
import { joinParts } from './world-detail-primitives.js';
import type { WorldCharacter } from './world-detail-types.js';

export function WorldCharacterQuickSheet({
  character,
  onClose,
  onViewCharacter,
  onMaterializeSource,
}: {
  character: WorldCharacter;
  onClose: () => void;
  onViewCharacter?: (character: WorldCharacter) => void;
  onMaterializeSource?: (character: WorldCharacter) => Promise<void> | void;
}) {
  const { t } = useTranslation();
  const relationState = character.relation?.state ?? 'connectable';
  const connectDisabled = relationState !== 'connectable';
  const connectLabel = relationState === 'connected'
    ? t('WorldDetail.xianxia.v2.characters.sourceMaterialized')
    : relationState === 'unavailable'
      ? t('WorldDetail.xianxia.v2.characters.sourceUnavailable')
      : t('WorldDetail.xianxia.v2.characters.materializeSource');
  const profileCoverUrl = character.profileCoverUrl ?? character.mediaAssets?.profileCover?.url ?? null;
  const referenceImageUrl = character.referenceImageUrl ?? character.mediaAssets?.referenceImage?.url ?? null;
  const voiceSample = character.mediaAssets?.voiceSample ?? null;
  const voiceSampleUrl = character.voiceSampleUrl ?? voiceSample?.url ?? null;
  const voiceDuration = typeof voiceSample?.durationSec === 'number' && Number.isFinite(voiceSample.durationSec)
    ? Math.round(voiceSample.durationSec)
    : null;
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/55 px-5 py-6">
      <button
        type="button"
        className="absolute inset-0"
        aria-label={t('WorldDetail.xianxia.v2.characters.quickSheetClose')}
        onClick={onClose}
      />
      <div className="relative flex items-center justify-center">
        <section className="relative z-10 w-full max-w-[620px] max-h-[calc(100vh-3rem)] overflow-hidden rounded-[28px] border border-[var(--nimi-action-primary-bg)]/20 bg-[#0d1511]/96 shadow-[0_24px_80px_rgba(0,0,0,0.55)]">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--nimi-action-primary-bg)]/50 to-transparent" />
          <ScrollArea className="max-h-[calc(100vh-3rem-2px)]" viewportClassName="px-6 pb-6 pt-5">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <div className="text-xs uppercase tracking-[0.16em] text-[#86f0ca]/76">
                  {t('WorldDetail.xianxia.v2.characters.quickSheetTitle')}
                </div>
                <h3 className="mt-2 text-2xl font-semibold text-[#effff8]">{character.name}</h3>
                <div className="mt-1 text-sm text-[#86f0ca]">{character.handle}</div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-full border border-[var(--nimi-action-primary-bg)]/18 bg-black/18 px-3 py-1.5 text-xs text-[color-mix(in_srgb,var(--nimi-action-primary-bg)_72%,white)]/72 transition-colors hover:border-[var(--nimi-action-primary-bg)]/28 hover:text-[#effff8]"
              >
                {t('WorldDetail.xianxia.v2.characters.quickSheetClose')}
              </button>
            </div>

            {profileCoverUrl ? (
              <div data-testid="world-character-profile-cover" className="mb-5 overflow-hidden rounded-[20px] border border-[var(--nimi-action-primary-bg)]/14 bg-black/22">
                <img
                  src={profileCoverUrl}
                  alt=""
                  className="h-40 w-full object-cover"
                />
              </div>
            ) : null}

            <div className="grid gap-5 md:grid-cols-[120px_minmax(0,1fr)]">
              <div className="flex justify-center md:justify-start">
                <EntityAvatar
                  imageUrl={character.avatarUrl}
                  name={character.name}
                  kind="source"
                  sizeClassName="h-28 w-28"
                  radiusClassName="rounded-[20px]"
                  innerRadiusClassName="rounded-[16px]"
                  textClassName="text-3xl font-serif"
                />
              </div>

              <div className="grid gap-3">
                {joinParts([character.role, character.faction, character.rank]) ? (
                  <div className="rounded-2xl border border-[var(--nimi-action-primary-bg)]/10 bg-[black]/56 p-4">
                    <div className="text-[11px] uppercase tracking-[0.14em] text-[#86f0ca]/74">
                      {t('WorldDetail.xianxia.v2.characters.quickSheetIdentity')}
                    </div>
                    <div className="mt-2 text-sm leading-relaxed text-[#effff8]">
                      {joinParts([character.role, character.faction, character.rank])}
                    </div>
                  </div>
                ) : null}

                {joinParts([character.sceneName, character.location]) ? (
                  <div className="rounded-2xl border border-[var(--nimi-action-primary-bg)]/10 bg-[black]/56 p-4">
                    <div className="text-[11px] uppercase tracking-[0.14em] text-[#86f0ca]/74">
                      {t('WorldDetail.xianxia.v2.characters.quickSheetLocation')}
                    </div>
                    <div className="mt-2 text-sm leading-relaxed text-[#effff8]">
                      {joinParts([character.sceneName, character.location])}
                    </div>
                  </div>
                ) : null}

                <div className="rounded-2xl border border-[var(--nimi-action-primary-bg)]/10 bg-[black]/56 p-4">
                  <div className="text-[11px] uppercase tracking-[0.14em] text-[#86f0ca]/74">
                    {t('WorldDetail.xianxia.v2.characters.quickSheetBio')}
                  </div>
                  <div className="mt-2 text-sm leading-relaxed text-[color-mix(in_srgb,var(--nimi-action-primary-bg)_72%,white)]/72">
                    {character.bio || t('WorldDetail.noDescription')}
                  </div>
                </div>

                {character.stats?.vitalityScore != null ? (
                  <div className="rounded-2xl border border-[var(--nimi-action-primary-bg)]/10 bg-black/16 px-4 py-3 text-sm text-[color-mix(in_srgb,var(--nimi-action-primary-bg)_72%,white)]/72">
                    {t('WorldDetail.xianxia.v2.characters.vitality')} {character.stats.vitalityScore}
                  </div>
                ) : null}

                {referenceImageUrl ? (
                  <div data-testid="world-character-reference-image" className="overflow-hidden rounded-2xl border border-[var(--nimi-action-primary-bg)]/10 bg-[black]/56">
                    <img
                      src={referenceImageUrl}
                      alt=""
                      className="max-h-72 w-full object-cover"
                    />
                  </div>
                ) : null}

                {voiceSampleUrl ? (
                  <div data-testid="world-character-voice-sample" className="rounded-2xl border border-[var(--nimi-action-primary-bg)]/10 bg-[black]/56 p-4">
                    <div className="text-[11px] uppercase tracking-[0.14em] text-[#86f0ca]/74">
                      {t('WorldDetail.xianxia.v2.characters.voiceSample', { defaultValue: 'Voice sample' })}
                    </div>
                    <div className="mt-2 text-xs text-[color-mix(in_srgb,var(--nimi-action-primary-bg)_72%,white)]/72">
                      {voiceSample?.mimeType ?? t('WorldDetail.xianxia.v2.characters.voiceReady', { defaultValue: 'Ready audio resource' })}
                      {voiceDuration ? ` · ${voiceDuration}s` : ''}
                    </div>
                    <audio
                      data-testid="world-character-voice-sample-audio"
                      className="mt-3 w-full"
                      controls
                      preload="metadata"
                      src={voiceSampleUrl}
                    />
                  </div>
                ) : null}
              </div>
            </div>

            {onViewCharacter ? (
              <div className="mt-5 flex flex-wrap gap-2">
                {onMaterializeSource ? (
                  <button
                    type="button"
                    onClick={() => void onMaterializeSource(character)}
                    disabled={connectDisabled}
                    className="rounded-full border border-[var(--nimi-action-primary-bg)]/22 bg-[var(--nimi-action-primary-bg)]/12 px-4 py-2 text-sm font-semibold text-[var(--nimi-text-inverse)] transition-colors hover:bg-[var(--nimi-action-primary-bg)]/18 disabled:cursor-default disabled:opacity-55"
                  >
                    {connectLabel}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => onViewCharacter(character)}
                  className="rounded-full border border-[var(--nimi-action-primary-bg)]/18 bg-black/18 px-4 py-2 text-sm text-[color-mix(in_srgb,var(--nimi-action-primary-bg)_72%,white)]/72 transition-colors hover:border-[var(--nimi-action-primary-bg)]/28 hover:text-[#effff8]"
                >
                  {t('WorldDetail.xianxia.v2.characters.quickSheetViewProfile')}
                </button>
              </div>
            ) : null}
          </ScrollArea>
        </section>
      </div>
    </div>
  );
}
