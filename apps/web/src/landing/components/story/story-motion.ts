import { useEffect, type RefObject } from 'react';

export function storyHomeTransitionState(scrollY: number, start: number, end: number) {
  const progress = Math.min(1, Math.max(0, (scrollY - start) / (end - start)));
  return {
    progress,
    travel: progress * progress * (3 - 2 * progress),
    targetOpacity: Math.min(1, Math.max(0, (progress - 0.72) / 0.28)),
  };
}

type StoryRect = { left: number; top: number; width: number; height: number };
type ActiveHomeTransition = {
  layer: HTMLDivElement;
  source: HTMLElement;
  target: HTMLElement;
  sourceParent: Node;
  sourceNext: ChildNode | null;
  targetParent: Node;
  targetNext: ChildNode | null;
  sourceCss: string;
  targetCss: string;
  from: StoryRect;
  to: StoryRect;
};

/** Scroll moves the scenery and Home window without taking over navigation or demo state. */
export function useStoryMotion(root: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const site = root.current;
    if (!site) return;
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    let dispose = () => {};
    const configure = () => {
      dispose();
      if (preference.matches) return;
      const hero = site.querySelector<HTMLElement>('.story-hero');
      const homeStage = hero?.querySelector<HTMLElement>('.story-home-stage');
      const home = homeStage?.querySelector<HTMLElement>('#home-demo');
      const homeSlot = home?.querySelector<HTMLElement>('.story-home-slot');
      const ownership = site.querySelector<HTMLElement>('.story-experience-composition');
      const ownershipPanels = ownership?.querySelector<HTMLElement>('.story-ownership-panels');
      const ownershipWindow = ownership?.querySelector<HTMLElement>('[data-ownership-chapter="models"] .story-ownership-window');
      const desktop = window.matchMedia('(min-width: 861px) and (min-height: 700px)');
      const scenes = [...site.querySelectorAll<HTMLElement>('[data-story-scene]')];
      const visible = new Set<HTMLElement>();
      let frame = 0;
      let remainingDepth: number | undefined;
      let transition: ActiveHomeTransition | null = null;
      const clearTransition = () => {
        if (!transition) return;
        const current = transition;
        transition = null;
        current.sourceParent.insertBefore(current.source, current.sourceNext);
        current.targetParent.insertBefore(current.target, current.targetNext);
        current.source.style.cssText = current.sourceCss;
        current.target.style.cssText = current.targetCss;
        current.layer.remove();
        site.style.removeProperty('--story-ownership-intro-opacity');
      };
      const beginTransition = (source: HTMLElement, target: HTMLElement, from: StoryRect, to: StoryRect) => {
        const layer = document.createElement('div');
        layer.className = 'story-home-transition';
        layer.setAttribute('aria-hidden', 'true');
        layer.inert = true;
        transition = {
          layer,
          source,
          target,
          sourceParent: source.parentNode!,
          sourceNext: source.nextSibling,
          targetParent: target.parentNode!,
          targetNext: target.nextSibling,
          sourceCss: source.style.cssText,
          targetCss: target.style.cssText,
          from,
          to,
        };
        site.appendChild(layer);
        layer.append(source, target);
        for (const [element, rect] of [[source, from], [target, to]] as const) {
          const zoom = Number.parseFloat(window.getComputedStyle(element).zoom) || 1;
          element.style.position = 'absolute';
          element.style.left = `${rect.left / zoom}px`;
          element.style.top = `${rect.top / zoom}px`;
          element.style.width = `${rect.width / zoom}px`;
          element.style.height = `${rect.height / zoom}px`;
          element.style.margin = '0';
          element.style.transformOrigin = 'top left';
          element.style.animation = 'none';
          element.style.pointerEvents = 'none';
        }
        source.style.opacity = '1';
        target.style.opacity = '0';
      };
      const paintHomeTransition = () => {
        if (!desktop.matches || !homeStage || !home || !homeSlot || !ownership || !ownershipPanels || !ownershipWindow) return;
        const homeStyle = window.getComputedStyle(home);
        const panelsStyle = window.getComputedStyle(ownershipPanels);
        const homeTop = Number.parseFloat(homeStyle.top);
        const ownershipTop = Number.parseFloat(panelsStyle.top);
        if (homeStyle.position !== 'sticky' || panelsStyle.position !== 'sticky' || !Number.isFinite(homeTop) || !Number.isFinite(ownershipTop)) return;
        const scroll = Math.max(0, window.scrollY);
        const stageTop = homeStage.getBoundingClientRect().top + scroll;
        const ownershipDocumentTop = ownership.getBoundingClientRect().top + scroll;
        const start = stageTop + homeStage.offsetHeight - homeSlot.offsetHeight - homeTop;
        const end = ownershipDocumentTop - ownershipTop;
        if (end <= start) return;
        const { progress, travel, targetOpacity } = storyHomeTransitionState(scroll, start, end);
        if (progress <= 0 || progress >= 1) {
          clearTransition();
          return;
        }
        const source = transition?.source ?? homeSlot;
        const target = transition?.target ?? ownershipWindow;
        if (!transition) {
          if (home.contains(document.activeElement) || ownershipWindow.contains(document.activeElement)
            || !homeSlot.firstElementChild || document.querySelector('.story-home-dialog')) return;
          const homeBounds = home.getBoundingClientRect();
          const targetBounds = ownershipWindow.getBoundingClientRect();
          if (homeBounds.width <= 0 || homeSlot.offsetHeight <= 0 || targetBounds.width <= 0 || targetBounds.height <= 0) return;
          beginTransition(homeSlot, ownershipWindow,
            { left: homeBounds.left, top: homeTop, width: homeBounds.width, height: homeSlot.offsetHeight },
            { left: targetBounds.left, top: ownershipTop, width: targetBounds.width, height: targetBounds.height });
        }
        if (!transition || !source.firstElementChild) {
          clearTransition();
          return;
        }
        const { from, to } = transition;
        const mix = (from: number, to: number) => from + (to - from) * travel;
        const current = {
          left: mix(from.left, to.left),
          top: mix(from.top, to.top),
          width: mix(from.width, to.width),
          height: mix(from.height, to.height),
        };
        for (const [element, base] of [[source, from], [target, to]] as const) {
          const zoom = Number.parseFloat(window.getComputedStyle(element).zoom) || 1;
          element.style.left = `${current.left / zoom}px`;
          element.style.top = `${current.top / zoom}px`;
          element.style.transform = `scale(${current.width / base.width}, ${current.height / base.height})`;
        }
        source.style.opacity = String(1 - targetOpacity);
        target.style.opacity = String(targetOpacity);
        site.style.setProperty('--story-ownership-intro-opacity', String(Math.min(1, Math.max(0, (progress - 0.88) / 0.12))));
        transition.layer.dataset.progress = progress.toFixed(3);
      };
      const paint = () => {
        frame = 0;
        if (hero && homeStage && home) {
          // Reach full size exactly where the dock reaches its sticky position.
          const style = window.getComputedStyle(home);
          const stageTop = homeStage.getBoundingClientRect().top;
          const remaining = stageTop - Number.parseFloat(style.top);
          const scroll = Math.max(0, window.scrollY);
          const distance = remaining > 0 ? remaining / (remaining + scroll) : 0;
          const depth = distance ** 2;
          if (distance > 0) {
            const openingTop = stageTop + scroll + Number.parseFloat(style.getPropertyValue('--hero-lift'));
            const openingScale = 1 - Number.parseFloat(style.getPropertyValue('--hero-scale-loss'));
            const openingEdge = Math.min(window.innerHeight * 0.925, openingTop + home.offsetHeight * openingScale * 0.64);
            // Move the cut below the viewport before handing off to the hold.
            const edge = openingEdge * distance + window.innerHeight * 1.01 * (1 - distance);
            hero.style.setProperty('--hero-reveal-end', `${edge - hero.getBoundingClientRect().top}px`);
          } else if (remainingDepth) {
            hero.style.removeProperty('--hero-reveal-end');
          }
          if (depth !== remainingDepth) {
            remainingDepth = depth;
            if (depth > 0) home.style.setProperty('--hero-depth', String(depth));
            else home.style.removeProperty('--hero-depth');
          }
        }
        paintHomeTransition();
        for (const scene of visible) {
          const rect = scene.getBoundingClientRect();
          const progress = Math.max(-1, Math.min(1, (window.innerHeight / 2 - rect.top - rect.height / 2) / window.innerHeight));
          scene.style.setProperty('--scene-shift', `${progress * 32}px`);
        }
      };
      const schedule = () => { if (!frame) frame = window.requestAnimationFrame(paint); };
      const remeasure = () => { clearTransition(); schedule(); };
      const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
        for (const entry of entries) {
          const scene = entry.target as HTMLElement;
          if (scene === homeSlot) {
            if (entry.isIntersecting) {
              scene.dataset.entered = 'true';
              observer?.unobserve(scene);
            }
            continue;
          }
          if (entry.isIntersecting) { visible.add(scene); scene.dataset.entered = 'true'; }
          else visible.delete(scene);
        }
        schedule();
      }, { threshold: 0.06 });
      if (observer) {
        site.dataset.motion = 'ready';
        scenes.forEach(scene => observer.observe(scene));
        if (homeSlot && !homeSlot.dataset.entered) observer.observe(homeSlot);
      }
      paint();
      window.addEventListener('scroll', schedule, { passive: true });
      window.addEventListener('resize', remeasure);
      desktop.addEventListener('change', remeasure);
      dispose = () => {
        clearTransition();
        observer?.disconnect();
        window.cancelAnimationFrame(frame);
        window.removeEventListener('scroll', schedule);
        window.removeEventListener('resize', remeasure);
        desktop.removeEventListener('change', remeasure);
        delete site.dataset.motion;
        hero?.style.removeProperty('--hero-reveal-end');
        home?.style.removeProperty('--hero-depth');
        scenes.forEach(scene => scene.style.removeProperty('--scene-shift'));
      };
    };
    configure();
    preference.addEventListener('change', configure);
    return () => { dispose(); preference.removeEventListener('change', configure); };
  }, [root]);
  useEffect(() => {
    const site = root.current;
    if (!site) return;
    const continueLink = site.querySelector<HTMLAnchorElement>('.story-hero-continue');
    const homeStage = site.querySelector<HTMLElement>('.story-home-stage');
    const home = site.querySelector<HTMLElement>('#home-demo');
    if (!continueLink || !homeStage || !home) return;
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    let animationFrame = 0;
    const cancelScroll = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    };
    const scrollHome = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      cancelScroll();
      if (window.location.hash !== '#home-demo') window.history.pushState(null, '', '#home-demo');
      const homeStyle = window.getComputedStyle(home);
      const stickyTop = Number.parseFloat(homeStyle.top);
      const scrollMargin = Number.parseFloat(homeStyle.scrollMarginTop) || 0;
      const stageRect = homeStage.getBoundingClientRect();
      const homeRect = home.getBoundingClientRect();
      let target = window.scrollY + homeRect.top - scrollMargin;
      if (homeStyle.position === 'sticky' && Number.isFinite(stickyTop)) {
        const stickyTarget = window.scrollY + stageRect.top - stickyTop;
        const heroCopy = site.querySelector<HTMLElement>('.story-hero-copy');
        const copyTarget = heroCopy ? window.scrollY + heroCopy.getBoundingClientRect().bottom + 24 : stickyTarget;
        const lastStickyTarget = window.scrollY + stageRect.bottom - homeRect.height - stickyTop;
        target = Math.min(lastStickyTarget, Math.max(stickyTarget, copyTarget));
      }
      const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      const endScroll = Math.min(maxScroll, Math.max(0, target));
      const startScroll = window.scrollY;
      if (preference.matches || Math.abs(endScroll - startScroll) < 1) {
        window.scrollTo({ top: endScroll, behavior: 'auto' });
        return;
      }
      const startedAt = window.performance.now();
      const tick = () => {
        const progress = Math.min(1, (window.performance.now() - startedAt) / 1000);
        const eased = progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
        window.scrollTo({ top: startScroll + (endScroll - startScroll) * eased, behavior: 'auto' });
        if (progress >= 1) {
          animationFrame = 0;
          return;
        }
        animationFrame = window.requestAnimationFrame(tick);
      };
      animationFrame = window.requestAnimationFrame(tick);
    };
    continueLink.addEventListener('click', scrollHome);
    window.addEventListener('pointerdown', cancelScroll, { passive: true });
    window.addEventListener('wheel', cancelScroll, { passive: true });
    window.addEventListener('keydown', cancelScroll);
    window.addEventListener('popstate', cancelScroll);
    return () => {
      cancelScroll();
      continueLink.removeEventListener('click', scrollHome);
      window.removeEventListener('pointerdown', cancelScroll);
      window.removeEventListener('wheel', cancelScroll);
      window.removeEventListener('keydown', cancelScroll);
      window.removeEventListener('popstate', cancelScroll);
    };
  }, [root]);
}
