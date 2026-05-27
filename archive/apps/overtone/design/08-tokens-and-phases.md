## 8. CSS Variable System

Complete `--ot-*` token definitions for the design system. These should be defined
on `:root` in the global stylesheet.

```css
:root {
  /* ─── Surface Layers ─── */
  --ot-surface-0: #08090d;
  --ot-surface-1: #0e1018;
  --ot-surface-2: #151825;
  --ot-surface-3: #1c2033;
  --ot-surface-4: #252a40;
  --ot-surface-5: #2f354e;

  /* ─── Brand Violet ─── */
  --ot-violet-50:  #f3eeff;
  --ot-violet-100: #e0d4ff;
  --ot-violet-200: #c4adff;
  --ot-violet-300: #a785ff;
  --ot-violet-400: #8b5cf6;
  --ot-violet-500: #7c3aed;
  --ot-violet-600: #6d28d9;
  --ot-violet-700: #5b21b6;
  --ot-violet-800: #4c1d95;
  --ot-violet-900: #2e1065;

  /* ─── Semantic ─── */
  --ot-success: #34d399;
  --ot-warning: #fbbf24;
  --ot-error:   #f87171;
  --ot-info:    #38bdf8;

  /* ─── Text ─── */
  --ot-text-primary:   #e8eaf0;
  --ot-text-secondary: #9ca3b8;
  --ot-text-tertiary:  #5c6380;
  --ot-text-ghost:     #3a4060;

  /* ─── Glow ─── */
  --ot-glow-violet:      rgba(139, 92, 246, 0.35);
  --ot-glow-violet-soft: rgba(139, 92, 246, 0.15);
  --ot-glow-amber:       rgba(251, 191, 36, 0.30);
  --ot-glow-waveform:    rgba(139, 92, 246, 0.20);

  /* ─── Typography ─── */
  --ot-font-sans:  'Inter', system-ui, -apple-system, sans-serif;
  --ot-font-mono:  'JetBrains Mono', 'SF Mono', 'Fira Code', ui-monospace, monospace;

  /* ─── Spacing (4px base) ─── */
  --ot-space-1:  4px;
  --ot-space-2:  8px;
  --ot-space-3:  12px;
  --ot-space-4:  16px;
  --ot-space-5:  20px;
  --ot-space-6:  24px;
  --ot-space-8:  32px;
  --ot-space-10: 40px;
  --ot-space-12: 48px;

  /* ─── Radius ─── */
  --ot-radius-sm:   4px;
  --ot-radius-md:   8px;
  --ot-radius-lg:   12px;
  --ot-radius-xl:   16px;
  --ot-radius-full: 9999px;

  /* ─── Shadows ─── */
  --ot-shadow-panel:      0 4px 24px rgba(0, 0, 0, 0.4), 0 1px 4px rgba(0, 0, 0, 0.2);
  --ot-shadow-card-hover: 0 8px 32px rgba(0, 0, 0, 0.5);
  --ot-shadow-glow-violet: 0 0 20px var(--ot-glow-violet), 0 0 60px var(--ot-glow-violet-soft);
  --ot-shadow-focus:       0 0 0 2px var(--ot-surface-0), 0 0 0 4px var(--ot-violet-400);
  --ot-shadow-transport:   0 -1px 0 rgba(255, 255, 255, 0.05);

  /* ─── Transitions ─── */
  --ot-ease-default: ease-out;
  --ot-ease-spring:  cubic-bezier(0.34, 1.56, 0.64, 1);
  --ot-ease-smooth:  cubic-bezier(0.22, 1, 0.36, 1);
  --ot-duration-fast:   150ms;
  --ot-duration-normal: 200ms;
  --ot-duration-slow:   300ms;
}

/* ─── @keyframes ─── */

@keyframes ot-pulse {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.4; }
}

@keyframes ot-breathe {
  0%   { box-shadow: 0 0 16px rgba(139, 92, 246, 0.30), 0 0 48px rgba(139, 92, 246, 0.10); }
  50%  { box-shadow: 0 0 24px rgba(139, 92, 246, 0.50), 0 0 64px rgba(139, 92, 246, 0.20); }
  100% { box-shadow: 0 0 16px rgba(139, 92, 246, 0.30), 0 0 48px rgba(139, 92, 246, 0.10); }
}

@keyframes ot-activity-slide {
  0%   { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}

@keyframes ot-stripe-scroll {
  0%   { background-position: 0 0; }
  100% { background-position: 20px 0; }
}

@keyframes ot-ghost-bar {
  0%   { height: 4px; opacity: 0.3; }
  50%  { height: var(--bar-target-h); opacity: 0.7; }
  100% { height: 4px; opacity: 0.3; }
}

@keyframes ot-concentric-pulse {
  0%   { transform: scale(0.8); opacity: 0.4; }
  100% { transform: scale(2.5); opacity: 0; }
}

@keyframes ot-star-bounce {
  0%   { transform: scale(1); }
  30%  { transform: scale(1.4); }
  60%  { transform: scale(0.9); }
  80%  { transform: scale(1.1); }
  100% { transform: scale(1); }
}

@keyframes ot-shake {
  0%, 100% { transform: translateX(0); }
  20%      { transform: translateX(-4px); }
  40%      { transform: translateX(4px); }
  60%      { transform: translateX(-3px); }
  80%      { transform: translateX(3px); }
}

@keyframes ot-card-appear {
  0%   { opacity: 0; transform: translateY(8px) scale(0.97); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}

@keyframes ot-card-discard {
  0%   { opacity: 1; transform: scale(1); }
  100% { opacity: 0; transform: scale(0.95) translateY(4px); }
}

@keyframes ot-compare-enter {
  0%   { opacity: 0; }
  100% { opacity: 1; }
}

@keyframes ot-tooltip-in {
  0%   { opacity: 0; transform: translateY(4px); }
  100% { opacity: 1; transform: translateY(0); }
}

@keyframes ot-ambient-wave {
  0%   { transform: scaleY(0.6); }
  50%  { transform: scaleY(1.0); }
  100% { transform: scaleY(0.6); }
}

@keyframes ot-progress-indeterminate {
  0%   { transform: translateX(-100%); }
  100% { transform: translateX(300%); }
}

@keyframes ot-modal-enter {
  0%   { opacity: 0; transform: translateY(8px); }
  100% { opacity: 1; transform: translateY(0); }
}

@keyframes ot-modal-exit {
  0%   { opacity: 1; transform: translateY(0); }
  100% { opacity: 0; transform: translateY(4px); }
}

/* ─── Reduced Motion ─── */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}

/* ─── Glass Effect Utility ─── */
.ot-glass {
  background: rgba(14, 16, 24, 0.80);
  backdrop-filter: blur(24px) saturate(1.5);
  -webkit-backdrop-filter: blur(24px) saturate(1.5);
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

/* ─── Scrollbar ─── */
.ot-scroll::-webkit-scrollbar { width: 6px; }
.ot-scroll::-webkit-scrollbar-track { background: transparent; }
.ot-scroll::-webkit-scrollbar-thumb {
  background: var(--ot-surface-5);
  border-radius: var(--ot-radius-full);
}
.ot-scroll::-webkit-scrollbar-thumb:hover {
  background: var(--ot-text-tertiary);
}
```

