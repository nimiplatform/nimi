import { lazy, Suspense, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Expand } from 'lucide-react';
import { Dialog, DialogBody, DialogContent, DialogTitle } from '@nimiplatform/kit/ui';
import type { StoryText } from '../../content/story-copy.js';
import { useHeroDemoSession } from '../hero-demo-context.js';
import { HeroDemoStatic } from '../hero-demo-static.js';
import { DemoErrorBoundary } from '../demo-error-boundary.js';
import { DemoWindowHeader } from '../demo-window-header.js';

const Home = lazy(async () => ({ default: (await import('../hero-demo.js')).HeroDemoView }));
/** One complete Home renderer moves between its homepage dock and expansion. */
export function StoryHome({ t, expanded, onExpanded }: { t: StoryText; expanded: boolean; onExpanded: (open: boolean) => void }) {
  const { demo, surface } = useHeroDemoSession();
  const [host] = useState(() => typeof document === 'undefined' ? null : document.createElement('div'));
  const [dock, setDock] = useState<HTMLDivElement | null>(null);
  const [modal, setModal] = useState<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const target = expanded ? modal : dock;
    if (!host || !target) return;
    host.className = 'story-home-host'; target.appendChild(host);
    return () => host.remove();
  }, [host, dock, modal, expanded]);
  const windowTitle = t('hero.homeEyebrow');
  const windowClose = expanded ? { label: t('common.close'), onClose: () => onExpanded(false) } : undefined;
  const windowActions = !expanded && <button className="story-home-expand" type="button" aria-label={t('hero.expandHome')} title={t('hero.expandHome')} onClick={() => onExpanded(true)}><Expand size={14} /></button>;
  const fallback = <HeroDemoStatic demo={demo} surface={surface === 'apps' || surface === 'chat' ? surface : 'home'} expanded windowTitle={windowTitle} windowActions={windowActions} windowClose={windowClose} />;
  const errorFallback = <div className="hero-demo-frame flex h-full min-h-0 flex-col"><DemoWindowHeader title={windowTitle} close={windowClose}><span className="demo-preview-badge">{demo.home.badge}</span>{windowActions}</DemoWindowHeader><div className="story-load-error flex-1" role="status"><p>{t('common.loadError')}</p><button type="button" onClick={() => window.location.reload()}>{t('common.retry')}</button></div></div>;
  return <div className="story-home-dock" id="home-demo">
    <div className="story-home-slot" ref={setDock}>{expanded && fallback}</div>
    <Dialog open={expanded} onOpenChange={onExpanded}><DialogContent onClose={() => onExpanded(false)} className="demo-window-dialog story-home-dialog" data-testid="story-home-dialog">
      <DialogTitle className="sr-only">Nimi Home</DialogTitle>
      <DialogBody className="story-home-dialog-body"><div ref={setModal} className="story-home-modal-slot" /></DialogBody>
    </DialogContent></Dialog>
    {host && createPortal(<DemoErrorBoundary fallback={errorFallback}><Suspense fallback={fallback}><Home expanded windowTitle={windowTitle} windowActions={windowActions} windowClose={windowClose} /></Suspense></DemoErrorBoundary>,host)}
  </div>;
}
