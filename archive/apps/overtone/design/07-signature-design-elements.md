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
