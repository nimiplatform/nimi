import { type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { E2E_IDS } from '../../testability/e2e-ids';
import { useDesktopRendererCommands } from '../../renderer/binding-context';
import bootstrapLogoImage from '../../assets/logo.png';

const MACOS_TRAFFIC_LIGHT_SAFE_ZONE_PX = 92;

function WindowDragRegion() {
  const commands = useDesktopRendererCommands();

  const onMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.detail > 1) return;
    if (event.clientX < MACOS_TRAFFIC_LIGHT_SAFE_ZONE_PX) return;
    void commands.startWindowDrag().catch(() => {
      // Window dragging is a shell enhancement; loading must continue if it is unavailable.
    });
  };

  return <div aria-hidden className="absolute inset-x-0 top-0 z-30 h-8" onMouseDown={onMouseDown} />;
}

export function RuntimeLoadingScreen() {
  const { t } = useTranslation();
  const statusText = t('Bootstrap.initializingRuntime');

  return (
    <div className="min-h-screen overflow-hidden bg-[var(--nimi-surface-canvas)] text-[var(--nimi-text-primary)]">
      <WindowDragRegion />

      <main
        data-testid={E2E_IDS.appLoadingScreen}
        className="relative z-10 flex min-h-screen items-center justify-center px-6 py-8"
      >
        <section className="flex w-full max-w-[420px] flex-col items-center text-center">
          <img
            src={bootstrapLogoImage}
            alt="Nimi"
            data-testid="runtime-loading-logo"
            className="h-20 w-20 object-contain"
          />

          <h1 className="mt-10 text-[30px] font-medium leading-snug">
            Nimi Ecosystem
          </h1>

          <div role="status" className="mt-12 flex flex-col items-center gap-3">
            <div aria-hidden="true" className="nimi-boot-dots">
              <span className="nimi-boot-dot" />
              <span className="nimi-boot-dot" />
              <span className="nimi-boot-dot" />
            </div>
            <p className="text-xs text-[var(--nimi-text-muted)]">{statusText}</p>
          </div>
        </section>
      </main>
    </div>
  );
}
