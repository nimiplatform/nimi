import { lazy, Suspense, useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Expand } from 'lucide-react';
import { Dialog, DialogBody, DialogContent, DialogTitle, DialogTrigger } from '@nimiplatform/kit/ui';
import type { StoryText } from '../../content/story-copy.js';
import type { HeroContinuitySwitcherConfig } from '../hero-demo.js';
import { useHeroDemoSession } from '../hero-demo-context.js';
import { HeroDemoStatic } from '../hero-demo-static.js';
import { DemoErrorBoundary } from '../demo-error-boundary.js';
import { DemoWindowHeader } from '../demo-window-header.js';
import { StoryHomeCompanions } from './story-home-companions.js';
import { StoryMacDesktop } from './story-mac-desktop.js';

const Home = lazy(async () => ({ default: (await import('../hero-demo.js')).HeroDemoView }));
/** One complete Home renderer moves between its homepage dock and expansion. */
export function StoryHome({
  t,
  expanded,
  onExpanded,
  layout = 'devices',
  continuitySwitcher,
  extraWindowActions,
  previewHeaderActions,
  disablePreviewModal,
  staticWhenDocked,
}: {
  t: StoryText;
  expanded: boolean;
  onExpanded: (open: boolean) => void;
  layout?: 'hero' | 'devices';
  continuitySwitcher?: HeroContinuitySwitcherConfig;
  extraWindowActions?: ReactNode;
  previewHeaderActions?: ReactNode;
  disablePreviewModal?: boolean;
  staticWhenDocked?: boolean;
}) {
  const { demo, surface } = useHeroDemoSession();
  const [host] = useState(() => typeof document === 'undefined' ? null : document.createElement('div'));
  const [dock, setDock] = useState<HTMLDivElement | null>(null);
  const [modal, setModal] = useState<HTMLDivElement | null>(null);
  const docked = !expanded && !modal;
  const expandButton = useRef<HTMLButtonElement>(null);
  const mobileExpandButton = useRef<HTMLButtonElement>(null);
  const restoreExpandFocus = useRef<'window' | 'mobile' | null>(null);
  const dockBounds = useRef<DOMRect | undefined>(undefined);
  const chatCuePlayed = useRef(false);
  const cueOpenChat = useCallback((button: HTMLButtonElement | null) => {
    if (!button || !docked || chatCuePlayed.current || typeof IntersectionObserver === 'undefined'
      || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry || entry.intersectionRatio < 0.75) return;
      chatCuePlayed.current = true;
      button.dataset.storyChatCue = 'true';
      observer.disconnect();
    }, { threshold: 0.75 });
    observer.observe(button);
    return () => observer.disconnect();
  }, [docked]);
  const target = modal ?? dock;
  useLayoutEffect(() => {
    if (!host || !target) return;
    host.className = 'story-home-host';
    target.appendChild(host);
    return () => host.remove();
  }, [host, target]);
  useLayoutEffect(() => {
    const trigger = restoreExpandFocus.current;
    if (!docked || !trigger) return;
    restoreExpandFocus.current = null;
    // Reparenting the window drops focus. Wait until the dialog's focus trap
    // is gone before restoring it to the toolbar button.
    const frame = requestAnimationFrame(() => {
      if (document.activeElement !== document.body) return;
      const button = trigger === 'mobile' ? mobileExpandButton.current : expandButton.current;
      button?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [docked]);
  useLayoutEffect(() => {
    if (!expanded || !modal) return;
    const from = dockBounds.current;
    dockBounds.current = undefined;
    const panel = modal.closest<HTMLElement>('.story-home-dialog');
    if (!from || !panel) return;

    // Measure the panel without the generic dialog entrance transform so the
    // live window can start exactly where the docked window was.
    panel.dataset.storyFromDock = 'true';
    const to = panel.getBoundingClientRect();
    const motion = panel.animate([
      {
        translate: `calc(-50% + ${from.x - to.x}px) calc(-50% + ${from.y - to.y}px)`,
        scale: `${from.width / to.width} ${from.height / to.height}`,
      },
      { translate: '-50% -50%', scale: '1' },
    ], { duration: 300, easing: 'cubic-bezier(.22,.75,.24,1)' });
    const clearMotion = () => { delete panel.dataset.storyFromDock; };
    motion.onfinish = clearMotion;
    return () => {
      motion.cancel();
      clearMotion();
    };
  }, [modal, expanded]);
  const windowTitle = t(layout === 'hero' ? 'hero.windowTitle' : 'hero.homeEyebrow');
  const windowClose = docked ? undefined : { label: t('common.close'), onClose: () => onExpanded(false) };
  const prepareExpansion = (trigger: 'window' | 'mobile') => {
    restoreExpandFocus.current = trigger;
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      dockBounds.current = dock?.querySelector('.hero-demo-frame')?.getBoundingClientRect();
    }
  };
  const expandAction = docked ? (
    <DialogTrigger
      ref={expandButton}
      className="story-home-expand"
      aria-label={t('hero.expandHome')}
      onClick={() => prepareExpansion('window')}
    >
      <Expand size={14} aria-hidden="true" />
    </DialogTrigger>
  ) : null;
  const windowActions = extraWindowActions || expandAction ? (
    <>
      {extraWindowActions}
      {expandAction}
    </>
  ) : undefined;
  const fallback = <HeroDemoStatic demo={demo} surface={surface === 'apps' || surface === 'chat' ? surface : 'home'} expanded windowTitle={windowTitle} windowActions={windowActions} windowClose={windowClose} />;
  const errorFallback = <div className="hero-demo-frame flex h-full min-h-0 flex-col"><DemoWindowHeader title={windowTitle} close={windowClose}><span className="demo-preview-badge">{demo.home.badge}</span>{windowActions}</DemoWindowHeader><div className="story-load-error flex-1" role="status"><p>{t('common.loadError')}</p><button type="button" onClick={() => window.location.reload()}>{t('common.retry')}</button></div></div>;
  return <div className="story-home-dock">
    {layout === 'hero' ? <div className="story-home-slot" ref={setDock} /> : <div className="story-home-slot">
      <StoryHomeCompanions demo={demo} />
      <div className="story-home-laptop">
        <div className="story-home-laptop-screen">
          <StoryMacDesktop demo={demo} />
          <div className="story-home-mac-app"><div className="story-home-window" ref={setDock} /></div>
        </div>
        <span className="story-home-laptop-base" aria-hidden="true"><span className="story-home-laptop-recess" /></span>
      </div>
    </div>}
    <Dialog open={expanded} onOpenChange={onExpanded}>
      {layout === 'devices' && <DialogTrigger ref={mobileExpandButton} className="story-button story-button-outline story-home-mobile-expand"
        onClick={() => prepareExpansion('mobile')}>{t('hero.expandHome')}<Expand size={14} aria-hidden="true" /></DialogTrigger>}
      <DialogContent onClose={() => onExpanded(false)} className="demo-window-dialog story-home-dialog" data-testid="story-home-dialog">
        <DialogTitle className="sr-only">Nimi Home</DialogTitle>
        <DialogBody className="story-home-dialog-body"><div ref={setModal} className="story-home-modal-slot" /></DialogBody>
      </DialogContent>
      {host && createPortal(
        staticWhenDocked && docked
          ? fallback
          : (
            <DemoErrorBoundary fallback={errorFallback}>
              <Suspense fallback={fallback}>
                <Home
                  expanded
                  windowTitle={windowTitle}
                  windowActions={windowActions}
                  windowClose={windowClose}
                  openChatRef={cueOpenChat}
                  continuitySwitcher={continuitySwitcher}
                  previewHeaderActions={previewHeaderActions}
                  disablePreviewModal={disablePreviewModal}
                />
              </Suspense>
            </DemoErrorBoundary>
          ),
        host,
      )}
    </Dialog>
  </div>;
}
