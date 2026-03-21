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

