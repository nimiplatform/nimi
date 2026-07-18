import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { getShellFeatureFlags } from '@nimiplatform/kit/core/shell-mode';
import { AmbientBackground, ProgressIndicator } from '@nimiplatform/kit/ui';
import { desktopBridge } from '@renderer/bridge';
import { E2E_IDS } from '@renderer/testability/e2e-ids';
import bootstrapLogoImage from '../../assets/logo.png';

const MACOS_TRAFFIC_LIGHT_SAFE_ZONE_PX = 92;
const BOOT_PROGRESS_FLOOR_PERCENT = 8;

function WindowDragRegion() {
  const flags = getShellFeatureFlags();

  const onMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (!flags.enableTitlebarDrag) return;
    if (event.button !== 0 || event.detail > 1) return;
    if (event.clientX < MACOS_TRAFFIC_LIGHT_SAFE_ZONE_PX) return;
    void desktopBridge.startWindowDrag().catch(() => {
      // Window dragging is a shell enhancement; loading must continue if it is unavailable.
    });
  };

  return <div aria-hidden className="absolute inset-x-0 top-0 z-30 h-8" onMouseDown={onMouseDown} />;
}

export function RuntimeLoadingScreen() {
  const { t } = useTranslation();
  const [progress, setProgress] = useState(BOOT_PROGRESS_FLOOR_PERCENT);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const start = performance.now();
    const target = 90;
    const range = target - BOOT_PROGRESS_FLOOR_PERCENT;
    const duration = 6500;

    const tick = (now: number) => {
      const elapsed = now - start;
      const normalized = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - normalized, 3);
      setProgress(BOOT_PROGRESS_FLOOR_PERCENT + range * eased);
      if (normalized < 1) rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const clamped = Math.min(100, progress);
  const title = t('Bootstrap.initializingRuntime').replace(/(?:\.{3}|…)+$/u, '');

  return (
    <AmbientBackground
      variant="mesh"
      className="min-h-screen overflow-hidden bg-[var(--nimi-surface-canvas)] text-[var(--nimi-text-primary)]"
    >
      <div
        aria-hidden="true"
        className="nimi-material-glass-regular absolute inset-0 z-[1] bg-[color-mix(in_srgb,var(--nimi-material-glass-regular-bg)_58%,transparent)] backdrop-blur-[var(--nimi-backdrop-blur-regular)]"
      />
      <WindowDragRegion />

      <main
        data-testid={E2E_IDS.appLoadingScreen}
        className="relative z-10 flex min-h-screen items-center justify-center px-6 py-8"
      >
        <section className="flex w-full max-w-[420px] flex-col items-center text-center">
          <div
            data-testid="runtime-loading-logo"
            className="flex h-24 w-24 items-center justify-center"
          >
            <img
              src={bootstrapLogoImage}
              alt="Nimi"
              className="h-24 w-24 object-contain drop-shadow-[0_10px_18px_rgba(33,183,181,0.14)]"
            />
          </div>

          <div className="mt-6 rounded-full border border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_42%,white)] bg-[var(--nimi-surface-card)] px-4 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--nimi-action-primary-bg)]">
            Nimi Runtime
          </div>

          <h1 className="mt-4 text-[22px] font-semibold leading-7 tracking-[-0.02em] text-[var(--nimi-text-primary)]">
            {title}
          </h1>
          <p className="mt-2 max-w-[28rem] text-sm leading-6 text-[var(--nimi-text-secondary)]">
            {t('Bootstrap.initializingRuntimeDescription')}
          </p>

          <div className="mt-7 w-full max-w-[18rem]">
            <ProgressIndicator
              value={clamped}
              showValue
              aria-label={title}
              className="[&_.nimi-progress__track]:bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,white)]"
            />
            <p className="mt-3 text-xs text-[var(--nimi-text-muted)]">{t('Bootstrap.bootSequenceLabel')}</p>
          </div>
        </section>
      </main>
    </AmbientBackground>
  );
}
