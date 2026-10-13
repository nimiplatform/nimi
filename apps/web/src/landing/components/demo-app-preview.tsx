import { Suspense, lazy, type ReactNode } from 'react';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogTitle,
  EmptyState,
  IconButton,
} from '@nimiplatform/kit/ui';
import type { HeroDemo } from '../content/landing-content.js';
import { CloseIcon } from './demo-icons.js';
import { AppPreviewLocaleProvider } from '../i18n/app-preview-locale.js';

// Per the packet's on-demand constraint, each app's preview loads its own chunk
// only when its modal is actually opened.
const DemoZhiyuPreview = lazy(async () => ({
  default: (await import('./demo-zhiyu-preview.js')).DemoZhiyuPreview,
}));
const DemoShijingPreview = lazy(async () => ({
  default: (await import('./demo-shijing-preview.js')).DemoShijingPreview,
}));
const DemoParentosPreview = lazy(async () => ({
  default: (await import('./demo-parentos-preview.js')).DemoParentosPreview,
}));
const DemoStorybookPreview = lazy(async () => ({
  default: (await import('./demo-storybook-preview.js')).DemoStorybookPreview,
}));
const DemoOddBureauPreview = lazy(async () => ({
  default: (await import('./demo-odd-bureau-preview.js')).DemoOddBureauPreview,
}));
const DemoJevSearchPreview = lazy(async () => ({
  default: (await import('./demo-jev-search-preview.js')).DemoJevSearchPreview,
}));
const DemoJevUltrafastPreview = lazy(async () => ({
  default: (await import('./demo-jev-ultrafast-preview.js')).DemoJevUltrafastPreview,
}));
const DemoMoneyPrinterPreview = lazy(async () => ({
  default: (await import('./demo-moneyprinter-preview.js')).DemoMoneyPrinterPreview,
}));
const DemoOpenwhisprPreview = lazy(async () => ({
  default: (await import('./demo-openwhispr-preview.js')).DemoOpenwhisprPreview,
}));
const DemoVideoLingoPreview = lazy(async () => ({
  default: (await import('./demo-videolingo-preview.js')).DemoVideoLingoPreview,
}));
const DemoVoiceStudioPreview = lazy(async () => ({
  default: (await import('./demo-voicestudio-preview.js')).DemoVoiceStudioPreview,
}));

const DemoInscapePreview = lazy(async () => ({
  default: (await import('./demo-inscape-preview.js')).DemoInscapePreview,
}));
const DemoOvertonePreview = lazy(async () => ({
  default: (await import('./demo-overtone-preview.js')).DemoOvertonePreview,
}));
const DemoPolyagentPreview = lazy(async () => ({
  default: (await import('./demo-polyagent-preview.js')).DemoPolyagentPreview,
}));
const DemoRealmPersonaPreview = lazy(async () => ({
  default: (await import('./demo-realm-persona-preview.js')).DemoRealmPersonaPreview,
}));
const DemoRealmWorldPreview = lazy(async () => ({
  default: (await import('./demo-realm-world-preview.js')).DemoRealmWorldPreview,
}));
const DemoDeepTutorPreview = lazy(async () => ({
  default: (await import('./demo-deeptutor-preview.js')).DemoDeepTutorPreview,
}));
const DemoOpenMontagePreview = lazy(async () => ({
  default: (await import('./demo-openmontage-preview.js')).DemoOpenMontagePreview,
}));
const DemoSillyTavernPreview = lazy(async () => ({
  default: (await import('./demo-sillytavern-preview.js')).DemoSillyTavernPreview,
}));
const DemoVanePreview = lazy(async () => ({
  default: (await import('./demo-vane-preview.js')).DemoVanePreview,
}));
const DemoDrawioPreview = lazy(async () => ({
  default: (await import('./demo-drawio-preview.js')).DemoDrawioPreview,
}));
const DemoOpenNotebookPreview = lazy(async () => ({
  default: (await import('./demo-open-notebook-preview.js')).DemoOpenNotebookPreview,
}));
const DemoPresentonPreview = lazy(async () => ({
  default: (await import('./demo-presenton-preview.js')).DemoPresentonPreview,
}));

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

function previewFor(appId: string, preview: HeroDemo['appPreview']): ReactNode | null {
  switch (appId) {
    case 'nimi.zhiyu':
      return <DemoZhiyuPreview content={preview.zhiyu} />;
    case 'nimi.shijing':
      return <DemoShijingPreview content={preview.shijing} />;
    case 'nimi.parentos':
      return <DemoParentosPreview content={preview.parentos} />;
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

/**
 * App interactive-preview modal. Opening "启动" on an app never starts a real
 * product session: it mounts a local replica using illustrative sample content.
 */
export function DemoAppPreview({
  appId,
  apps,
  preview,
  onClose,
}: {
  appId: string | null;
  apps: HeroDemo['apps'];
  preview: HeroDemo['appPreview'];
  onClose: () => void;
}) {
  const app = apps.items.find((item) => item.id === appId) ?? null;
  const replica = app ? previewFor(app.id, preview) : null;
  // Replicas open their own in-demo dialogs (e.g. ParentOS 安排日期). Radix
  // handles Escape in the capture phase, so the replica cannot stop it from
  // reaching this modal; skip dismissal while such a dialog is on screen and
  // let the replica close its own layer.
  const dismiss = () => {
    if (document.querySelector('[data-demo-nested-dialog]')) return;
    onClose();
  };
  return (
    <Dialog
      open={app !== null}
      onOpenChange={(open) => {
        if (!open) dismiss();
      }}
    >
      <DialogContent
        onClose={dismiss}
        className="flex h-[88vh] w-[96vw] max-w-[1360px] flex-col overflow-hidden p-0"
        data-testid="demo-app-preview"
        data-demo-app-id={app?.id ?? ''}
      >
        <div className="flex min-w-0 shrink-0 items-center gap-2 border-b border-[var(--nimi-border-subtle)] px-5 py-3">
          <DialogTitle className="min-w-0 max-w-[45%] truncate text-sm font-semibold text-[var(--nimi-text-primary)]">
            {app?.name ?? ''}
          </DialogTitle>
          <span className="min-w-0 truncate rounded-full bg-[var(--nimi-surface-active)] px-2.5 py-1 text-[11px] font-semibold text-[var(--nimi-text-secondary)]">
            {apps.previewBadge}
          </span>
          <span className="min-w-0 flex-1" />
          <IconButton
            className="shrink-0"
            aria-label={apps.closeLabel}
            icon={<CloseIcon />}
            size="sm"
            onClick={onClose}
          />
        </div>
        <DialogBody className="min-h-0 flex-1 p-0">
          {replica ? (
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center text-xs text-[var(--nimi-text-muted)]" />
              }
            >
              <div className="h-full min-h-0" lang={preview.locale === 'zh' ? 'zh-CN' : 'en'}>
                <AppPreviewLocaleProvider
                  key={preview.locale}
                  locale={preview.locale}
                  messages={preview.messages}
                >
                  {replica}
                </AppPreviewLocaleProvider>
              </div>
            </Suspense>
          ) : (
            <div className="flex h-full items-center justify-center p-6">
              <EmptyState
                title={apps.previewUnavailableTitle}
                description={apps.previewUnavailableBody}
              />
            </div>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
