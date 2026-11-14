import { Suspense, lazy, useEffect, useState, type ReactNode } from 'react';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogTitle,
  EmptyState,
} from '@nimiplatform/kit/ui';
import { loadLandingContent, type FullHeroDemoAppPreview, type HeroDemo } from '../content/landing-content.js';
import type { PreviewDestination, PreviewScreen } from '../content/demo-navigation.js';
import { COURTYARD_PARTNER } from '../content/demo-tour.js';
import { DemoWindowHeader } from './demo-window-header.js';
import { AppPreviewLocaleProvider } from '../i18n/app-preview-locale.js';

function loadBrowserCss(loader: () => Promise<unknown>): Promise<unknown> {
  return typeof document === 'undefined' ? Promise.resolve() : loader();
}

// Each app's preview loads its own component AND custom stylesheet chunk only
// when its modal or embedded preview is actually opened in the browser.
const DemoZhiyuPreview = lazy(async () => {
  const [, module] = await Promise.all([
    loadBrowserCss(() => import('../demo-zhiyu.css')),
    import('./demo-zhiyu-preview.js'),
  ]);
  return { default: module.DemoZhiyuPreview };
});
const DemoShijingPreview = lazy(async () => {
  const [, module] = await Promise.all([
    loadBrowserCss(() => import('../demo-shijing.css')),
    import('./demo-shijing-preview.js'),
  ]);
  return { default: module.DemoShijingPreview };
});
const DemoParentosPreview = lazy(async () => {
  const [, module] = await Promise.all([
    loadBrowserCss(() => import('../demo-parentos.css')),
    import('./demo-parentos-preview.js'),
  ]);
  return { default: module.DemoParentosPreview };
});
const DemoStorybookPreview = lazy(async () => {
  const [, module] = await Promise.all([
    loadBrowserCss(() => import('../demo-storybook.css')),
    import('./demo-storybook-preview.js'),
  ]);
  return { default: module.DemoStorybookPreview };
});
const DemoOddBureauPreview = lazy(async () => {
  const [, module] = await Promise.all([
    loadBrowserCss(() => import('../demo-odd-bureau.css')),
    import('./demo-odd-bureau-preview.js'),
  ]);
  return { default: module.DemoOddBureauPreview };
});

const loadThirdPartyCss = () => loadBrowserCss(() => import('../demo-third-party.css'));
const DemoJevSearchPreview = lazy(async () => {
  const [, module] = await Promise.all([loadThirdPartyCss(), import('./demo-jev-search-preview.js')]);
  return { default: module.DemoJevSearchPreview };
});
const DemoJevUltrafastPreview = lazy(async () => {
  const [, module] = await Promise.all([loadThirdPartyCss(), import('./demo-jev-ultrafast-preview.js')]);
  return { default: module.DemoJevUltrafastPreview };
});
const DemoMoneyPrinterPreview = lazy(async () => {
  const [, module] = await Promise.all([loadThirdPartyCss(), import('./demo-moneyprinter-preview.js')]);
  return { default: module.DemoMoneyPrinterPreview };
});
const DemoOpenwhisprPreview = lazy(async () => {
  const [, module] = await Promise.all([loadThirdPartyCss(), import('./demo-openwhispr-preview.js')]);
  return { default: module.DemoOpenwhisprPreview };
});
const DemoVideoLingoPreview = lazy(async () => {
  const [, module] = await Promise.all([loadThirdPartyCss(), import('./demo-videolingo-preview.js')]);
  return { default: module.DemoVideoLingoPreview };
});
const DemoVoiceStudioPreview = lazy(async () => {
  const [, module] = await Promise.all([loadThirdPartyCss(), import('./demo-voicestudio-preview.js')]);
  return { default: module.DemoVoiceStudioPreview };
});

