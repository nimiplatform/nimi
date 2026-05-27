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