---

## 9. Implementation Phases

### Phase 1: Foundation (Design System + Shell)

**Goal**: Replace zinc palette, establish visual identity, wire layout structure.

| Task | Details |
|------|---------|
| CSS variables | Add all `--ot-*` tokens to `styles.css` |
| Font loading | Add Inter + JetBrains Mono (local or CDN) |
| Three-zone layout | Title Bar (52px) + Stage (flex-1) + Transport Bar (80px) |
| Surface migration | Replace all `zinc-*` classes with `--ot-surface-*` equivalents |
| Glass effect | Implement `.ot-glass` for Transport Bar |
| Scrollbar styling | Apply `.ot-scroll` to panel scroll containers |
| Reduced motion | Add `prefers-reduced-motion` media query |

**Verification**: App boots with new color scheme, three-zone layout renders at 960×640 minimum.

### Phase 2: Transport Bar

**Goal**: Build the signature Transport Bar with waveform visualization.

| Task | Details |
|------|---------|
| Transport layout | Glass bar, play button, track info, waveform, trim controls |
| Play button | Violet circle with breathing glow animation |
| Waveform redesign | Rounded-top bars, violet gradient played region, underglow reflection |
| Playhead | 2px line with diamond head indicator |
| Trim markers | Triangular drag handles, highlighted region |
| Empty state | Flat line with ghost text when no take selected |
| Keyboard | Space for play/pause, arrows for seek |