const loadRemainingCss = () => loadBrowserCss(() => import('../demo-remaining-apps.css'));
const DemoInscapePreview = lazy(async () => {
  const [, module] = await Promise.all([loadRemainingCss(), import('./demo-inscape-preview.js')]);
  return { default: module.DemoInscapePreview };
});
const DemoOvertonePreview = lazy(async () => {
  const [, module] = await Promise.all([loadRemainingCss(), import('./demo-overtone-preview.js')]);
  return { default: module.DemoOvertonePreview };
});
const DemoPolyagentPreview = lazy(async () => {
  const [, module] = await Promise.all([loadRemainingCss(), import('./demo-polyagent-preview.js')]);
  return { default: module.DemoPolyagentPreview };
});
const DemoRealmPersonaPreview = lazy(async () => {
  const [, module] = await Promise.all([loadRemainingCss(), import('./demo-realm-persona-preview.js')]);
  return { default: module.DemoRealmPersonaPreview };
});
const DemoRealmWorldPreview = lazy(async () => {
  const [, module] = await Promise.all([loadRemainingCss(), import('./demo-realm-world-preview.js')]);
  return { default: module.DemoRealmWorldPreview };
});
const DemoDeepTutorPreview = lazy(async () => {
  const [, module] = await Promise.all([loadRemainingCss(), import('./demo-deeptutor-preview.js')]);
  return { default: module.DemoDeepTutorPreview };
});
const DemoOpenMontagePreview = lazy(async () => {
  const [, module] = await Promise.all([loadRemainingCss(), import('./demo-openmontage-preview.js')]);
  return { default: module.DemoOpenMontagePreview };
});
const DemoSillyTavernPreview = lazy(async () => {
  const [, module] = await Promise.all([loadRemainingCss(), import('./demo-sillytavern-preview.js')]);
  return { default: module.DemoSillyTavernPreview };
});
const DemoVanePreview = lazy(async () => {
  const [, module] = await Promise.all([loadRemainingCss(), import('./demo-vane-preview.js')]);
  return { default: module.DemoVanePreview };
});
const DemoDrawioPreview = lazy(async () => {
  const [, module] = await Promise.all([loadRemainingCss(), import('./demo-drawio-preview.js')]);
  return { default: module.DemoDrawioPreview };
});
const DemoOpenNotebookPreview = lazy(async () => {
  const [, module] = await Promise.all([loadRemainingCss(), import('./demo-open-notebook-preview.js')]);
  return { default: module.DemoOpenNotebookPreview };
});
const DemoPresentonPreview = lazy(async () => {
  const [, module] = await Promise.all([loadRemainingCss(), import('./demo-presenton-preview.js')]);
  return { default: module.DemoPresentonPreview };
});

/** App ids with an interactive preview replica. */
export const DEMO_PREVIEW_APP_IDS = [
  'nimi.zhiyu',
  'nimi.shijing',
  'nimi.parentos',
  'nimi.storybook',
  'nimi.odd-bureau',
  'io.github.nimiplatform.jev-search',
  'io.github.nimiplatform.jev-ultrafast',
  'moneyprinterturbo.studio',
  'ai.nimi.openwhispr',
  'ai.nimi.videolingo',
  'nimiplatform.voicestudio',
  'nimi.inscape',
  'nimi.overtone',
  'nimi.polyagent',
  'nimi.realm-persona-studio',
  'nimi.realm-world-studio',
  'org.nimiplatform.deeptutor',
  'openmontage.studio',
  'org.nimiplatform.sillytavern',
  'nimiplatform.vane',
  'io.github.nimiplatform.next-ai-draw-io',
  'io.github.nimiplatform.open-notebook',
  'io.github.nimiplatform.presenton',
] as const;

const PREVIEW_ID_SET = new Set<string>(DEMO_PREVIEW_APP_IDS);

function isFullAppPreview(preview: HeroDemo['appPreview']): preview is FullHeroDemoAppPreview {
  return Boolean(preview.shijing && preview.remainingApps);
}

