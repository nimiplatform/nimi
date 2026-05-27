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
