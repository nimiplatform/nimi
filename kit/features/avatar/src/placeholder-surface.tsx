import { useState, type ReactNode } from 'react';

import { Button } from '@nimiplatform/kit/ui';
import { formatAvatarVrmAssetLabel } from './asset-label.js';
import type { AvatarStageRendererContext } from './types.js';

/**
 * Shared hand-drawn placeholder surface for avatar backends (previously two
 * drifted copies in `vrm.tsx` and `live2d.tsx`). Backend differences flow in
 * through the renderer context (poster, label, asset ref), so the surface
 * itself stays backend-agnostic. A failing poster image is hidden instead of
 * showing a broken-image icon.
 */
export function AvatarPlaceholderSurface({
  context,
}: {
  context: AvatarStageRendererContext;
}) {
  const [failedPosterUrl, setFailedPosterUrl] = useState<string | null>(null);
  const posterUrl = context.renderer.posterUrl;
  const showPoster = Boolean(posterUrl) && failedPosterUrl !== posterUrl;
  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_30%_20%,var(--nimi-surface-card),var(--nimi-surface-panel)_55%,var(--nimi-surface-canvas))]">
      {showPoster && posterUrl ? (
        <img
          src={posterUrl}
          alt={context.label}
          onError={() => setFailedPosterUrl(posterUrl)}
          className="absolute inset-0 h-full w-full object-cover opacity-34"
        />
      ) : null}
      <span className="absolute inset-[14%] rounded-[42%] border border-[color-mix(in_srgb,var(--nimi-surface-card)_80%,transparent)] bg-[radial-gradient(circle,color-mix(in_srgb,var(--nimi-surface-card)_92%,transparent),var(--nimi-status-info-soft-bg))] shadow-[0_18px_40px_color-mix(in_srgb,var(--nimi-text-primary)_8%,transparent)]" />
      <span className="absolute inset-x-[28%] top-[16%] h-[44%] rounded-[44%_44%_38%_38%] border border-[var(--nimi-status-info-soft-border)] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--nimi-surface-card)_94%,transparent),var(--nimi-status-info-soft-bg))]" />
      <span className="absolute inset-x-[24%] bottom-[16%] top-[42%] rounded-[999px_999px_34%_34%] border border-[var(--nimi-status-info-soft-border)] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--nimi-surface-card)_88%,transparent),var(--nimi-status-info-soft-bg))]" />
      <span className="absolute bottom-3 rounded-full border border-[color-mix(in_srgb,var(--nimi-surface-card)_80%,transparent)] bg-[color-mix(in_srgb,var(--nimi-text-primary)_84%,transparent)] px-2.5 py-1 text-[length:var(--nimi-type-overline-size)] font-semibold uppercase tracking-[var(--nimi-type-overline-letter-spacing)] text-[color:var(--nimi-text-inverse)]">
        {formatAvatarVrmAssetLabel(context.snapshot.presentation.avatarAssetRef) || 'avatar'}
      </span>
    </div>
  );
}

export function AvatarViewportFailureSurface({
  context,
  onRetry,
  errorLabel = 'Avatar could not be loaded.',
  retryLabel = 'Retry',
}: {
  context: AvatarStageRendererContext;
  onRetry: () => void;
  errorLabel?: string;
  retryLabel?: string;
}) {
  const compact = context.size === 'sm' || context.size === 'md';
  return (
    <div className="relative h-full w-full" role="alert" data-avatar-viewport-state="failed">
      <AvatarPlaceholderSurface context={context} />
      <div
        data-avatar-viewport-failure-layout={compact ? 'compact' : 'expanded'}
        className={compact
          ? 'absolute inset-2 flex flex-col items-center justify-center gap-1 rounded-full border border-[var(--nimi-status-danger-soft-border)] bg-[var(--nimi-status-danger-soft-bg)] p-2 text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-status-danger-soft-text)] shadow-[var(--nimi-elevation-raised)]'
          : 'absolute inset-x-4 bottom-4 flex flex-col items-center gap-2 rounded-[var(--nimi-radius-md)] border border-[var(--nimi-status-danger-soft-border)] bg-[var(--nimi-status-danger-soft-bg)] p-2 text-center text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-status-danger-soft-text)] shadow-[var(--nimi-elevation-raised)]'}
      >
        <span className={compact ? 'line-clamp-2 text-center leading-tight' : 'line-clamp-2'}>{errorLabel}</span>
        <Button
          type="button"
          tone="secondary"
          size="sm"
          onClick={onRetry}
          aria-label={compact ? `${retryLabel}: ${errorLabel}` : undefined}
          className={compact ? 'w-full px-2' : undefined}
        >
          {retryLabel}
        </Button>
      </div>
    </div>
  );
}

export function renderAvatarPlaceholderSurface(context: AvatarStageRendererContext): ReactNode {
  return <AvatarPlaceholderSurface context={context} />;
}