function previewFor(
  appId: string,
  preview: HeroDemo['appPreview'],
  view: PreviewScreen,
  guiding: boolean,
  partnerId = COURTYARD_PARTNER,
): ReactNode | null {
  if (appId === 'nimi.zhiyu') {
    return (
      <DemoZhiyuPreview
        content={preview.zhiyu}
        guiding={guiding}
        initialPartnerId={view === 'companion' || view === 'memory' ? partnerId : null}
        initialPanel={view === 'memory' ? 'cognition' : undefined}
      />
    );
  }
  if (!isFullAppPreview(preview)) {
    return null;
  }
  switch (appId) {
    case 'nimi.shijing':
      return <DemoShijingPreview content={preview.shijing} />;
    case 'nimi.parentos':
      return (
        <DemoParentosPreview
          content={preview.parentos}
          guiding={guiding}
          journalView={view === 'journal' || view === 'keepsakes' ? view : undefined}
        />
      );
    case 'nimi.storybook':
      return <DemoStorybookPreview content={preview.storybook} />;
    case 'nimi.odd-bureau':
      return <DemoOddBureauPreview content={preview.oddBureau} />;
    case 'io.github.nimiplatform.jev-search':
      return <DemoJevSearchPreview content={preview.jevSearch} />;
    case 'io.github.nimiplatform.jev-ultrafast':
      return <DemoJevUltrafastPreview content={preview.jevUltrafast} />;
    case 'moneyprinterturbo.studio':
      return <DemoMoneyPrinterPreview content={preview.moneyPrinter} />;
    case 'ai.nimi.openwhispr':
      return <DemoOpenwhisprPreview content={preview.openwhispr} />;
    case 'ai.nimi.videolingo':
      return <DemoVideoLingoPreview content={preview.videoLingo} />;
    case 'nimiplatform.voicestudio':
      return <DemoVoiceStudioPreview content={preview.voiceStudio} />;
    case 'nimi.inscape':
      return <DemoInscapePreview content={preview.remainingApps.inscape} />;
    case 'nimi.overtone':
      return <DemoOvertonePreview content={preview.remainingApps.overtone} />;
    case 'nimi.polyagent':
      return <DemoPolyagentPreview content={preview.remainingApps.polyagent} />;
    case 'nimi.realm-persona-studio':
      return <DemoRealmPersonaPreview content={preview.remainingApps.persona} />;
    case 'nimi.realm-world-studio':
      return <DemoRealmWorldPreview content={preview.remainingApps.world} />;
    case 'org.nimiplatform.deeptutor':
      return <DemoDeepTutorPreview content={preview.remainingApps.deeptutor} />;
    case 'openmontage.studio':
      return <DemoOpenMontagePreview content={preview.remainingApps.openmontage} />;
    case 'org.nimiplatform.sillytavern':
      return <DemoSillyTavernPreview content={preview.remainingApps.sillytavern} />;
    case 'nimiplatform.vane':
      return <DemoVanePreview content={preview.remainingApps.vane} />;
    case 'io.github.nimiplatform.next-ai-draw-io':
      return <DemoDrawioPreview content={preview.remainingApps.drawio} />;
    case 'io.github.nimiplatform.open-notebook':
      return <DemoOpenNotebookPreview content={preview.remainingApps.notebook} />;
    case 'io.github.nimiplatform.presenton':
      return <DemoPresentonPreview content={preview.remainingApps.presenton} />;
    default:
      return null;
  }
}

