# Overtone — Design System & UI Specification

> Visual identity, component specs, layout architecture, and interaction patterns
> for the Overtone AI music creation desktop app.

---

## Table of Contents

1. [Design Philosophy](#1-design-philosophy)
2. [Visual Design System](#2-visual-design-system)
3. [Layout Architecture](#3-layout-architecture)
4. [Core Views](#4-core-views)
5. [Interaction Patterns](#5-interaction-patterns)
6. [Component Specifications](#6-component-specifications)
7. [Signature Design Elements](#7-signature-design-elements)
8. [CSS Variable System](#8-css-variable-system)
9. [Implementation Phases](#9-implementation-phases)

---

## 1. Design Philosophy

### Visual Metaphor: Late-Night Recording Studio

The entire UI is grounded in a single metaphor — a high-end recording studio at 2 AM.
Deep blue-black surfaces, warm screen glow, glowing status indicators, and the hum of
equipment on standby. The interface should feel like sitting behind a mixing console
in a dimly lit room where the only light comes from VU meters and monitor screens.

### Brand Color: Resonance Violet

Purple has deep roots in music culture — Prince's Purple Rain, the violet end of
audio frequency spectrum visualizations, the neon glow of studio LED strips.
Overtone's brand violet is not decorative; it is the accent that marks every
interactive, generative, or "alive" element in the UI.

### Core Principles

| Principle | Meaning |
|-----------|---------|
| **Waveform is the hero** | The waveform visualization is not decoration — it is the primary visual artifact. Every screen state should feel incomplete without it. |
| **Dark-first, glow-accented** | The base palette is near-black with blue undertones. Color enters through glow, not through background fills. |
| **Quiet until active** | Idle states are subdued. Active/generating states introduce motion, glow, and saturation. The UI "wakes up" when creating. |
| **Studio, not dashboard** | No cards-on-a-grid admin layout. The spatial arrangement mirrors a mixing console: controls left, output center/right, transport bottom. |
| **Typography does work** | Large type for titles, monospace for timecodes, tight tracking for labels. Type carries hierarchy, not boxes. |

---

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

## 3. Layout Architecture

### 3.1 Three-Zone Structure

```
┌──────────────────────────────────────────────────────────┐
│  Title Bar  (52px, draggable, overlay style)             │
├──────────────────────────────────────────────────────────┤
│                                                          │
│                                                          │
│                 Stage  (flex-1)                           │
│           ┌─────────────┬────────────────┐               │
│           │  Compose     │  Takes /       │               │
│           │  Panel       │  Output        │               │
│           │  (320px      │  Panel         │               │
│           │  default,    │  (flex-1)      │               │
│           │  resizable)  │                │               │
│           └─────────────┴────────────────┘               │
│                                                          │
├──────────────────────────────────────────────────────────┤
│  Transport Bar  (80px fixed, glass effect)               │
└──────────────────────────────────────────────────────────┘
```

### 3.2 Title Bar (52px)

- **Height**: 52px (accommodates macOS traffic light offset `y: 24`)
- **Background**: `var(--ot-surface-0)` — seamless with app background
- **Drag region**: Entire bar is `-webkit-app-region: drag` except interactive elements
- **Layout**: `display: flex; align-items: center; padding: 0 16px; padding-left: 84px;` (clear macOS traffic lights at x:14)

| Zone | Content |
|------|---------|
| Left (after traffic lights) | Project title (editable inline, Title-2 weight) |
| Center | Activity indicator — hidden when idle, animated line during generation |
| Right | Readiness indicator dot + settings gear icon |

**Activity Line** (generation in progress):
```css
.ot-title-activity-line {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: linear-gradient(90deg,
    transparent 0%,
    var(--ot-violet-400) 50%,
    transparent 100%
  );
  animation: ot-activity-slide 2s linear infinite;
}
```

### 3.3 Stage (flex-1, dual-panel)

The Stage is the main content area, split into two resizable panels.

- **Container**: `display: flex; flex: 1 1 0; min-height: 0; overflow: hidden;`
- **Divider**: 1px border with 8px invisible hit area for resize cursor
- **Compose Panel**: `width: 320px; min-width: 280px; max-width: 480px; resize: horizontal;`
- **Output Panel**: `flex: 1 1 0; min-width: 400px;`

Both panels scroll independently with custom scrollbar styling:

```css
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

### 3.4 Transport Bar (80px, fixed bottom)

The Transport Bar is the signature element — always visible, anchored at the bottom.
It houses playback controls and the waveform visualization.

- **Height**: 80px
- **Position**: Fixed at bottom of Stage
- **Style**: `.ot-glass` frosted effect
- **Shadow**: `var(--ot-shadow-transport)` — subtle top-edge light line
- **Layout**: See [Section 4.4](#44-transport-bar) for full spec
- **z-index**: 50 (above Stage scroll content)

---

## 4. Core Views

### 4.1 Launch / Empty State

When no project is active, the entire Stage shows the empty state. This is Overtone's
first impression — it should feel like entering a studio, not reading a brochure.

**Layout**:
```
┌────────────────────────────────────────────┐
│                                            │
│         (ambient waveform animation)       │
│                                            │
│              O V E R T O N E               │
│         AI Music Creation Studio           │
│                                            │
│     ┌──────────────────────────────┐       │
│     │     Start New Session        │       │
│     └──────────────────────────────┘       │
│                                            │
│    ⌘N  New Session    ⌘O  Open Recent      │
│                                            │
│         Readiness: ● Runtime  ● Realm      │
│                    ● Music    ● Text       │
│                                            │
└────────────────────────────────────────────┘
```

**Visual Elements**:

- **Ambient Waveform**: A low-opacity, slowly undulating waveform across the full width
  at vertical center. Uses sine-wave interpolation with `BAR_COUNT: 120`, amplitude
  oscillating between 5-15% of container height. Color: `var(--ot-violet-400)` at 8% opacity.
  Animation: CSS `@keyframes ot-ambient-wave` cycling bar heights over 8s.

- **App Title**: "OVERTONE" in Display size, `letter-spacing: 0.3em`, `text-transform: uppercase`,
  color `var(--ot-text-primary)`. Subtitle in Body size, color `var(--ot-text-tertiary)`.

- **CTA Button**: Primary button variant (see [6.1](#61-buttons)), centered, 200px min-width.

- **Keyboard Hints**: Caption size, monospace for key combos, `var(--ot-text-ghost)`.

- **Readiness Dots**: 4 indicators in a row, each a small circle (6px) with label.
  Green (`--ot-success`) when ready, amber (`--ot-warning`) when degraded,
  red (`--ot-error`) when unavailable, pulsing animation when checking.

**Readiness Indicator Dot**:
```css
.ot-readiness-dot {
  width: 6px;
  height: 6px;
  border-radius: var(--ot-radius-full);
  /* Ready: */ background: var(--ot-success);
  /* Checking: add animation */
}
.ot-readiness-dot--checking {
  animation: ot-pulse 1.5s ease-in-out infinite;
}
```

### 4.2 Compose Panel

The left panel contains all input controls for song creation, organized as
collapsible accordion sections. Only one section is expanded at a time by default
(user can pin multiple open).

**Section Structure**:
```
┌─ Compose Panel ─────────────────────┐
│                                     │
│  ▼ Song Brief                       │
│  ┌─────────────────────────────┐    │
│  │  [freeform idea textarea]   │    │
│  │                             │    │
│  │  ── AI Brief ──             │    │
│  │  Title: ___________         │    │
│  │  Genre: ___________         │    │
│  │  Mood:  ___________         │    │
│  │  Tempo: ___________         │    │
│  │                             │    │
│  │  [✨ Generate Brief]        │    │
│  └─────────────────────────────┘    │
│                                     │
│  ▼ Lyrics                           │
│  ┌─────────────────────────────┐    │
│  │  [lyrics editor textarea]   │    │
│  │  ...                        │    │
│  │                             │    │
│  │  [✨ Generate] [↻ Regen]    │    │
│  └─────────────────────────────┘    │
│                                     │
│  ▶ Generation Controls              │
│  ▶ Iteration                        │
│                                     │
└─────────────────────────────────────┘
```

#### Accordion Header

```
┌─────────────────────────────────────┐
│  ▼  Song Brief                  📌  │
└─────────────────────────────────────┘
```

- **Chevron**: 12px, rotates 90° on collapse, `transition: transform 200ms ease`
- **Title**: Label size, `var(--ot-text-secondary)`, uppercase, `letter-spacing: 0.06em`
- **Pin icon**: Visible on hover, toggles multi-open behavior
- **Border-bottom**: `1px solid var(--ot-surface-5)` when collapsed
- **Section content**: `padding: var(--ot-space-4)`, animated height with `max-height` transition

#### Song Brief Section (F-002)

- **Idea textarea**: 4 rows, `var(--ot-surface-4)` background, Body size,
  placeholder "Describe your song idea..." in `var(--ot-text-ghost)`
- **Brief fields**: Each field is a compact row: Label (Caption, `--ot-text-tertiary`) + Input
  (Label size, `--ot-surface-4` bg). Fields: Title, Genre, Mood, Tempo, Description.
- **Generate Brief button**: Secondary button with sparkle icon prefix
- **Brief status**: When AI is generating, show shimmer placeholder animation over fields

#### Lyrics Section (F-002)

- **Textarea**: min 8 rows, monospace font for lyric alignment, `var(--ot-surface-4)` bg,
  line-height 1.8 for readability
- **Toolbar below textarea**: "Generate Lyrics" (secondary + sparkle), "Regenerate" (tertiary),
  word count in Caption/`--ot-text-ghost`
- **AI streaming indicator**: When streaming, show a blinking cursor `▊` at insertion point

#### Generation Controls Section (F-003)

- **Model selector**: Segmented control or dropdown showing connector name + model
- **Style tags**: Compact input with tag pills. Tags are `--ot-surface-3` bg, `--ot-text-secondary`,
  with × dismiss button
- **Duration**: Numeric input (10–600) with "sec" suffix label, stepped by 10
- **Instrumental toggle**: Compact toggle switch, Label size
- **Generate button**: **Primary** button, full-width within section.
  Label: "Generate" when idle, "Generating..." with spinner when active

#### Iteration Section (F-005)

- **Mode selector**: Segmented control — Extend | Remix | Reference
- **Source**: Dropdown of existing takes + "Upload audio file..." option
- **File picker**: When upload selected, show drop zone:
  dashed border `--ot-surface-5`, Caption text "Drop audio or click to browse"
- **Generate button**: Secondary, changes label by mode: "Extend Take" / "Remix" / "Generate from Reference"

### 4.3 Takes Panel (Output Area)

The right panel shows generated takes in a card grid with comparison, lineage,
and management capabilities.

**Layout Modes**:

| Mode | Trigger | Layout |
|------|---------|--------|
| Grid | Default | 2-column card grid, responsive to panel width |
| Compare | Two takes selected for A/B | Side-by-side split with shared transport |
| Lineage | "Show lineage" action | SVG DAG view (see [5.4](#54-lineage-visualization)) |

#### Take Card

```
┌─────────────────────────────────────────┐
│  ┌───────────────────────────────┐  ★   │
│  │         (mini waveform)       │      │
│  └───────────────────────────────┘      │
│                                         │
│  Take 3 — Midnight Drive         prompt │
│  "melancholic indie folk..."            │
│  ↳ from: Take 1                         │
│                                         │
│  2:34  ·  3:42 PM                       │
│                                         │
│  ─────────────────────────────────────  │
│  ▶ Play   Compare A   Compare B   ···  │
└─────────────────────────────────────────┘
```

**Card Specs**:
- **Container**: `var(--ot-surface-2)` bg, `var(--ot-radius-lg)` corners,
  `1px solid var(--ot-surface-5)` border
- **Hover**: border → `var(--ot-violet-400)` at 30% opacity, shadow → `--ot-shadow-card-hover`
- **Selected**: border → `var(--ot-violet-400)`, left edge 2px accent strip
- **Mini waveform**: 48px height, same bar style as Transport but simplified.
  Uses `--ot-surface-5` for bars, `--ot-violet-400` at 40% for played region.
  No interaction (visual only).
- **Title row**: Title-2 weight, truncated. Origin badge inline (see [6.6](#66-origin-badge)).
  Favorite star top-right.
- **Prompt preview**: Caption size, `--ot-text-tertiary`, 2-line clamp
- **Lineage link**: Micro size, `--ot-text-ghost`, "↳ from: {parent title}".
  Clicking scrolls to parent card.
- **Meta row**: Duration (monospace), timestamp. Caption size.
- **Action bar**: Subtle divider top, Caption size buttons. "▶ Play" selects + plays.
  "Compare A/B" assigns to compare slots. "···" opens context menu.

**Ghost Card (Generation in Progress)**:
When a job is running, a ghost card appears in the grid representing the pending take.

```
┌─────────────────────────────────────────┐
│  ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐     │
│           (pulsing bars)                │
│  └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘     │
│                                         │
│  ░░░░ Generating...              ░░░░   │
│  ████████████░░░░░░░░  42%              │
│                                         │
│  elapsed 0:34                           │
└─────────────────────────────────────────┘
```

- Dashed border `var(--ot-surface-5)`, pulsing opacity `0.4 → 0.8` over 2s
- Waveform area shows animated bars (see [7.2 Generation Progress](#72-generation-progress))
- Progress bar: `--ot-violet-400` fill, `--ot-surface-4` track
- Cancel button appears on hover: "Cancel" in `--ot-error` color

#### A/B Compare View

When two takes are assigned to compare slots, the Takes panel switches layout:

```
┌──────────────────────┬──────────────────────┐
│     Take A           │     Take B           │
│                      │                      │
│  ┌──────────────┐    │  ┌──────────────┐    │
│  │  (waveform)  │    │  │  (waveform)  │    │
│  └──────────────┘    │  └──────────────┘    │
│                      │                      │
│  Take 1 — First Try  │  Take 3 — Remix      │
│  prompt              │  remix                │
│  2:34                │  2:48                 │
│                      │                      │
│  [ ▶ Play A ]        │  [ ▶ Play B ]        │
│                      │                      │
├──────────────────────┴──────────────────────┤
│  ← Previous Pair    [Exit Compare]   Next → │
└─────────────────────────────────────────────┘
```

- Split is 50/50, vertical divider `1px solid var(--ot-surface-5)`
- Active side has violet left-edge accent
- Shared transport bar below plays the focused take
- Keyboard: `1` plays A, `2` plays B, `Esc` exits compare
- Footer bar: `var(--ot-surface-2)` bg, navigation between take pairs

### 4.4 Transport Bar

The Transport Bar is the signature UI element. It is always visible at the bottom,
housing playback controls and the hero waveform visualization.

```
┌────────────────────────────────────────────────────────────────────────────┐
│                                                                            │
│   ┌──┐   Take 3 — Midnight Drive              1:23 / 2:34    [Set ▸][▸ Set] [Clear] │
│   │▶ │   ┌─────────────────────────────────────────────────┐               │
│   └──┘   │█████████████████████████░░░░░░░░░░░░░░░░░░░░░░░│               │
│          │█████████████████████████░░░░░░░░░░░░░░░░░░░░░░░│               │
│          └─────────────────────────────────────────────────┘               │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

**Spec**:
- **Height**: 80px
- **Background**: `.ot-glass` frosted effect
- **Padding**: `0 var(--ot-space-6)`
- **Layout**: `display: flex; align-items: center; gap: var(--ot-space-5);`

**Play Button** (left):
- Size: 44px × 44px circle
- Background: `var(--ot-violet-400)`
- Icon: Play ▶ / Pause ⏸, white, 16px
- Glow: `var(--ot-shadow-glow-violet)` — the "breathing glow" (see [7.1](#71-breathing-play-button))
- Hover: scale 1.05, glow intensifies
- Active: scale 0.95
- Disabled: opacity 0.3, no glow

**Track Info** (between play button and waveform):
- Take title: Label size, `--ot-text-primary`, truncate at 200px
- Time: monospace, Caption size, `--ot-text-secondary`, `tabular-nums`
  Format: `elapsed / total`

**Waveform** (center, flex-1):
- Height: 40px
- Full signature waveform (see [7.1 Custom Waveform](#71-custom-waveform-style))
- Click to seek, drag for scrubbing
- Trim markers shown as vertical lines with handles

**Trim Controls** (right):
- Three text buttons: "Set ▸" (trim start), "▸ Set" (trim end), "Clear"
- Caption size, `--ot-text-tertiary`, hover → `--ot-text-secondary`
- When trim is active, show range in monospace: `0:15 – 2:20`
- Trim region highlighted in waveform with `--ot-violet-400` at 10% bg

**Empty State** (no take selected):
- Play button disabled, no glow
- Waveform area shows flat line at center, 1px, `var(--ot-surface-5)`,
  with text "Select a take to preview" in Caption/`--ot-text-ghost`

### 4.5 Publish Modal (F-007)

Triggered from a "Publish to Realm" action on a selected take. Uses a centered
modal overlay, not a panel swap.

```
┌─────────────────────────────────────────────────┐
│                                                 │
│            Publish to Realm                     │
│                                                 │
│   ┌─────────────────────────────────┐           │
│   │  (selected take mini waveform)  │           │
│   │  Take 3 — Midnight Drive        │           │
│   │  2:34  ·  prompt                │           │
│   └─────────────────────────────────┘           │
│                                                 │
│   Title     [________________________]          │
│   Description                                   │
│             [________________________]          │
│             [________________________]          │
│                                                 │
│   Tags      [indie] [folk] [+ Add tag]          │
│                                                 │
│   ┌─────────────────────────────────┐           │
│   │ ☐ I confirm that all audio      │           │
│   │   material is original or I     │           │
│   │   have rights to publish it.    │           │
│   └─────────────────────────────────┘           │
│                                                 │
│   [Cancel]                   [Publish Now]      │
│                                                 │
└─────────────────────────────────────────────────┘
```

**Modal Specs**:
- **Overlay**: `var(--ot-surface-0)` at 60% opacity + `backdrop-filter: blur(8px)`
- **Container**: `max-width: 520px`, `var(--ot-surface-1)` bg, `--ot-radius-xl` corners,
  `--ot-shadow-panel` shadow
- **Enter animation**: `opacity 0→1 + translateY(8px→0)` over 300ms
- **Exit animation**: `opacity 1→0 + translateY(0→4px)` over 200ms

**Take Preview Card**: Compact card at top showing waveform thumbnail, title,
duration, origin badge. `var(--ot-surface-2)` bg.

**Form Fields**:
- Title: Text input, pre-filled from take title
- Description: Textarea, 3 rows, optional
- Tags: Tag input with pills (same style as Generation Controls tags)

**Provenance Checkbox**: Checkbox + legal text, must be checked to enable Publish.
Checkbox uses `--ot-violet-400` fill when checked.

**Buttons**:
- Cancel: Tertiary button, left-aligned
- Publish Now: Primary button, right-aligned. Disabled until provenance confirmed.
  During upload: shows spinner + "Publishing..."

**Progress States**:
| State | Visual |
|-------|--------|
| Idle | Normal form |
| Uploading | Publish button → spinner + "Uploading audio..." |
| Creating post | Publish button → spinner + "Creating post..." |
| Done | Confetti-like sparkle animation, "Published!" with post link |
| Error | Red border on form, error message below publish button |

---

## 5. Interaction Patterns

### 5.1 Generation Job Visualization

When a music generation job is in progress, the UI provides multi-level feedback:

**Level 1 — Title Bar Activity Line**:
A 2px line at the bottom of the title bar with a sliding gradient animation.
Visible globally without taking focus from the current panel.

**Level 2 — Ghost Take Card**:
A placeholder card in the Takes grid with:
- Dashed border, pulsing opacity
- Animated waveform bars (alternating heights, see [7.2](#72-generation-progress))
- Progress percentage + elapsed time
- Cancel button on hover

**Level 3 — Generate Button State**:
The Generate button in the Compose Panel shows:
- Spinner replacing the text
- Progress bar underneath (if progress is reported)
- Disabled state preventing double-submission

**Level 4 — Transport Bar**:
If no take is selected, the Transport shows the generating job status in place
of the waveform with pulsing bars animation.

### 5.2 Take Browsing & Management

| Action | Trigger | Visual Feedback |
|--------|---------|-----------------|
| Select take | Click card | Border → violet, waveform loads in Transport |
| Play take | Click ▶ in card or Transport | Transport activates, breathing glow starts |
| Favorite | Click star | Star turns amber with bounce animation (see [7.4](#74-micro-interactions)) |
| Rename | Double-click title OR context menu | Inline edit with auto-focus, Enter to confirm, Esc to cancel |
| Discard | Context menu → Discard | Confirm dialog, card fades out + collapses grid gap |
| Compare A | Card action OR drag to A slot | Card gets "A" badge overlay in top-left |
| Compare B | Card action OR drag to B slot | Card gets "B" badge overlay in top-left |
| Exit compare | Esc or "Exit Compare" button | Smooth transition back to grid layout |

### 5.3 Drag & Drop

| Source | Target | Action |
|--------|--------|--------|
| Audio file from Finder | Compose Panel → Iterate → Drop zone | Sets as reference audio |
| Audio file from Finder | Takes Panel (anywhere) | Imports as reference take |
| Take card | Compare A/B slot | Assigns take to compare slot |

**Drop Zone Visual**:
- Idle: Dashed border `var(--ot-surface-5)`, Caption text
- Drag over: Border → `var(--ot-violet-400)`, bg → `var(--ot-violet-400)` at 5%,
  scale 1.02, text → "Drop to add"
- Invalid file: Border → `var(--ot-error)`, text → "Unsupported format"

### 5.4 Lineage Visualization

The lineage view shows the genealogy of takes as a directed acyclic graph (DAG).
Triggered by "Show Lineage" button in the Takes panel header.

**SVG DAG Layout**:
```
    [Take 1: First Try]    ←── prompt (root)
         │
    ┌────┴────┐
    │         │
[Take 2]  [Take 3]         ←── prompt, remix from Take 1
    │
[Take 4]                    ←── extend from Take 2
```

**Node Specs**:
- Each node: `120px × 52px` rounded rect, `var(--ot-surface-2)` bg
- Selected node: Violet border glow
- Title (Label size) + Origin badge (Micro size)
- Edge lines: `stroke: var(--ot-surface-5); stroke-width: 1.5px`
- Edge from selected: `stroke: var(--ot-violet-400); stroke-width: 2px`
- Layout: top-down, Sugiyama algorithm for minimal crossings
- Pan: drag on empty space. Zoom: scroll wheel. Click node → select take.
- Auto-fit: On open, zoom to fit all nodes with 32px padding

### 5.5 Keyboard Shortcuts

| Shortcut | Action | Context |
|----------|--------|---------|
| `Space` | Play / Pause | Global (when not focused on text input) |
| `⌘ N` | New Session | Global |
| `⌘ G` | Generate | When Compose panel active |
| `⌘ ⇧ G` | Regenerate Brief | When Song Brief section active |
| `⌘ P` | Publish | When a take is selected |
| `1` | Play Take A | Compare mode |
| `2` | Play Take B | Compare mode |
| `Esc` | Exit Compare / Close Modal | Compare mode, Modal open |
| `←` / `→` | Seek ±5s | During playback |
| `⇧ ←` / `⇧ →` | Seek ±15s | During playback |
| `⌘ [` / `⌘ ]` | Previous / Next take | Takes panel |
| `F` | Toggle favorite | Take selected |

**Implementation**: Keyboard shortcuts use a global listener on `window` that
checks `event.target` to avoid firing inside text inputs. Display shortcut hints
in tooltips using the Caption font at `--ot-text-ghost`.

### 5.6 Context Menu

Right-click on a Take card opens a native-style context menu:

```
┌───────────────────────┐
│  ▶ Play               │
│  ─────────────────    │
│  ★ Favorite           │
│  ✎ Rename             │
│  ─────────────────    │
│  Compare as A         │
│  Compare as B         │
│  ─────────────────    │
│  Show Lineage         │
│  ─────────────────    │
│  Extend from this     │
│  Remix from this      │
│  ─────────────────    │
│  Publish...           │
│  ─────────────────    │
│  Discard              │
└───────────────────────┘
```

**Menu Specs**:
- Background: `var(--ot-surface-2)`, `--ot-shadow-panel`
- Width: 200px, `--ot-radius-md` corners
- Items: Label size, `--ot-text-secondary`, `var(--ot-space-2) var(--ot-space-4)` padding
- Hover: `var(--ot-surface-3)` bg
- Separator: 1px `var(--ot-surface-5)`, 4px margin vertical
- Destructive items ("Discard"): `var(--ot-error)` text
- Keyboard nav: Arrow keys to move, Enter to select, Esc to close

---

## 6. Component Specifications

### 6.1 Buttons

#### Primary Button

The main CTA button. Used for Generate, Publish, Start Session.

| State | Background | Text | Border | Shadow | Transform |
|-------|-----------|------|--------|--------|-----------|
| Default | `var(--ot-violet-400)` | `#ffffff` | none | `var(--ot-shadow-glow-violet)` | none |
| Hover | `var(--ot-violet-300)` | `#ffffff` | none | glow intensifies ×1.5 | `scale(1.02)` |
| Active | `var(--ot-violet-500)` | `#ffffff` | none | glow dims ×0.5 | `scale(0.98)` |
| Disabled | `var(--ot-surface-4)` | `var(--ot-text-ghost)` | none | none | none |
| Loading | `var(--ot-violet-400)` | spinner + text | none | steady glow | none |

```css
.ot-btn-primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--ot-space-2);
  padding: 10px 20px;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.02em;
  color: #ffffff;
  background: var(--ot-violet-400);
  border: none;
  border-radius: var(--ot-radius-md);
  box-shadow: var(--ot-shadow-glow-violet);
  cursor: pointer;
  transition: all 150ms ease-out;
}
.ot-btn-primary:hover {
  background: var(--ot-violet-300);
  transform: scale(1.02);
  box-shadow: 0 0 28px var(--ot-glow-violet), 0 0 80px var(--ot-glow-violet-soft);
}
.ot-btn-primary:active {
  background: var(--ot-violet-500);
  transform: scale(0.98);
  box-shadow: 0 0 12px var(--ot-glow-violet-soft);
}
.ot-btn-primary:disabled {
  background: var(--ot-surface-4);
  color: var(--ot-text-ghost);
  box-shadow: none;
  cursor: not-allowed;
  transform: none;
}
```

Tailwind equivalent:
```
bg-[--ot-violet-400] text-white px-5 py-2.5 text-xs font-medium tracking-wide
rounded-lg shadow-[--ot-shadow-glow-violet] transition-all duration-150
hover:bg-[--ot-violet-300] hover:scale-[1.02]
active:bg-[--ot-violet-500] active:scale-[0.98]
disabled:bg-[--ot-surface-4] disabled:text-[--ot-text-ghost] disabled:shadow-none
```

#### Secondary Button

Used for Generate Brief, Regenerate, section-level actions.

| State | Background | Text | Border |
|-------|-----------|------|--------|
| Default | `transparent` | `var(--ot-violet-300)` | `1px solid var(--ot-violet-400)` at 30% |
| Hover | `var(--ot-violet-400)` at 10% | `var(--ot-violet-200)` | `1px solid var(--ot-violet-400)` at 50% |
| Active | `var(--ot-violet-400)` at 15% | `var(--ot-violet-100)` | `1px solid var(--ot-violet-400)` at 60% |
| Disabled | `transparent` | `var(--ot-text-ghost)` | `1px solid var(--ot-surface-5)` |

```css
.ot-btn-secondary {
  display: inline-flex;
  align-items: center;
  gap: var(--ot-space-2);
  padding: 8px 16px;
  font-size: 12px;
  font-weight: 500;
  color: var(--ot-violet-300);
  background: transparent;
  border: 1px solid rgba(139, 92, 246, 0.30);
  border-radius: var(--ot-radius-md);
  cursor: pointer;
  transition: all 150ms ease-out;
}
.ot-btn-secondary:hover {
  background: rgba(139, 92, 246, 0.10);
  border-color: rgba(139, 92, 246, 0.50);
  color: var(--ot-violet-200);
}
```

#### Tertiary Button

Used for Cancel, Clear, minor actions.

| State | Background | Text |
|-------|-----------|------|
| Default | `transparent` | `var(--ot-text-secondary)` |
| Hover | `var(--ot-surface-3)` | `var(--ot-text-primary)` |
| Active | `var(--ot-surface-4)` | `var(--ot-text-primary)` |

```css
.ot-btn-tertiary {
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 400;
  color: var(--ot-text-secondary);
  background: transparent;
  border: none;
  border-radius: var(--ot-radius-md);
  cursor: pointer;
  transition: all 150ms ease-out;
}
.ot-btn-tertiary:hover {
  background: var(--ot-surface-3);
  color: var(--ot-text-primary);
}
```

#### Icon Button

Used for star/favorite, close, settings, overflow menu.

| State | Background | Icon Color |
|-------|-----------|------------|
| Default | `transparent` | `var(--ot-text-tertiary)` |
| Hover | `var(--ot-surface-3)` | `var(--ot-text-secondary)` |
| Active | `var(--ot-surface-4)` | `var(--ot-text-primary)` |

```css
.ot-btn-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--ot-radius-md);
  color: var(--ot-text-tertiary);
  background: transparent;
  border: none;
  cursor: pointer;
  transition: all 150ms ease-out;
}
.ot-btn-icon:hover {
  background: var(--ot-surface-3);
  color: var(--ot-text-secondary);
}
```

### 6.2 Text Input

```css
.ot-input {
  width: 100%;
  padding: 8px 12px;
  font-size: 14px;
  font-family: inherit;
  color: var(--ot-text-primary);
  background: var(--ot-surface-4);
  border: 1px solid var(--ot-surface-5);
  border-radius: var(--ot-radius-md);
  outline: none;
  transition: border-color 150ms ease-out, box-shadow 150ms ease-out;
}
.ot-input::placeholder {
  color: var(--ot-text-ghost);
}
.ot-input:focus {
  border-color: var(--ot-violet-400);
  box-shadow: 0 0 0 2px var(--ot-surface-0), 0 0 0 4px rgba(139, 92, 246, 0.25);
}
.ot-input:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.ot-input--error {
  border-color: var(--ot-error);
  box-shadow: 0 0 0 2px var(--ot-surface-0), 0 0 0 4px rgba(248, 113, 113, 0.20);
}
```

**Textarea variant**: Same as input but with `resize: vertical; min-height: 80px;`

### 6.3 Segmented Control

Used for Iteration mode selector, layout mode toggles.

```
┌──────────┬──────────┬───────────┐
│  Extend  │  Remix   │ Reference │
└──────────┴──────────┴───────────┘
```

```css
.ot-segmented {
  display: inline-flex;
  background: var(--ot-surface-3);
  border-radius: var(--ot-radius-md);
  padding: 2px;
  gap: 2px;
}
.ot-segmented__item {
  padding: 6px 14px;
  font-size: 12px;
  font-weight: 500;
  color: var(--ot-text-tertiary);
  border-radius: calc(var(--ot-radius-md) - 2px);
  cursor: pointer;
  transition: all 150ms ease-out;
  background: transparent;
  border: none;
}
.ot-segmented__item:hover {
  color: var(--ot-text-secondary);
}
.ot-segmented__item--active {
  background: var(--ot-surface-1);
  color: var(--ot-text-primary);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
}
```

### 6.4 Take Card (Component Detail)

Full CSS spec for the take card component:

```css
.ot-take-card {
  position: relative;
  background: var(--ot-surface-2);
  border: 1px solid var(--ot-surface-5);
  border-radius: var(--ot-radius-lg);
  overflow: hidden;
  transition: border-color 150ms ease-out, box-shadow 200ms ease-out;
  cursor: pointer;
}
.ot-take-card:hover {
  border-color: rgba(139, 92, 246, 0.30);
  box-shadow: var(--ot-shadow-card-hover);
}
.ot-take-card--selected {
  border-color: var(--ot-violet-400);
  box-shadow: 0 0 0 1px var(--ot-violet-400);
}
.ot-take-card--selected::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--ot-violet-400);
}

/* Mini waveform area */
.ot-take-card__waveform {
  height: 48px;
  padding: 8px 12px;
  background: var(--ot-surface-1);
}

/* Card body */
.ot-take-card__body {
  padding: 12px 16px;
}

/* Action bar */
.ot-take-card__actions {
  display: flex;
  gap: var(--ot-space-3);
  padding: 8px 16px;
  border-top: 1px solid var(--ot-surface-5);
}
```

### 6.5 Toggle Switch

Used for Instrumental mode.

```css
.ot-toggle {
  position: relative;
  width: 36px;
  height: 20px;
  background: var(--ot-surface-4);
  border: 1px solid var(--ot-surface-5);
  border-radius: var(--ot-radius-full);
  cursor: pointer;
  transition: background 150ms ease-out, border-color 150ms ease-out;
}
.ot-toggle--on {
  background: var(--ot-violet-400);
  border-color: var(--ot-violet-500);
}
.ot-toggle__thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  background: var(--ot-text-primary);
  border-radius: var(--ot-radius-full);
  transition: transform 200ms cubic-bezier(0.34, 1.56, 0.64, 1);
}
.ot-toggle--on .ot-toggle__thumb {
  transform: translateX(16px);
}
```

### 6.6 Origin Badge

Color-coded pill indicating how a take was created.

| Origin | Background | Text Color | Label |
|--------|-----------|------------|-------|
| `prompt` | `rgba(139, 92, 246, 0.12)` | `var(--ot-violet-300)` | "prompt" |
| `extend` | `rgba(52, 211, 153, 0.12)` | `var(--ot-success)` | "extend" |
| `remix` | `rgba(251, 191, 36, 0.12)` | `var(--ot-warning)` | "remix" |
| `reference` | `rgba(56, 189, 248, 0.12)` | `var(--ot-info)` | "reference" |

```css
.ot-badge-origin {
  display: inline-flex;
  align-items: center;
  padding: 1px 8px;
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.04em;
  border-radius: var(--ot-radius-full);
  text-transform: lowercase;
}
```

### 6.7 Readiness Indicator

A compact status dot used in the title bar and empty state.

```css
.ot-readiness {
  display: inline-flex;
  align-items: center;
  gap: var(--ot-space-2);
}
.ot-readiness__dot {
  width: 6px;
  height: 6px;
  border-radius: var(--ot-radius-full);
  flex-shrink: 0;
}
.ot-readiness__dot--ready    { background: var(--ot-success); }
.ot-readiness__dot--degraded { background: var(--ot-warning); }
.ot-readiness__dot--error    { background: var(--ot-error); }
.ot-readiness__dot--checking {
  background: var(--ot-text-tertiary);
  animation: ot-pulse 1.5s ease-in-out infinite;
}
.ot-readiness__label {
  font-size: 11px;
  color: var(--ot-text-tertiary);
}
```

### 6.8 Progress Bar

Used in generation ghost cards and publish flow.

```css
.ot-progress {
  height: 3px;
  background: var(--ot-surface-4);
  border-radius: var(--ot-radius-full);
  overflow: hidden;
}
.ot-progress__fill {
  height: 100%;
  background: var(--ot-violet-400);
  border-radius: var(--ot-radius-full);
  transition: width 300ms ease-out;
}
.ot-progress__fill--indeterminate {
  width: 40%;
  animation: ot-progress-indeterminate 1.5s ease-in-out infinite;
}
```

### 6.9 Tag Pill

Used in style tags input and publish tags.

```css
.ot-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  font-size: 11px;
  font-weight: 500;
  color: var(--ot-text-secondary);
  background: var(--ot-surface-3);
  border-radius: var(--ot-radius-full);
  border: none;
}
.ot-tag__dismiss {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  font-size: 10px;
  color: var(--ot-text-ghost);
  cursor: pointer;
  border-radius: var(--ot-radius-full);
  transition: all 150ms;
}
.ot-tag__dismiss:hover {
  color: var(--ot-text-primary);
  background: var(--ot-surface-5);
}
```

### 6.10 Tooltip

```css
.ot-tooltip {
  position: absolute;
  padding: 4px 10px;
  font-size: 11px;
  color: var(--ot-text-primary);
  background: var(--ot-surface-3);
  border: 1px solid var(--ot-surface-5);
  border-radius: var(--ot-radius-sm);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  white-space: nowrap;
  pointer-events: none;
  animation: ot-tooltip-in 150ms ease-out;
}
/* Keyboard shortcut hint inside tooltip */
.ot-tooltip__kbd {
  font-family: var(--ot-font-mono);
  font-size: 10px;
  color: var(--ot-text-ghost);
  margin-left: 8px;
}
```

---

## 7. Signature Design Elements

### 7.1 Custom Waveform Style

The waveform is Overtone's visual signature — every design choice here is intentional.

**Bar Style: Rounded-top columns**
- Each bar has `border-radius: 2px 2px 0 0` (rounded top, flat bottom)
- Bar width: `barWidth - 2px` (2px gap between bars)
- Centered vertically (bars grow from center, symmetric top/bottom)
- Minimum bar height: 2px (ensures visibility even for silent passages)

**Color Regions**:
- **Played region**: Gradient fill from `var(--ot-violet-400)` (left) to `var(--ot-violet-300)` (right)
  with a subtle underglow reflection
- **Unplayed region**: `var(--ot-surface-5)` (muted, receding)
- **Playhead**: 2px wide, `var(--ot-text-primary)`, with a small diamond head (4px)

**Underglow Reflection** (played bars only):
Below each played bar, a mirrored bar at 15% opacity creates a "reflection on glass" effect:
```
  ██  ████  ██████  ████  ██      ← played (full color)
  ░░  ░░░░  ░░░░░░  ░░░░  ░░      ← reflection (15% opacity, flipped)
```

Implementation (Canvas 2D):
```javascript
// After drawing the main bar
if (barRatio <= playRatio) {
  // Main bar — violet gradient
  const gradient = ctx.createLinearGradient(0, 0, rect.width, 0);
  gradient.addColorStop(0, '#8b5cf6');     // violet-400
  gradient.addColorStop(1, '#a785ff');     // violet-300
  ctx.fillStyle = gradient;
} else {
  ctx.fillStyle = '#2f354e';               // surface-5
}

// Draw bar with rounded top
drawRoundedBar(ctx, x + 1, yTop, barW - 2, halfH, 2);  // top half
drawRoundedBar(ctx, x + 1, yCenter, barW - 2, halfH, 0); // bottom half (mirrored)

// Reflection (played bars only)
if (barRatio <= playRatio) {
  ctx.globalAlpha = 0.15;
  drawRoundedBar(ctx, x + 1, yCenter + halfH + 2, barW - 2, halfH * 0.6, 0);
  ctx.globalAlpha = 1.0;
}
```

**Trim Region Overlay**:
- Background: `var(--ot-violet-400)` at 8% within trim bounds
- Trim markers: 2px wide vertical lines in `var(--ot-violet-300)` with 8px triangular
  drag handles at top and bottom

### 7.2 Generation Progress Animation

Three coordinated animations during music generation:

#### Animated Ghost Waveform (in Ghost Card)

Fake waveform bars that "build up" from nothing, mimicking the creative process:

```css
@keyframes ot-ghost-bar {
  0%   { height: 4px; opacity: 0.3; }
  50%  { height: var(--bar-target-h); opacity: 0.7; }
  100% { height: 4px; opacity: 0.3; }
}
```

Each bar has a staggered `animation-delay` based on its index:
`animation-delay: calc(var(--bar-index) * 30ms);`

Bars use `var(--ot-violet-400)` at 40% opacity.

#### Diagonal Stripe Scroll (on Progress Bar)

```css
@keyframes ot-stripe-scroll {
  0%   { background-position: 0 0; }
  100% { background-position: 20px 0; }
}

.ot-progress__fill--generating {
  background-image: repeating-linear-gradient(
    -45deg,
    transparent,
    transparent 4px,
    rgba(255, 255, 255, 0.08) 4px,
    rgba(255, 255, 255, 0.08) 8px
  );
  background-size: 20px 20px;
  animation: ot-stripe-scroll 0.8s linear infinite;
}
```

#### Concentric Pulse (optional, on Generate button when active)

A set of concentric circles radiating from the button center:

```css
@keyframes ot-concentric-pulse {
  0%   { transform: scale(0.8); opacity: 0.4; }
  100% { transform: scale(2.5); opacity: 0; }
}

.ot-btn-primary--generating::after {
  content: '';
  position: absolute;
  inset: -4px;
  border-radius: var(--ot-radius-md);
  border: 1px solid var(--ot-violet-400);
  animation: ot-concentric-pulse 2s ease-out infinite;
  pointer-events: none;
}
```

### 7.3 Breathing Play Button

The play button in the Transport Bar has a "breathing" glow that pulses gently
when audio is playing — like a living heartbeat for the music.

```css
@keyframes ot-breathe {
  0%   { box-shadow: 0 0 16px rgba(139, 92, 246, 0.30), 0 0 48px rgba(139, 92, 246, 0.10); }
  50%  { box-shadow: 0 0 24px rgba(139, 92, 246, 0.50), 0 0 64px rgba(139, 92, 246, 0.20); }
  100% { box-shadow: 0 0 16px rgba(139, 92, 246, 0.30), 0 0 48px rgba(139, 92, 246, 0.10); }
}

.ot-play-btn {
  width: 44px;
  height: 44px;
  border-radius: var(--ot-radius-full);
  background: var(--ot-violet-400);
  color: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  cursor: pointer;
  transition: transform 150ms ease-out, background 150ms ease-out;
  box-shadow: var(--ot-shadow-glow-violet);
}
.ot-play-btn--playing {
  animation: ot-breathe 3s ease-in-out infinite;
}
.ot-play-btn:hover {
  transform: scale(1.06);
}
.ot-play-btn:active {
  transform: scale(0.94);
}
.ot-play-btn:disabled {
  background: var(--ot-surface-4);
  box-shadow: none;
  cursor: not-allowed;
  opacity: 0.35;
}
```

### 7.4 Micro-Interactions

#### Favorite Star Bounce

When toggling favorite on, the star scales up and settles with a spring effect:

```css
@keyframes ot-star-bounce {
  0%   { transform: scale(1); }
  30%  { transform: scale(1.4); }
  60%  { transform: scale(0.9); }
  80%  { transform: scale(1.1); }
  100% { transform: scale(1); }
}

.ot-star--just-favorited {
  animation: ot-star-bounce 400ms cubic-bezier(0.34, 1.56, 0.64, 1);
  color: var(--ot-warning);
  filter: drop-shadow(0 0 4px var(--ot-glow-amber));
}
```

#### Focus Halo

When an interactive element receives keyboard focus, a soft violet ring appears:

```css
*:focus-visible {
  outline: none;
  box-shadow: var(--ot-shadow-focus);
}
```

#### Error Shake

When a validation error occurs (e.g., empty required field), the field shakes horizontally:

```css
@keyframes ot-shake {
  0%, 100% { transform: translateX(0); }
  20%      { transform: translateX(-4px); }
  40%      { transform: translateX(4px); }
  60%      { transform: translateX(-3px); }
  80%      { transform: translateX(3px); }
}

.ot-input--shake {
  animation: ot-shake 300ms ease-out;
}
```

#### Card Appear (new take arrives)

When a ghost card resolves into a real take card:

```css
@keyframes ot-card-appear {
  0%   { opacity: 0; transform: translateY(8px) scale(0.97); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}

.ot-take-card--new {
  animation: ot-card-appear 300ms cubic-bezier(0.22, 1, 0.36, 1);
}
```

#### Card Discard (remove take)

```css
@keyframes ot-card-discard {
  0%   { opacity: 1; transform: scale(1); }
  100% { opacity: 0; transform: scale(0.95) translateY(4px); }
}

.ot-take-card--discarding {
  animation: ot-card-discard 200ms ease-out forwards;
  pointer-events: none;
}
```

### 7.5 A/B Compare Transition

When entering compare mode, the grid smoothly morphs into a two-panel split:

```css
@keyframes ot-compare-enter {
  0%   { opacity: 0; }
  100% { opacity: 1; }
}

.ot-compare-view {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1px;
  animation: ot-compare-enter 300ms cubic-bezier(0.22, 1, 0.36, 1);
}
.ot-compare-divider {
  width: 1px;
  background: var(--ot-surface-5);
}
.ot-compare-side--active {
  border-left: 2px solid var(--ot-violet-400);
}
```

---

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
