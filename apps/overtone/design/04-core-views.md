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

