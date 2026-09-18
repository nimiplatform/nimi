import { Suspense, lazy } from 'react';
import { Dialog, DialogBody, DialogContent, DialogTitle, EmptyState, IconButton } from '@nimiplatform/kit/ui';
import type { HeroDemo } from '../content/landing-content.js';
import { CloseIcon } from './demo-icons.js';

// Per the packet's on-demand constraint, each app's preview loads its own chunk
// only when its modal is actually opened.
const DemoZhiyuPreview = lazy(async () => ({
  default: (await import('./demo-zhiyu-preview.js')).DemoZhiyuPreview,
}));

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
  return (
    <Dialog open={app !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        onClose={onClose}
        className="flex h-[82vh] w-[94vw] max-w-5xl flex-col overflow-hidden p-0"
        data-testid="demo-app-preview"
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
          {app?.id === 'nimi.zhiyu' ? (
            <Suspense fallback={<div className="flex h-full items-center justify-center text-xs text-[var(--nimi-text-muted)]" />}>
              <DemoZhiyuPreview content={preview.zhiyu} />
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
