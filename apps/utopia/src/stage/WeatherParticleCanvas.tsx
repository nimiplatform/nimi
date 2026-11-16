import { useEffect, useRef } from 'react';
import type { HabitatDaypart, NimiUtopiaActiveEvent } from '@nimiplatform/sdk/app';
import type { UtopiaStageAmbientEffectKind } from '../domain/bundle-validator.js';

export type ActiveAmbientEffect = Readonly<{
  readonly effect: UtopiaStageAmbientEffectKind;
  readonly intensity: 'subtle' | 'moderate';
}>;

type RenderParticleKind =
  | UtopiaStageAmbientEffectKind
  | 'meteor'
  | 'warm-glint'
  | 'acoustic-ring';

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  phase: number;
  kind: RenderParticleKind;
};

type ChimneyEmitter = Readonly<{ xNorm: number; yNorm: number }>;
type WaterRippleSpot = Readonly<{ xNorm: number; yNorm: number }>;

const HABITAT_AMBIENT_PROPS: Readonly<Record<string, {
  readonly chimneys: readonly ChimneyEmitter[];
  readonly ripples: readonly WaterRippleSpot[];
}>> = {
  'nimi.builtin.seaside-island': {
    chimneys: [
      { xNorm: 0.215, yNorm: 0.505 },
      { xNorm: 0.362, yNorm: 0.365 },
      { xNorm: 0.761, yNorm: 0.125 },
    ],
    ripples: [
      { xNorm: 0.45, yNorm: 0.84 },
      { xNorm: 0.78, yNorm: 0.78 },
      { xNorm: 0.88, yNorm: 0.86 },
      { xNorm: 0.39, yNorm: 0.24 },
    ],
  },
  'nimi.builtin.starfield-town': {
    chimneys: [
      { xNorm: 0.425, yNorm: 0.295 },
      { xNorm: 0.048, yNorm: 0.36 },
    ],
    ripples: [
      { xNorm: 0.544, yNorm: 0.72 },
      { xNorm: 0.642, yNorm: 0.36 },
      { xNorm: 0.742, yNorm: 0.56 },
    ],
  },
  'nimi.builtin.polar-station': {
    chimneys: [
      { xNorm: 0.677, yNorm: 0.435 },
      { xNorm: 0.715, yNorm: 0.625 },
      { xNorm: 0.748, yNorm: 0.605 },
    ],
    ripples: [
      { xNorm: 0.715, yNorm: 0.645 },
    ],
  },
  'nimi.builtin.cloud-bamboo-abode': {
    chimneys: [
      { xNorm: 0.644, yNorm: 0.315 },
      { xNorm: 0.542, yNorm: 0.545 },
    ],
    ripples: [
      { xNorm: 0.47, yNorm: 0.34 },
      { xNorm: 0.59, yNorm: 0.88 },
      { xNorm: 0.64, yNorm: 0.84 },
    ],
  },
  'creator.autumn-farm': {
    chimneys: [
      { xNorm: 0.946, yNorm: 0.185 },
      { xNorm: 0.436, yNorm: 0.47 },
      { xNorm: 0.695, yNorm: 0.565 },
    ],
    ripples: [
      { xNorm: 0.51, yNorm: 0.72 },
      { xNorm: 0.73, yNorm: 0.86 },
      { xNorm: 0.78, yNorm: 0.83 },
    ],
  },
};

