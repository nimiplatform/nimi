/** Runtime-backed Developer Mode control for the single Settings > Developer page. */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@nimiplatform/kit/ui';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import { InlineFeedback } from '../../ui/feedback/inline-feedback';

export function DeveloperModeToggle({
  onEnabledChange,
}: {
  onEnabledChange?: (enabled: boolean) => void;
}) {
  const { t } = useTranslation();
  const bindings = useDesktopRendererBindings();
  const [enabled, setEnabled] = useState(
    () => bindings.app.projection.developerModeEnabled(),
  );
  const [busy, setBusy] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState('');

  // Keep in sync if Developer Mode is toggled elsewhere (e.g. another
  // discoverable entry or a second tab) — a single persisted truth.
  useEffect(() => {
    const unsubscribe = bindings.app.events.subscribeDeveloperMode((next) => {
      setEnabled(next);
      onEnabledChange?.(next);
    });
    void bindings.app.commands.refreshDeveloperMode()
      .then((projection) => {
        setUnavailable(projection.state === 'unavailable');
        setError('');
      })
      .catch((cause) => {
        setUnavailable(true);
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => setBusy(false));
    return unsubscribe;
  }, [bindings, onEnabledChange]);

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const projection = await bindings.app.commands.setDeveloperMode(!enabled);
      setUnavailable(projection.state === 'unavailable');
      setEnabled(projection.enabled);
      onEnabledChange?.(projection.enabled);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const retry = async () => {
    setBusy(true);
    setError('');
    try {
      const projection = await bindings.app.commands.refreshDeveloperMode();
      setUnavailable(projection.state === 'unavailable');
      setEnabled(projection.enabled);
      onEnabledChange?.(projection.enabled);
      if (projection.state === 'unavailable') setError(projection.reasonCode);
    } catch (cause) {
      setUnavailable(true);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-testid="developer-mode-toggle"
      data-developer-mode={enabled ? 'on' : 'off'}
      className="rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-5 shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-semibold text-[var(--nimi-text-primary)]">
            {t('Developer.developerModeTitle')}
          </p>
          <p className="max-w-xl text-xs text-[var(--nimi-text-secondary)]">
            {t('Developer.developerModeDescription')}
          </p>
          <p
            data-testid="developer-mode-status"
            role="status"
            aria-live="polite"
            className={
              enabled
                ? 'text-xs font-medium text-[var(--nimi-status-success)]'
                : 'text-xs font-medium text-[var(--nimi-text-muted)]'
            }
          >
            {busy
              ? t('Developer.developerModeStatusLoading')
              : unavailable
                ? t('Developer.developerModeStatusUnavailable')
                : enabled
              ? t('Developer.developerModeStatusOn')
              : t('Developer.developerModeStatusOff')}
          </p>
          {error ? (
            <InlineFeedback
              feedback={{ kind: 'error', message: error }}
              onDismiss={() => setError('')}
              className="mt-2 max-w-xl"
            />
          ) : null}
        </div>
        <Button
          tone={enabled ? 'secondary' : 'primary'}
          size="sm"
          data-testid="developer-mode-toggle-button"
          aria-pressed={enabled}
          loading={busy}
          disabled={unavailable}
          onClick={() => { void toggle(); }}
        >
          {enabled
            ? t('Developer.developerModeDisable')
            : t('Developer.developerModeEnable')}
        </Button>
        {unavailable ? (
          <Button
            tone="secondary"
            size="sm"
            loading={busy}
            data-testid="developer-mode-retry-button"
            onClick={() => { void retry(); }}
          >
            {t('Developer.developerModeRetry')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
