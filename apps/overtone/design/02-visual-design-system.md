## 2. Visual Design System

### 2.1 Color Palette

#### Surface Layers (6 levels)

Each layer increases brightness by ~2-3 points in lightness, creating a sense of
depth without sharp borders. Blue undertone distinguishes Overtone from generic
zinc-gray dark themes.

| Token | Hex | HSL | Usage |
|-------|-----|-----|-------|
| `--ot-surface-0` | `#08090d` | `225 25% 3%` | App background, deepest layer |
| `--ot-surface-1` | `#0e1018` | `228 24% 7%` | Panel backgrounds, sidebars |
| `--ot-surface-2` | `#151825` | `228 26% 11%` | Card backgrounds, elevated containers |
| `--ot-surface-3` | `#1c2033` | `228 28% 15%` | Hover states, active panels |
| `--ot-surface-4` | `#252a40` | `228 25% 20%` | Input backgrounds, wells |
| `--ot-surface-5` | `#2f354e` | `228 25% 25%` | Borders, separators |

#### Brand Violet Scale (10 steps)

| Token | Hex | Usage |
|-------|-----|-------|
| `--ot-violet-50` | `#f3eeff` | Tint for light-on-dark text overlays |
| `--ot-violet-100` | `#e0d4ff` | Subtle highlights |
| `--ot-violet-200` | `#c4adff` | Secondary accents |
| `--ot-violet-300` | `#a785ff` | Focus rings, hover accents |
| `--ot-violet-400` | `#8b5cf6` | **Primary brand — buttons, active states** |
| `--ot-violet-500` | `#7c3aed` | Pressed states, deeper accent |
| `--ot-violet-600` | `#6d28d9` | Active indicators |
| `--ot-violet-700` | `#5b21b6` | Dark accent fills |
| `--ot-violet-800` | `#4c1d95` | Background tints |
| `--ot-violet-900` | `#2e1065` | Deepest tint, near-invisible on surface-0 |

#### Semantic Colors

| Token | Hex | Usage |
|-------|-----|-------|
| `--ot-success` | `#34d399` | Completed, published, ready |
| `--ot-warning` | `#fbbf24` | Degraded, attention needed |
| `--ot-error` | `#f87171` | Failed, unavailable |
| `--ot-info` | `#38bdf8` | Informational, neutral highlight |

#### Text Colors

| Token | Hex | Usage |
|-------|-----|-------|
| `--ot-text-primary` | `#e8eaf0` | Primary text, headings |
| `--ot-text-secondary` | `#9ca3b8` | Body text, descriptions |
| `--ot-text-tertiary` | `#5c6380` | Timestamps, hints, disabled |
| `--ot-text-ghost` | `#3a4060` | Placeholder text, faintest labels |

#### Glow Colors (for box-shadow, radial-gradient overlays)

| Token | Hex + Alpha | Usage |
|-------|-------------|-------|
| `--ot-glow-violet` | `rgba(139, 92, 246, 0.35)` | Primary button glow, play button halo |
| `--ot-glow-violet-soft` | `rgba(139, 92, 246, 0.15)` | Hover halos, focus rings |
| `--ot-glow-amber` | `rgba(251, 191, 36, 0.30)` | Favorite star glow |
| `--ot-glow-waveform` | `rgba(139, 92, 246, 0.20)` | Waveform played-region underglow |

### 2.2 Typography

Font stack: `'Inter', system-ui, -apple-system, sans-serif`
Monospace: `'JetBrains Mono', 'SF Mono', 'Fira Code', ui-monospace, monospace`

| Level | Size | Weight | Line Height | Letter Spacing | Usage |
|-------|------|--------|-------------|----------------|-------|
| Display | 28px / 1.75rem | 700 | 1.15 | -0.02em | Empty state hero text |
| Title-1 | 20px / 1.25rem | 600 | 1.3 | -0.015em | View titles |
| Title-2 | 16px / 1rem | 600 | 1.4 | -0.01em | Section headers |
| Body | 14px / 0.875rem | 400 | 1.5 | 0 | Default body text |
| Label | 12px / 0.75rem | 500 | 1.4 | 0.02em | Form labels, button text |
| Caption | 11px / 0.6875rem | 400 | 1.4 | 0.01em | Timestamps, metadata |
| Micro | 10px / 0.625rem | 500 | 1.3 | 0.04em | Badge text, compact indicators |

**Timecode font**: Always use monospace at Caption or Label size with `tabular-nums`
for alignment: `font-family: var(--ot-font-mono); font-variant-numeric: tabular-nums;`

### 2.3 Spacing System

Base unit: **4px**. All spacing is a multiple of the base unit.

| Token | Value | Usage |
|-------|-------|-------|
| `--ot-space-1` | 4px | Tightest gaps (icon-to-text) |
| `--ot-space-2` | 8px | Inline element gaps |
| `--ot-space-3` | 12px | Compact padding (badges, pills) |
| `--ot-space-4` | 16px | Standard padding, card padding |
| `--ot-space-5` | 20px | Section gaps |
| `--ot-space-6` | 24px | Panel padding |
| `--ot-space-8` | 32px | Major section separation |
| `--ot-space-10` | 40px | Hero spacing |
| `--ot-space-12` | 48px | Maximum internal gap |

### 2.4 Border Radius

| Token | Value | Usage |
|-------|-------|-------|
| `--ot-radius-sm` | 4px | Badges, small pills |
| `--ot-radius-md` | 8px | Buttons, inputs, cards |
| `--ot-radius-lg` | 12px | Panels, modals |
| `--ot-radius-xl` | 16px | Large containers |
| `--ot-radius-full` | 9999px | Circular buttons, avatar rings |

### 2.5 Shadows & Glow

```css
/* Elevated panel shadow */
--ot-shadow-panel: 0 4px 24px rgba(0, 0, 0, 0.4), 0 1px 4px rgba(0, 0, 0, 0.2);

/* Card shadow on hover */
--ot-shadow-card-hover: 0 8px 32px rgba(0, 0, 0, 0.5);

/* Violet glow for primary interactive elements */
--ot-shadow-glow-violet: 0 0 20px var(--ot-glow-violet), 0 0 60px var(--ot-glow-violet-soft);

/* Soft halo for focus states */
--ot-shadow-focus: 0 0 0 2px var(--ot-surface-0), 0 0 0 4px var(--ot-violet-400);

/* Transport bar blur */
--ot-shadow-transport: 0 -1px 0 rgba(255, 255, 255, 0.05);
```

### 2.6 Glass / Frosted Effect

Used exclusively on the Transport Bar and modal overlays:

```css
.ot-glass {
  background: rgba(14, 16, 24, 0.80);      /* surface-1 at 80% */
  backdrop-filter: blur(24px) saturate(1.5);
  -webkit-backdrop-filter: blur(24px) saturate(1.5);
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}
```

### 2.7 Motion Principles

| Property | Duration | Easing | Usage |
|----------|----------|--------|-------|
| Color/opacity | 150ms | `ease-out` | Hover, focus, state change |
| Transform (small) | 200ms | `cubic-bezier(0.34, 1.56, 0.64, 1)` | Button press, badge bounce |
| Transform (layout) | 300ms | `cubic-bezier(0.22, 1, 0.36, 1)` | Panel expand/collapse, modal enter |
| Continuous | varies | `linear` | Progress bars, breathing glow |

**Reduce-motion**: All animations must respect `prefers-reduced-motion: reduce`.
Replace animations with instant transitions; replace continuous glow with static opacity.

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