**Verification**: Waveform renders with new style, breathing glow animates during playback, trim markers are draggable.

### Phase 3: Compose Panel

**Goal**: Rebuild the left panel with accordion sections and styled form controls.

| Task | Details |
|------|---------|
| Accordion component | Collapsible sections with chevron rotation, pin toggle |
| Input components | Text input, textarea, segmented control, toggle, tag input |
| Button variants | Primary, Secondary, Tertiary, Icon button styles |
| Song Brief section | Structured brief fields, AI generate shimmer |
| Lyrics section | Monospace textarea, streaming cursor indicator |
| Generation Controls | Model selector, style tags, duration, instrumental toggle |
| Iteration section | Mode segmented control, source selector, drop zone |

**Verification**: All Compose Panel sections expand/collapse, form inputs use new tokens, Generate button has glow + loading state.

### Phase 4: Takes Panel

**Goal**: Card grid, ghost cards, compare mode, lineage view.

| Task | Details |
|------|---------|
| Take card component | Mini waveform, title, origin badge, actions, selection state |
| Card grid layout | 2-column responsive, 16px gap |
| Ghost card | Dashed border, pulsing bars, progress bar, cancel |
| Card animations | Appear (new take), discard (remove), hover glow |
| A/B Compare view | Split layout, active side accent, shared transport |
| Lineage view | SVG DAG with nodes and edges, pan/zoom, auto-fit |
| Context menu | Right-click menu with all take actions |
| Favorite micro-interaction | Star bounce + amber glow on toggle |

**Verification**: Takes render as styled cards, ghost card animates during generation, compare mode switches layout, lineage DAG renders correctly.

### Phase 5: Publish Flow

**Goal**: Modal overlay with form, progress states, and completion animation.

| Task | Details |
|------|---------|
| Modal overlay | Backdrop blur, centered container, enter/exit animations |
| Take preview card | Mini waveform + metadata in modal header |
| Form fields | Title, description, tags with styled inputs |
| Provenance checkbox | Violet-filled checkbox, legal text |
| Progress states | Uploading → Creating → Done with spinner + status text |
| Success state | Sparkle animation, post link display |
| Error state | Red border, error message |

**Verification**: Modal opens/closes with animation, form validation works (provenance required), all publish states render correctly.

### Phase 6: Polish & Micro-interactions

**Goal**: Final refinements, animation polish, accessibility, edge cases.

| Task | Details |
|------|---------|
| Focus management | Focus-visible halo on all interactive elements |
| Error shake | Validation shake animation on inputs |
| Drag & drop | File drop zones with visual feedback |
| Title bar | Activity line during generation, readiness dots, inline title edit |
| Empty state | Ambient waveform animation, readiness indicators, keyboard hints |
| Keyboard shortcuts | Full shortcut implementation with tooltip hints |
| Tooltip component | Styled tooltip with keyboard shortcut display |
| Accessibility audit | ARIA labels, keyboard navigation, contrast ratios (WCAG AA on text) |
| Performance | Canvas rendering optimization, animation frame budget, will-change hints |

**Verification**: All micro-interactions fire correctly, keyboard shortcuts work, focus is visible and navigable, no dropped frames during animation.

---

## Appendix: Feature ↔ UI Coverage Matrix

| Feature | Primary View | Component Dependencies |
|---------|-------------|----------------------|
| F-001 Workspace & Readiness | Empty State, Title Bar | Readiness dots, CTA button |
| F-002 Song Brief & Lyrics | Compose Panel (Brief + Lyrics sections) | Accordion, textarea, input, secondary button |
| F-003 Music Generation | Compose Panel (Generation Controls) + Ghost Card | Segmented control, tag input, primary button, ghost card, progress bar |
| F-004 Candidate Stack & Compare | Takes Panel (Grid + Compare) | Take card, origin badge, A/B compare view, context menu |
| F-005 Reference/Extend/Remix | Compose Panel (Iteration section) + Takes Panel | Segmented control, drop zone, lineage DAG |
| F-006 Playback & Trim | Transport Bar | Play button, waveform, trim markers, timecode display |
| F-007 Realm Publish | Publish Modal | Modal overlay, form inputs, tag pills, checkbox, progress states |
