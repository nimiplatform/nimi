import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { MediaImage } from '@nimiplatform/kit/features/media';
import { ChevronRight, Globe } from 'lucide-react';
import { EntityAvatar } from '../../components/entity-avatar.js';
import type { resolveCurrentPartnerSource } from '../source-detail/data/realm-source-detail-data.js';

type PartnerSource = Awaited<ReturnType<typeof resolveCurrentPartnerSource>>;

// Matches CharacterSourceDetailPage (partner mode) so loading public profile
// data never flashes the degraded fallback card layout before settling.
export function PartnerProfileLoading({
  displayName,
  avatarUrl,
  source,
  worldId,
  onOpenWorld,
  actions,
  status,
  sourceNotice,
}: {
  displayName: string;
  avatarUrl?: string | null;
  source?: PartnerSource | null;
  worldId?: string | null;
  onOpenWorld?: () => void;
  actions: ReactNode;
  status: ReactNode;
  sourceNotice: ReactNode;
}) {
  const { t } = useTranslation();
  // Only render the character's own profile cover during loading; world banner
  // comes from the full source detail query and takes precedence over referenceImage.
  const coverAsset = source?.media.assets.profileCover ?? null;
  const coverMedia = coverAsset?.delivery ?? null;
  const coverUrl = coverAsset?.externalUrl ?? source?.media.external.profileCoverUrl ?? null;
  const worldName = source?.worldName?.trim() || null;

  return (
    <div
      data-testid="partner-character-profile-loading"
      aria-busy="true"
      className="char-profile-root flex min-h-0 flex-1 flex-col"
    >
      <div className="min-w-0 flex-1">
        <section data-testid="world-character-overview-section" data-nimi-density="expressive" className="min-w-0">
          <div className="mx-auto w-full max-w-[1120px] px-0">
            <div
              data-testid="world-character-hero-banner"
              className="relative h-[176px] w-full overflow-hidden rounded-[var(--nimi-radius-lg)] bg-[var(--nimi-surface-panel)] ring-1 ring-inset ring-black/[0.06]"
            >
              {coverMedia || coverUrl ? (
                <>
                  <MediaImage
                    delivery={coverMedia}
                    externalUrl={coverUrl}
                    purpose="hero"
                    sizes="auto, 1120px"
                    loading="eager"
                    fetchPriority="high"
                    alt=""
                    className="absolute inset-0 h-full w-full object-cover object-[center_22%]"
                  />
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/24 to-transparent"
                  />
                </>
              ) : (
                <div aria-hidden="true" className="h-full w-full animate-pulse bg-[var(--nimi-surface-active)]" />
              )}
              {worldId && worldName && onOpenWorld ? (
                <button
                  type="button"
                  data-testid="world-character-world-pill"
                  onClick={onOpenWorld}
                  className="absolute right-4 top-4 z-10 inline-flex max-w-[min(360px,68%)] items-center gap-1.5 rounded-[10px] bg-black/62 px-3 py-1.5 text-white transition-colors hover:bg-black/78 focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
                >
                  <Globe aria-hidden className="h-3.5 w-3.5 shrink-0 text-white/75" />
                  <span className="shrink-0 text-xs text-white/75">{t('SourceDetail.worldCharacter.worldPill')}</span>
                  <span className="min-w-0 truncate text-xs font-medium text-white">{worldName}</span>
                  <ChevronRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-white/75" />
                </button>
              ) : null}
            </div>
          </div>

          <div className="mx-auto max-w-[1120px] px-0 pb-12">
            <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-6 gap-y-4 pl-6 max-[760px]:grid-cols-[auto_minmax(0,1fr)] max-[720px]:pl-5">
              <div
                data-testid="world-character-hero-avatar"
                className="char-hero-avatar relative -mt-12 h-24 w-24 shrink-0 overflow-hidden rounded-[var(--nimi-radius-lg)] bg-[var(--nimi-surface-card)]"
              >
                <EntityAvatar
                  imageUrl={avatarUrl}
                  name={displayName}
                  kind="human"
                  shape="rounded"
                  sizeClassName="h-full w-full"
                  radiusClassName="rounded-[var(--nimi-radius-lg)]"
                  fallbackClassName="bg-[var(--nimi-surface-panel)] text-[var(--nimi-text-primary)]"
                  textClassName="char-display-serif text-3xl"
                />
              </div>

              <div className="min-w-0 pt-4 max-[760px]:pt-2">
                <div data-testid="world-character-hero-title-row" className="flex flex-wrap items-center gap-3">
                  <h1 className="char-display-serif break-words text-[28px] leading-[1.2] text-[var(--nimi-text-primary)]">
                    {displayName}
                  </h1>
                </div>
                <div aria-hidden="true" className="mt-2.5 grid max-w-sm gap-2">
                  <div className="h-4 w-48 max-w-full animate-pulse rounded bg-[var(--nimi-surface-active)]" />
                  <div className="h-3.5 w-36 max-w-full animate-pulse rounded bg-[var(--nimi-surface-panel)]" />
                </div>
              </div>

              <div className="pt-4 max-[760px]:col-span-full max-[760px]:pt-1">
                {actions}
              </div>
            </div>

            <div data-testid="world-character-overview-columns" className="mt-10">
              <div
                data-testid="world-character-reading-columns"
                className="grid items-start gap-12 min-[960px]:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]"
              >
                <div data-testid="world-character-stage-column" className="grid min-w-0 content-start gap-10">
                  <div>{sourceNotice}</div>
                  <div aria-hidden="true" className="grid gap-3">
                    <div className="h-5 w-32 animate-pulse rounded bg-[var(--nimi-surface-active)]" />
                    <div className="h-4 animate-pulse rounded bg-[var(--nimi-surface-active)]" />
                    <div className="h-4 w-11/12 animate-pulse rounded bg-[var(--nimi-surface-active)]" />
                    <div className="h-4 w-4/5 animate-pulse rounded bg-[var(--nimi-surface-panel)]" />
                  </div>
                  <div aria-hidden="true" className="h-48 animate-pulse rounded-[var(--nimi-radius-lg)] bg-[var(--nimi-surface-panel)]" />
                </div>

                <aside
                  data-testid="world-character-dossier-column"
                  className="grid min-w-0 content-start gap-6 rounded-[var(--nimi-radius-lg)] bg-[var(--nimi-surface-panel)] p-6 sm:p-7"
                >
                  <div className="char-folio-section">{status}</div>
                  <div aria-hidden="true" className="char-folio-section grid gap-2.5">
                    <div className="h-4 w-24 animate-pulse rounded bg-[var(--nimi-surface-active)]" />
                    <div className="h-3.5 w-full animate-pulse rounded bg-[var(--nimi-surface-card)]" />
                    <div className="h-3.5 w-3/4 animate-pulse rounded bg-[var(--nimi-surface-card)]" />
                  </div>
                </aside>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