function drawAmbientProps(
  ctx: CanvasRenderingContext2D,
  habitatId: string | undefined,
  width: number,
  height: number,
  timeSec: number,
): void {
  const props = habitatId ? HABITAT_AMBIENT_PROPS[habitatId] : undefined;
  if (!props) return;

  // 1. Soft rising hand-drawn chimney smoke puffs
  for (let cIdx = 0; cIdx < props.chimneys.length; cIdx++) {
    const ch = props.chimneys[cIdx]!;
    for (let i = 0; i < 4; i++) {
      const cycle = ((timeSec * 0.28 + i * 0.25 + cIdx * 0.4) % 1);
      const px = ch.xNorm * width + Math.sin(cycle * Math.PI * 2 + i) * 7 + cycle * 11;
      const py = ch.yNorm * height - cycle * 44;
      const radius = 5 + cycle * 13;
      const alpha = Math.sin(cycle * Math.PI) * 0.34;
      ctx.save();
      ctx.fillStyle = `rgba(255, 252, 244, ${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // 2. Gentle expanding isometric water rings
  for (let rIdx = 0; rIdx < props.ripples.length; rIdx++) {
    const rp = props.ripples[rIdx]!;
    const cycle = ((timeSec * 0.34 + rIdx * 0.37) % 1);
    const rx = 8 + cycle * 28;
    const ry = rx * 0.48;
    const alpha = Math.sin(cycle * Math.PI) * 0.38;
    ctx.save();
    ctx.strokeStyle = `rgba(255, 255, 255, ${alpha.toFixed(3)})`;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.ellipse(rp.xNorm * width, rp.yNorm * height, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

const MAX_PARTICLES = 112;

function expandEffectsWithScenery(
  effects: readonly ActiveAmbientEffect[],
  sceneryEvents: readonly NimiUtopiaActiveEvent[] | undefined,
  daypart: HabitatDaypart | undefined,
): { kind: RenderParticleKind; intensity: 'subtle' | 'moderate' }[] {
  const merged: { kind: RenderParticleKind; intensity: 'subtle' | 'moderate' }[] = effects.map((e) => ({
    kind: e.effect,
    intensity: e.intensity,
  }));

  const hasKind = (k: RenderParticleKind) => merged.some((m) => m.kind === k);

  for (const ev of sceneryEvents ?? []) {
    switch (ev.sceneryKind) {
      case 'meteor-shower':
        if (!hasKind('meteor')) merged.push({ kind: 'meteor', intensity: 'moderate' });
        if (!hasKind('starlight')) merged.push({ kind: 'starlight', intensity: 'subtle' });
        break;
      case 'aurora':
        if (!hasKind('aurora-glow')) merged.push({ kind: 'aurora-glow', intensity: 'moderate' });
        break;
      case 'blossom':
        if (!hasKind('falling-petals')) merged.push({ kind: 'falling-petals', intensity: 'moderate' });
        break;
      case 'snowfall':
        if (!hasKind('snowfall')) merged.push({ kind: 'snowfall', intensity: 'moderate' });
        break;
      case 'rain':
        if (!hasKind('raindrops')) merged.push({ kind: 'raindrops', intensity: 'moderate' });
        break;
      case 'mist':
        if (!hasKind('spirit-mist')) merged.push({ kind: 'spirit-mist', intensity: 'subtle' });
        break;
      case 'hearth-lit':
      case 'harvest':
      case 'tide-pooling':
      case 'wildlife-visit':
        if (!hasKind('warm-glint')) merged.push({ kind: 'warm-glint', intensity: 'subtle' });
        break;
      case 'radio-signal':
        if (!hasKind('acoustic-ring')) merged.push({ kind: 'acoustic-ring', intensity: 'subtle' });
        break;
      default:
        break;
    }
  }

  if ((daypart === 'morning' || daypart === 'dusk') && !hasKind('warm-glint') && !hasKind('raindrops')) {
    merged.push({ kind: 'warm-glint', intensity: 'subtle' });
  }

  return merged;
}

function createParticlesForEffects(
  items: readonly { kind: RenderParticleKind; intensity: 'subtle' | 'moderate' }[],
  width: number,
  height: number,
): Particle[] {
  if (items.length === 0 || width <= 0 || height <= 0) return [];
  const list: Particle[] = [];
  let seed = 4219;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };

  for (const item of items) {
    let count = item.intensity === 'moderate' ? 30 : 16;
    if (item.kind === 'aurora-glow') count = item.intensity === 'moderate' ? 4 : 2;
    else if (item.kind === 'meteor') count = 6;
    else if (item.kind === 'acoustic-ring') count = 3;
    else if (item.kind === 'warm-glint') count = 14;

    for (let i = 0; i < count && list.length < MAX_PARTICLES; i++) {
      const r1 = rand();
      const r2 = rand();
      const r3 = rand();
      switch (item.kind) {
        case 'snowfall':
          list.push({
            x: r1 * width,
            y: r2 * height,
            vx: item.intensity === 'moderate' ? -1.3 - r3 * 1.0 : -0.2 + (r3 - 0.5) * 0.4,
            vy: item.intensity === 'moderate' ? 1.45 + r3 * 1.15 : 0.52 + r3 * 0.48,
            size: 1.8 + r3 * 2.6,
            alpha: 0.52 + r3 * 0.38,
            phase: r1 * Math.PI * 2,
            kind: item.kind,
          });
          break;
        case 'raindrops':
          list.push({
            x: r1 * width,
            y: r2 * height,
            vx: -1.25,
            vy: 5.4 + r3 * 2.8,
            size: 9 + r3 * 7,
            alpha: 0.34 + r3 * 0.24,
            phase: r2 * Math.PI * 2,
            kind: item.kind,
          });
          break;
        case 'falling-petals':
          list.push({
            x: r1 * width,
            y: r2 * height,
            vx: 0.42 + r3 * 0.38,
            vy: 0.42 + r3 * 0.42,
            size: 2.8 + r3 * 2.4,
            alpha: 0.62 + r3 * 0.28,
            phase: r1 * Math.PI * 2,
            kind: item.kind,
          });
          break;
        case 'sea-breeze':
        case 'spirit-mist':
          list.push({
            x: r1 * width,
            y: (0.18 + r2 * 0.66) * height,
            vx: 0.25 + r3 * 0.24,
            vy: (r3 - 0.5) * 0.06,
            size: item.kind === 'spirit-mist' ? 34 + r3 * 28 : 2.1 + r3 * 1.6,
            alpha: item.kind === 'spirit-mist' ? 0.085 + r3 * 0.06 : 0.34 + r3 * 0.24,
            phase: r1 * Math.PI * 2,
            kind: item.kind,
          });
          break;
        case 'aurora-glow':
          list.push({
            x: (0.16 + i * 0.24) * width,
            y: (0.12 + (i % 2) * 0.08) * height,
            vx: 0.1,
            vy: 0,
            size: width * 0.36,
            alpha: item.intensity === 'moderate' ? 0.18 : 0.11,
            phase: i * 1.5,
            kind: item.kind,
          });
          break;
        case 'starlight':
          list.push({
            x: r1 * width,
            y: r2 * height * 0.46,
            vx: 0,
            vy: 0,
            size: 1.3 + r3 * 1.6,
            alpha: 0.38 + r3 * 0.48,
            phase: r1 * Math.PI * 2,
            kind: item.kind,
          });
          break;
        case 'meteor':
          list.push({
            x: (0.15 + r1 * 0.8) * width,
            y: (0.04 + r2 * 0.32) * height,
            vx: -4.8 - r3 * 2.4,
            vy: 2.2 + r3 * 1.2,
            size: 46 + r3 * 36,
            alpha: 0.85,
            phase: i * 1.9 + r1 * 3,
            kind: 'meteor',
          });
          break;
        case 'warm-glint':
          list.push({
            x: r1 * width,
            y: (0.28 + r2 * 0.62) * height,
            vx: (r3 - 0.5) * 0.22,
            vy: -0.18 - r3 * 0.2,
            size: 1.9 + r3 * 2.1,
            alpha: 0.42 + r3 * 0.36,
            phase: r1 * Math.PI * 2,
            kind: 'warm-glint',
          });
          break;
        case 'acoustic-ring':
          list.push({
            x: (0.62 + (i - 1) * 0.08) * width,
            y: 0.42 * height,
            vx: 0,
            vy: 0,
            size: 18 + i * 16,
            alpha: 0.28,
            phase: i * 2.1,
            kind: 'acoustic-ring',
          });
          break;
      }
    }
  }
  return list;
}

function drawFrame(
  ctx: CanvasRenderingContext2D,
  particles: Particle[],
  habitatId: string | undefined,
  width: number,
  height: number,
  timeSec: number,
  advance: boolean,
): void {
  ctx.clearRect(0, 0, width, height);
  drawAmbientProps(ctx, habitatId, width, height, timeSec);
  for (const p of particles) {
    if (advance && p.kind !== 'meteor' && p.kind !== 'acoustic-ring') {
      p.x += p.vx + (p.kind === 'falling-petals' || p.kind === 'snowfall' || p.kind === 'warm-glint'
        ? Math.sin(timeSec * 1.35 + p.phase) * 0.26
        : 0);
      p.y += p.vy;
      if (p.x > width + 42) p.x = -42;
      if (p.x < -42) p.x = width + 42;
      if (p.y > height + 28) {
        p.y = -20;
        p.x = ((p.x + width * 0.37) % width);
      } else if (p.y < -28) {
        p.y = height + 18;
      }
    }

    ctx.save();
    if (p.kind === 'raindrops') {
      ctx.strokeStyle = `rgba(218, 236, 248, ${p.alpha.toFixed(3)})`;
      ctx.lineWidth = 1.15;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + p.vx * 1.8, p.y + p.size);
      ctx.stroke();
    } else if (p.kind === 'falling-petals') {
      ctx.fillStyle = `rgba(255, 242, 238, ${p.alpha.toFixed(3)})`;
      ctx.translate(p.x, p.y);
      ctx.rotate(Math.sin(timeSec * 1.1 + p.phase) * 0.72);
      ctx.beginPath();
      ctx.ellipse(0, 0, p.size * 1.35, p.size * 0.74, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (p.kind === 'spirit-mist') {
      const grad = ctx.createRadialGradient(p.x, p.y, 2, p.x, p.y, p.size);
      grad.addColorStop(0, `rgba(246, 248, 244, ${p.alpha.toFixed(3)})`);
      grad.addColorStop(1, 'rgba(246, 248, 244, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    } else if (p.kind === 'aurora-glow') {
      const pulse = p.alpha * (0.78 + 0.22 * Math.sin(timeSec * 0.75 + p.phase));
      const swayX = p.x + Math.sin(timeSec * 0.35 + p.phase) * 24;
      const grad = ctx.createRadialGradient(swayX, p.y, 8, swayX, p.y, p.size);
      grad.addColorStop(0, `rgba(88, 238, 188, ${pulse.toFixed(3)})`);
      grad.addColorStop(0.55, `rgba(146, 128, 242, ${(pulse * 0.56).toFixed(3)})`);
      grad.addColorStop(1, 'rgba(88, 238, 188, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(swayX, p.y, p.size, p.size * 0.28, -0.07, 0, Math.PI * 2);
      ctx.fill();
    } else if (p.kind === 'meteor') {
      // Periodic graceful shooting-star cycle so static/frozen & animated both look poetic
      const cycle = advance ? ((timeSec * 0.42 + p.phase) % 3.6) : (p.phase % 1.1);
      if (cycle <= 1.25) {
        const progress = cycle / 1.25;
        const fade = Math.sin(progress * Math.PI);
        const headX = p.x + p.vx * progress * 44;
        const headY = p.y + p.vy * progress * 44;
        const tailX = headX - p.vx * (p.size * 0.24);
        const tailY = headY - p.vy * (p.size * 0.24);
        const grad = ctx.createLinearGradient(headX, headY, tailX, tailY);
        grad.addColorStop(0, `rgba(255, 252, 232, ${(p.alpha * fade).toFixed(3)})`);
        grad.addColorStop(0.4, `rgba(196, 232, 255, ${(p.alpha * fade * 0.55).toFixed(3)})`);
        grad.addColorStop(1, 'rgba(196, 232, 255, 0)');
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.9;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(headX, headY);
        ctx.lineTo(tailX, tailY);
        ctx.stroke();

        ctx.fillStyle = `rgba(255, 253, 240, ${(p.alpha * fade).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(headX, headY, 2.1, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (p.kind === 'warm-glint') {
      const pulse = p.alpha * (0.45 + 0.55 * Math.sin(timeSec * 1.8 + p.phase));
      const grad = ctx.createRadialGradient(p.x, p.y, 0.4, p.x, p.y, p.size * 2.4);
      grad.addColorStop(0, `rgba(255, 236, 172, ${pulse.toFixed(3)})`);
      grad.addColorStop(1, 'rgba(255, 214, 120, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * 2.4, 0, Math.PI * 2);
      ctx.fill();
    } else if (p.kind === 'acoustic-ring') {
      const prog = advance ? ((timeSec * 0.38 + p.phase) % 1) : 0.45;
      const radius = 12 + prog * 56;
      const alpha = p.alpha * (1 - prog);
      ctx.strokeStyle = `rgba(255, 224, 168, ${alpha.toFixed(3)})`;
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      const twinkle = p.kind === 'starlight'
        ? p.alpha * (0.52 + 0.48 * Math.sin(timeSec * 1.9 + p.phase))
        : p.alpha;
      ctx.fillStyle = `rgba(250, 253, 255, ${twinkle.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

export function WeatherParticleCanvas(props: {
  readonly effects: readonly ActiveAmbientEffect[];
  readonly sceneryEvents?: readonly NimiUtopiaActiveEvent[];
  readonly daypart?: HabitatDaypart;
  readonly habitatId?: string;
  readonly frozen: boolean;
  readonly reducedMotion: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = 1024;
    const height = 576;
    canvas.width = width;
    canvas.height = height;

    const expanded = expandEffectsWithScenery(props.effects, props.sceneryEvents, props.daypart);
    const particles = createParticlesForEffects(expanded, width, height);
    const hasAmbientProps = Boolean(props.habitatId && HABITAT_AMBIENT_PROPS[props.habitatId]);
    if (particles.length === 0 && !hasAmbientProps) {
      ctx.clearRect(0, 0, width, height);
      return;
    }

    if (props.frozen || props.reducedMotion) {
      drawFrame(ctx, particles, props.habitatId, width, height, 0.5, false);
      return;
    }

    let rafId = 0;
    let running = true;

    const tick = (nowMs: number) => {
      if (!running) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        rafId = 0;
        return;
      }
      drawFrame(ctx, particles, props.habitatId, width, height, nowMs / 1000, true);
      rafId = globalThis.requestAnimationFrame(tick);
    };

    const handleVisibility = () => {
      if (!running) return;
      if (document.visibilityState === 'visible' && rafId === 0) {
        rafId = globalThis.requestAnimationFrame(tick);
      } else if (document.visibilityState === 'hidden' && rafId !== 0) {
        globalThis.cancelAnimationFrame(rafId);
        rafId = 0;
      }
    };

    if (typeof document === 'undefined' || document.visibilityState === 'visible') {
      rafId = globalThis.requestAnimationFrame(tick);
    }
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      running = false;
      if (rafId !== 0) globalThis.cancelAnimationFrame(rafId);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [props.effects, props.sceneryEvents, props.daypart, props.habitatId, props.frozen, props.reducedMotion]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="utopia-particle-canvas"
    />
  );
}
