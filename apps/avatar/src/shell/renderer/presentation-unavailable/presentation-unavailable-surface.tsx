import { Button, StatusBadge, Surface, cn } from '@nimiplatform/kit/ui';
import { closeAvatarWindow } from '../app-shell/avatar-window-commands.js';
import { useTranslation } from '../i18n/index.js';
import { reloadAvatarShell } from '../shell-reload.js';

export type PresentationUnavailableSurfaceProps = {
  reason?: string | null;
};

// @nimi-authority: rule.nimi.avatar.embodiment.r076
export function PresentationUnavailableSurface({
  reason,
}: PresentationUnavailableSurfaceProps) {
  const { t } = useTranslation();
  const normalizedReason = reason?.trim() || null;

  return (
    <Surface
      as="section"
      material="glass-regular"
      tone="overlay"
      elevation="modal"
      padding="none"
      className={cn(
        'avatar-degraded-surface avatar-degraded-surface--error',
        'nimi-material-glass-regular backdrop-blur-[var(--nimi-backdrop-blur-regular)]',
      )}
      data-testid="avatar-presentation-unavailable"
      role="alert"
      aria-label={t('Avatar.presentation_unavailable.surface_aria')}
    >
      <div className="avatar-degraded-surface__banner">
        <StatusBadge
          className="avatar-degraded-surface__badge avatar-degraded-surface__badge--error"
          tone="danger"
        >
          {t('Avatar.presentation_unavailable.badge')}
        </StatusBadge>
      </div>
      <h1 className="avatar-degraded-surface__title">
        {t('Avatar.presentation_unavailable.title')}
      </h1>
      <p className="avatar-degraded-surface__summary">
        {t('Avatar.presentation_unavailable.summary')}
      </p>
      <p className="avatar-degraded-surface__recovery">
        {t('Avatar.presentation_unavailable.recovery')}
      </p>
      <div className="avatar-degraded-surface__actions">
        <Button
          type="button"
          className="avatar-degraded-surface__primary-action"
          tone="primary"
          size="md"
          onClick={() => reloadAvatarShell()}
          data-testid="avatar-presentation-restart"
        >
          {t('Avatar.presentation_unavailable.restart')}
        </Button>
        <Button
          type="button"
          tone="ghost"
          size="md"
          onClick={() => void closeAvatarWindow()}
          data-testid="avatar-presentation-close"
        >
          {t('Avatar.presentation_unavailable.close')}
        </Button>
      </div>
      {normalizedReason ? (
        <details className="avatar-degraded-surface__diagnostics">
          <summary>{t('Avatar.degraded.diagnostics.summary')}</summary>
          <dl>
            <div>
              <dt>{t('Avatar.degraded.diagnostics.reason')}</dt>
              <dd>{normalizedReason}</dd>
            </div>
          </dl>
        </details>
      ) : null}
    </Surface>
  );
}