/** The same App dialog is opened by a library launch and by the ecosystem directory. */
export function DemoAppPreview({ opened, guiding, apps, preview, onClose, onBody, caption, headerActions, inline = false }: {
  opened?: PreviewDestination;
  inline?: boolean;
  guiding: boolean;
  apps: HeroDemo['apps'];
  preview: HeroDemo['appPreview'];
  onClose: () => void;
  onBody?: (node: HTMLDivElement | null) => void;
  caption?: ReactNode;
  headerActions?: ReactNode;
}) {
  const app = apps.items.find(item => item.id === opened?.appId);
  const needsHydration = Boolean(
    app && opened && app.id !== 'nimi.zhiyu' && PREVIEW_ID_SET.has(app.id) && !isFullAppPreview(preview),
  );
  const [hydrated, setHydrated] = useState<FullHeroDemoAppPreview | null>(null);
  const [hydrationError, setHydrationError] = useState(false);

  useEffect(() => {
    if (!needsHydration) return;
    if (hydrated?.locale === preview.locale) return;
    let canceled = false;
    setHydrationError(false);
    void loadLandingContent(preview.locale)
      .then((loaded) => {
        if (!canceled) {
          // Preserve live Zhiyu companion/memory state from the active session.
          setHydrated({ ...loaded.hero.demo.appPreview, zhiyu: preview.zhiyu });
        }
      })
      .catch(() => {
        if (!canceled) setHydrationError(true);
      });
    return () => {
      canceled = true;
    };
  }, [hydrated?.locale, needsHydration, preview.locale, preview.zhiyu]);

  const activePreview: HeroDemo['appPreview'] =
    hydrated && hydrated.locale === preview.locale
      ? { ...hydrated, zhiyu: preview.zhiyu }
      : preview;

  const isSupportedPreview = Boolean(app && PREVIEW_ID_SET.has(app.id));
  const waitingForData = Boolean(needsHydration && (!hydrated || hydrated.locale !== preview.locale) && !hydrationError);
  const replica = app && opened && !waitingForData
    ? previewFor(app.id, activePreview, opened.screen, guiding, opened.partnerId)
    : null;

  const dismiss = () => {
    if (typeof document !== 'undefined' && document.querySelector('[data-demo-nested-dialog]')) return;
    onClose();
  };

  if (inline && app) {
    return (
      <section className="hero-demo-frame demo-embedded-app" aria-label={app.name} data-testid="demo-embedded-app">
        <DemoWindowHeader title={app.name} iconSrc={app.iconSrc} close={{ label: apps.closeLabel, onClose: dismiss }} />
        <div ref={onBody} className="demo-embedded-app-body" data-tour-surface="" data-tour-anchor="app-content" data-demo-app-id={app.id} lang={activePreview.locale === 'zh' ? 'zh-CN' : 'en'}>
          {waitingForData ? (
            <div className="tour-load-state" aria-busy="true">{app.name}</div>
          ) : (
            <Suspense fallback={<div className="tour-load-state" aria-busy="true">{app.name}</div>}>
              <AppPreviewLocaleProvider key={activePreview.locale} locale={activePreview.locale} messages={activePreview.messages}>
                {replica}
              </AppPreviewLocaleProvider>
            </Suspense>
          )}
        </div>
      </section>
    );
  }

  return (
    <Dialog
      open={Boolean(app)}
      onOpenChange={(open) => {
        if (!open) dismiss();
      }}
    >
      <DialogContent
        onClose={dismiss}
        className="demo-window-dialog demo-app-dialog"
        data-testid="demo-app-preview"
      >
        <DialogTitle className="sr-only">{app?.name ?? ''}</DialogTitle>
        <DemoWindowHeader title={app?.name ?? ''} iconSrc={app?.iconSrc} close={{ label: apps.closeLabel, onClose: dismiss }}>
          {headerActions}
        </DemoWindowHeader>
        <DialogBody className="min-h-0 flex-1 p-0">
          {app && (
            <div ref={onBody} className="h-full min-h-0" data-tour-surface="" data-demo-app-id={app.id} lang={activePreview.locale === 'zh' ? 'zh-CN' : 'en'}>
              {waitingForData ? (
                <div className="tour-load-state" aria-busy="true">{app.name}</div>
              ) : replica ? (
                <Suspense fallback={<div className="tour-load-state" aria-busy="true">{app.name}</div>}>
                  <AppPreviewLocaleProvider key={activePreview.locale} locale={activePreview.locale} messages={activePreview.messages}>
                    {replica}
                  </AppPreviewLocaleProvider>
                </Suspense>
              ) : (
                <div className="flex h-full items-center justify-center p-6">
                  <EmptyState
                    title={hydrationError || !isSupportedPreview ? apps.previewUnavailableTitle : app.name}
                    description={apps.previewUnavailableBody}
                  />
                </div>
              )}
            </div>
          )}
        </DialogBody>
        {caption && <div className="tour-dialog-caption">{caption}</div>}
      </DialogContent>
    </Dialog>
  );
}
