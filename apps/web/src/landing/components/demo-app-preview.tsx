import { Suspense, lazy, type ReactNode } from 'react';
import { Dialog, DialogBody, DialogContent, DialogTitle, EmptyState, IconButton } from '@nimiplatform/kit/ui';
import type { HeroDemo } from '../content/landing-content.js';
import { CloseIcon } from './demo-icons.js';

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

/** App ids with an interactive preview replica. */
export const DEMO_PREVIEW_APP_IDS = ['nimi.zhiyu', 'nimi.shijing', 'nimi.parentos', 'nimi.storybook', 'nimi.odd-bureau'] as const;

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
    default:
      return null;
  }
}

/**
 * App interactive-preview modal. Opening "启动" on an app never starts a real
 * product session: it mounts the app's kit-composed replica on mock data.
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
    <Dialog open={app !== null} onOpenChange={(open) => { if (!open) dismiss(); }}>
      <DialogContent
        onClose={dismiss}
        className="flex h-[88vh] w-[96vw] max-w-[1360px] flex-col overflow-hidden p-0"
        data-testid="demo-app-preview"
        data-demo-app-id={app?.id ?? ''}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-[var(--nimi-border-subtle)] px-5 py-3">
          <DialogTitle className="text-sm font-semibold text-[var(--nimi-text-primary)]">
            {app?.name ?? ''}
          </DialogTitle>
          <span className="rounded-full bg-[var(--nimi-surface-active)] px-2.5 py-1 text-[11px] font-semibold text-[var(--nimi-text-secondary)]">
            {apps.previewBadge}
          </span>
          <span className="flex-1" />
          <IconButton aria-label={apps.closeLabel} icon={<CloseIcon />} size="sm" onClick={onClose} />
        </div>
        <DialogBody className="min-h-0 flex-1 p-0">
          {replica ? (
            <Suspense fallback={<div className="flex h-full items-center justify-center text-xs text-[var(--nimi-text-muted)]" />}>
              {replica}
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
