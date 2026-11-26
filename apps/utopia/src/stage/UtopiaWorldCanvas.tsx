import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { HabitatDaypart, NimiUtopiaActiveEvent } from '@nimiplatform/sdk/app';
import type { UtopiaDeclarativeStageV1, UtopiaStageAmbientEffectKind } from '../domain/bundle-validator.js';
import { resolveWorldKineticProps } from '../domain/world-landmarks.js';
import type { ActiveAmbientEffect } from './WeatherParticleCanvas.js';

export type StageCameraState = Readonly<{
  zoom: number;
  panX: number;
  panY: number;
}>;

type StageLayerSpec = UtopiaDeclarativeStageV1['layers'][number];

type RenderParticleKind =
  | UtopiaStageAmbientEffectKind
  | 'meteor'
  | 'warm-glint'
  | 'acoustic-ring';

type WorldParticle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  phase: number;
  kind: RenderParticleKind;
};

type MeadowTuft = Readonly<{
  xNorm: number;
  yNorm: number;
  scale: number;
  phase: number;
  flowerColor: string | null;
  iceCrystal?: boolean;
}>;

const WORLD_BASE_W = 1920;
const MAX_PARTICLES = 120;

const HABITAT_AMBIENT_SPOTS: Readonly<Record<string, {
  readonly chimneys: readonly { xNorm: number; yNorm: number }[];
  readonly waters: readonly { xNorm: number; yNorm: number; span: number }[];
  readonly meadowZones: readonly { xMin: number; xMax: number; yMin: number; yMax: number; count: number; ice?: boolean }[];
}>> = {
  'nimi.builtin.seaside-island': {
    chimneys: [
      { xNorm: 0.215, yNorm: 0.505 },
      { xNorm: 0.362, yNorm: 0.365 },
      { xNorm: 0.761, yNorm: 0.125 },
    ],
    waters: [
      { xNorm: 0.45, yNorm: 0.84, span: 1.1 },
      { xNorm: 0.62, yNorm: 0.89, span: 1.2 },
      { xNorm: 0.78, yNorm: 0.78, span: 1.0 },
      { xNorm: 0.88, yNorm: 0.86, span: 1.15 },
      { xNorm: 0.39, yNorm: 0.24, span: 0.75 },
    ],
    meadowZones: [
      { xMin: 0.10, xMax: 0.22, yMin: 0.56, yMax: 0.74, count: 10 },
      { xMin: 0.44, xMax: 0.66, yMin: 0.30, yMax: 0.44, count: 10 },
      { xMin: 0.63, xMax: 0.74, yMin: 0.54, yMax: 0.66, count: 8 },
    ],
  },
  'nimi.builtin.starfield-town': {
    chimneys: [
      { xNorm: 0.425, yNorm: 0.295 },
      { xNorm: 0.048, yNorm: 0.36 },
    ],
    waters: [
      { xNorm: 0.544, yNorm: 0.72, span: 0.85 },
      { xNorm: 0.642, yNorm: 0.36, span: 0.9 },
      { xNorm: 0.742, yNorm: 0.56, span: 0.95 },
    ],
    meadowZones: [
      { xMin: 0.06, xMax: 0.20, yMin: 0.70, yMax: 0.86, count: 12 },
      { xMin: 0.26, xMax: 0.42, yMin: 0.68, yMax: 0.84, count: 10 },
      { xMin: 0.78, xMax: 0.94, yMin: 0.28, yMax: 0.48, count: 12 },
    ],
  },
  'nimi.builtin.polar-station': {
    chimneys: [
      { xNorm: 0.677, yNorm: 0.435 },
      { xNorm: 0.715, yNorm: 0.625 },
      { xNorm: 0.748, yNorm: 0.605 },
    ],
    waters: [
      { xNorm: 0.715, yNorm: 0.645, span: 0.72 },
    ],
    meadowZones: [
      { xMin: 0.08, xMax: 0.32, yMin: 0.58, yMax: 0.86, count: 14, ice: true },
      { xMin: 0.56, xMax: 0.82, yMin: 0.72, yMax: 0.90, count: 12, ice: true },
    ],
  },
  'nimi.builtin.cloud-bamboo-abode': {
    chimneys: [
      { xNorm: 0.644, yNorm: 0.315 },
      { xNorm: 0.542, yNorm: 0.545 },
    ],
    waters: [
      { xNorm: 0.47, yNorm: 0.34, span: 0.85 },
      { xNorm: 0.59, yNorm: 0.88, span: 1.05 },
      { xNorm: 0.64, yNorm: 0.84, span: 0.95 },
    ],
    meadowZones: [
      { xMin: 0.22, xMax: 0.40, yMin: 0.64, yMax: 0.84, count: 12 },
      { xMin: 0.64, xMax: 0.78, yMin: 0.56, yMax: 0.72, count: 10 },
    ],
  },
  'creator.autumn-farm': {
    chimneys: [
      { xNorm: 0.946, yNorm: 0.185 },
      { xNorm: 0.436, yNorm: 0.47 },
      { xNorm: 0.695, yNorm: 0.565 },
    ],
    waters: [
      { xNorm: 0.51, yNorm: 0.72, span: 0.9 },
      { xNorm: 0.73, yNorm: 0.86, span: 1.05 },
      { xNorm: 0.78, yNorm: 0.83, span: 0.95 },
    ],
    meadowZones: [
      { xMin: 0.18, xMax: 0.34, yMin: 0.34, yMax: 0.52, count: 12 },
      { xMin: 0.48, xMax: 0.68, yMin: 0.62, yMax: 0.78, count: 10 },
      { xMin: 0.82, xMax: 0.95, yMin: 0.62, yMax: 0.82, count: 10 },
    ],
  },
};

const FLOWER_PALETTE = ['#FFF8DF', '#F7B299', '#FCE08B', '#F4C6D7', null, null] as const;

function buildMeadowTufts(habitatId: string): readonly MeadowTuft[] {
  const cfg = HABITAT_AMBIENT_SPOTS[habitatId];
  if (!cfg) return [];
  let seed = 9187;
  for (let i = 0; i < habitatId.length; i++) {
    seed = ((seed * 33) ^ habitatId.charCodeAt(i)) >>> 0;
  }
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };
  const out: MeadowTuft[] = [];
  for (const zone of cfg.meadowZones) {
    for (let i = 0; i < zone.count; i++) {
      const r1 = rand();
      const r2 = rand();
      const r3 = rand();
      const flower = zone.ice ? null : FLOWER_PALETTE[Math.floor(rand() * FLOWER_PALETTE.length)] ?? null;
      out.push({
        xNorm: zone.xMin + r1 * (zone.xMax - zone.xMin),
        yNorm: zone.yMin + r2 * (zone.yMax - zone.yMin),
        scale: 0.82 + r3 * 0.45,
        phase: r1 * Math.PI * 2 + i * 0.6,
        flowerColor: flower,
        iceCrystal: Boolean(zone.ice),
      });
    }
  }
  return out;
}

export type WorldPlaceAnchor = Readonly<{
  readonly targetId: string;
  readonly xPercent: number;
  readonly yPercent: number;
}>;

export function expandEffectsWithScenery(
  effects: readonly ActiveAmbientEffect[],
  sceneryEvents: readonly NimiUtopiaActiveEvent[],
  daypart: HabitatDaypart,
): { kind: RenderParticleKind; intensity: 'subtle' | 'moderate' }[] {
  const merged: { kind: RenderParticleKind; intensity: 'subtle' | 'moderate' }[] = effects.map((e) => ({
    kind: e.effect,
    intensity: e.intensity,
  }));
  const hasKind = (k: RenderParticleKind) => merged.some((m) => m.kind === k);

  // Only habitat-wide scenery (`!ev.placeId`) drives full-canvas weather particles;
  // place-scoped scenery is drawn directly around its target landmark anchor.
  for (const ev of sceneryEvents) {
    if (ev.placeId) continue;
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

function createWorldParticles(
  items: readonly { kind: RenderParticleKind; intensity: 'subtle' | 'moderate' }[],
  worldW: number,
  worldH: number,
): WorldParticle[] {
  if (items.length === 0) return [];
  const list: WorldParticle[] = [];
  let seed = 4219;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };

  for (const item of items) {
    let count = item.intensity === 'moderate' ? 34 : 18;
    if (item.kind === 'aurora-glow') count = item.intensity === 'moderate' ? 4 : 2;
    else if (item.kind === 'meteor') count = 6;
    else if (item.kind === 'acoustic-ring') count = 3;
    else if (item.kind === 'warm-glint') count = 16;

    for (let i = 0; i < count && list.length < MAX_PARTICLES; i++) {
      const r1 = rand();
      const r2 = rand();
      const r3 = rand();
      switch (item.kind) {
        case 'snowfall':
          list.push({
            x: r1 * worldW,
            y: r2 * worldH,
            vx: item.intensity === 'moderate' ? -1.5 - r3 * 1.1 : -0.25 + (r3 - 0.5) * 0.45,
            vy: item.intensity === 'moderate' ? 1.6 + r3 * 1.2 : 0.6 + r3 * 0.52,
            size: 2.2 + r3 * 2.8,
            alpha: 0.56 + r3 * 0.36,
            phase: r1 * Math.PI * 2,
            kind: item.kind,
          });
          break;
        case 'raindrops':
          list.push({
            x: r1 * worldW,
            y: r2 * worldH,
            vx: -1.4,
            vy: 6.2 + r3 * 3.0,
            size: 11 + r3 * 8,
            alpha: 0.36 + r3 * 0.24,
            phase: r2 * Math.PI * 2,
            kind: item.kind,
          });
          break;
        case 'falling-petals':
          list.push({
            x: r1 * worldW,
            y: r2 * worldH,
            vx: 0.48 + r3 * 0.42,
            vy: 0.48 + r3 * 0.45,
            size: 3.1 + r3 * 2.5,
            alpha: 0.66 + r3 * 0.26,
            phase: r1 * Math.PI * 2,
            kind: item.kind,
          });
          break;
        case 'sea-breeze':
        case 'spirit-mist':
          list.push({
            x: r1 * worldW,
            y: (0.16 + r2 * 0.68) * worldH,
            vx: 0.28 + r3 * 0.26,
            vy: (r3 - 0.5) * 0.08,
            size: item.kind === 'spirit-mist' ? 42 + r3 * 34 : 2.3 + r3 * 1.7,
            alpha: item.kind === 'spirit-mist' ? 0.085 + r3 * 0.06 : 0.38 + r3 * 0.24,
            phase: r1 * Math.PI * 2,
            kind: item.kind,
          });
          break;
        case 'aurora-glow':
          list.push({
            x: (0.16 + i * 0.24) * worldW,
            y: (0.12 + (i % 2) * 0.08) * worldH,
            vx: 0.12,
            vy: 0,
            size: worldW * 0.36,
            alpha: item.intensity === 'moderate' ? 0.18 : 0.11,
            phase: i * 1.5,
            kind: item.kind,
          });
          break;
        case 'starlight':
          list.push({
            x: r1 * worldW,
            y: r2 * worldH * 0.46,
            vx: 0,
            vy: 0,
            size: 1.5 + r3 * 1.8,
            alpha: 0.4 + r3 * 0.46,
            phase: r1 * Math.PI * 2,
            kind: item.kind,
          });
          break;
        case 'meteor':
          list.push({
            x: (0.15 + r1 * 0.8) * worldW,
            y: (0.04 + r2 * 0.32) * worldH,
            vx: -5.4 - r3 * 2.6,
            vy: 2.5 + r3 * 1.4,
            size: 54 + r3 * 40,
            alpha: 0.86,
            phase: i * 1.9 + r1 * 3,
            kind: 'meteor',
          });
          break;
        case 'warm-glint':
          list.push({
            x: r1 * worldW,
            y: (0.26 + r2 * 0.64) * worldH,
            vx: (r3 - 0.5) * 0.24,
            vy: -0.2 - r3 * 0.22,
            size: 2.1 + r3 * 2.2,
            alpha: 0.44 + r3 * 0.36,
            phase: r1 * Math.PI * 2,
            kind: 'warm-glint',
          });
          break;
        case 'acoustic-ring':
          list.push({
            x: (0.62 + (i - 1) * 0.08) * worldW,
            y: 0.42 * worldH,
            vx: 0,
            vy: 0,
            size: 24 + i * 26,
            alpha: 0.28,
            phase: i * 1.2,
            kind: 'acoustic-ring',
          });
          break;
      }
    }
  }
  return list;
}

function drawWorldVectorScenery(
  ctx: CanvasRenderingContext2D,
  habitatId: string,
  daypart: HabitatDaypart,
  tufts: readonly MeadowTuft[],
  worldW: number,
  worldH: number,
  timeSec: number,
  animate: boolean,
): void {
  const spots = HABITAT_AMBIENT_SPOTS[habitatId];
  const kinetics = resolveWorldKineticProps(habitatId);
  const t = animate ? timeSec : 1.8;

  // 1. Crisp hand-drawn meadow grass tufts & wildflowers / snow crystals (razor-sharp on zoom!)
  for (let i = 0; i < tufts.length; i++) {
    const tf = tufts[i]!;
    const gx = tf.xNorm * worldW;
    const gy = tf.yNorm * worldH;
    const sway = animate ? Math.sin(t * 1.55 + tf.phase) * 1.6 * tf.scale : 0;

    ctx.save();
    ctx.translate(gx, gy);
    if (tf.iceCrystal) {
      const twinkle = 0.34 + 0.36 * (0.5 + 0.5 * Math.sin(t * 2.1 + tf.phase));
      ctx.strokeStyle = `rgba(235, 248, 255, ${twinkle.toFixed(3)})`;
      ctx.lineWidth = 1.15 * tf.scale;
      ctx.lineCap = 'round';
      const r = 3.2 * tf.scale;
      ctx.beginPath();
      ctx.moveTo(-r, 0);
      ctx.lineTo(r, 0);
      ctx.moveTo(0, -r * 0.85);
      ctx.lineTo(0, r * 0.85);
      ctx.stroke();
    } else {
      ctx.strokeStyle = 'rgba(66, 84, 42, 0.62)';
      ctx.lineWidth = 1.35 * tf.scale;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-2.4 * tf.scale, 0);
      ctx.quadraticCurveTo(-3.2 * tf.scale + sway * 0.5, -4.5 * tf.scale, -4.4 * tf.scale + sway, -7.2 * tf.scale);
      ctx.moveTo(0, 0.5 * tf.scale);
      ctx.quadraticCurveTo(sway * 0.6, -5.2 * tf.scale, 0.4 * tf.scale + sway, -8.6 * tf.scale);
      ctx.moveTo(2.4 * tf.scale, 0);
      ctx.quadraticCurveTo(3.4 * tf.scale + sway * 0.5, -4.2 * tf.scale, 4.6 * tf.scale + sway, -6.8 * tf.scale);
      ctx.stroke();

      if (tf.flowerColor) {
        const fx = 0.5 * tf.scale + sway;
        const fy = -9.1 * tf.scale;
        ctx.fillStyle = tf.flowerColor;
        ctx.strokeStyle = 'rgba(62, 48, 37, 0.68)';
        ctx.lineWidth = 0.95;
        ctx.beginPath();
        ctx.arc(fx, fy, 2.1 * tf.scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  if (spots) {
    // 2. Crisp vector water ripples & hand-drawn sunlight water glints
    for (let wIdx = 0; wIdx < spots.waters.length; wIdx++) {
      const w = spots.waters[wIdx]!;
      const wx = w.xNorm * worldW;
      const wy = w.yNorm * worldH;
      const cycle = ((t * 0.32 + wIdx * 0.37) % 1);
      const rx = (9 + cycle * 30) * w.span;
      const ry = rx * 0.44;
      const alpha = Math.sin(cycle * Math.PI) * 0.42;

      ctx.save();
      ctx.strokeStyle = `rgba(255, 253, 244, ${alpha.toFixed(3)})`;
      ctx.lineWidth = 1.35;
      ctx.beginPath();
      ctx.ellipse(wx, wy, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();

      // Subtle hand-drawn horizontal wave sparkle strokes
      const glintAlpha = 0.28 + 0.32 * (0.5 + 0.5 * Math.sin(t * 2.2 + wIdx * 1.7));
      const drift = Math.sin(t * 0.9 + wIdx) * 8;
      ctx.strokeStyle = `rgba(255, 254, 246, ${glintAlpha.toFixed(3)})`;
      ctx.lineWidth = 1.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(wx - 16 * w.span + drift, wy - 7);
      ctx.lineTo(wx - 5 * w.span + drift, wy - 7);
      ctx.moveTo(wx + 6 * w.span - drift * 0.7, wy + 6);
      ctx.lineTo(wx + 15 * w.span - drift * 0.7, wy + 6);
      ctx.stroke();
      ctx.restore();
    }

    // 3. Soft rising hand-drawn chimney smoke puffs
    for (let cIdx = 0; cIdx < spots.chimneys.length; cIdx++) {
      const ch = spots.chimneys[cIdx]!;
      for (let i = 0; i < 4; i++) {
        const cycle = ((t * 0.26 + i * 0.25 + cIdx * 0.4) % 1);
        const px = ch.xNorm * worldW + Math.sin(cycle * Math.PI * 2 + i) * 7 + cycle * 12;
        const py = ch.yNorm * worldH - cycle * 46;
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
  }

  // 4. Kinetic world landmarks (lighthouse beams, windmill breeze rings, waterwheel spray, gliding birds)
  for (let kIdx = 0; kIdx < kinetics.length; kIdx++) {
    const item = kinetics[kIdx]!;
    const kx = (item.xPercent / 100) * worldW;
    const ky = (item.yPercent / 100) * worldH;

    if (item.kind === 'lighthouse-beam') {
      if (!item.activeDayparts.includes(daypart)) continue;
      const angle = (-4 + Math.sin(t * 0.55 + kIdx) * 18) * (Math.PI / 180);
      ctx.save();
      ctx.translate(kx, ky);
      ctx.rotate(angle);
      const coneGrad = ctx.createLinearGradient(0, 0, 220, 0);
      coneGrad.addColorStop(0, 'rgba(255, 241, 178, 0.46)');
      coneGrad.addColorStop(0.55, 'rgba(255, 226, 138, 0.16)');
      coneGrad.addColorStop(1, 'rgba(255, 226, 138, 0)');
      ctx.fillStyle = coneGrad;
      ctx.beginPath();
      ctx.moveTo(0, -4);
      ctx.lineTo(220, -38);
      ctx.lineTo(220, 38);
      ctx.lineTo(0, 4);
      ctx.closePath();
      ctx.fill();

      const coreGrad = ctx.createRadialGradient(0, 0, 1, 0, 0, 12);
      coreGrad.addColorStop(0, 'rgba(255, 250, 218, 0.96)');
      coreGrad.addColorStop(0.55, 'rgba(246, 186, 76, 0.45)');
      coreGrad.addColorStop(1, 'rgba(246, 186, 76, 0)');
      ctx.fillStyle = coreGrad;
      ctx.beginPath();
      ctx.arc(0, 0, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else if (item.kind === 'windmill-sails') {
      const rot = (t * Math.PI * 2) / Math.max(4, item.durationSec);
      const rOuter = item.sizePx * 0.42;
      const rInner = item.sizePx * 0.28;
      ctx.save();
      ctx.translate(kx, ky);
      ctx.rotate(rot);
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(255, 250, 232, 0.56)';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([11, 18]);
      ctx.beginPath();
      ctx.arc(0, 0, rOuter, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(255, 244, 210, 0.42)';
      ctx.lineWidth = 1.25;
      ctx.setLineDash([7, 15]);
      ctx.beginPath();
      ctx.arc(0, 0, rInner, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    } else if (item.kind === 'waterwheel-rim') {
      const rot = (t * Math.PI * 2) / Math.max(2, item.durationSec);
      const r = item.sizePx * 0.38;
      ctx.save();
      ctx.translate(kx, ky);
      ctx.rotate(rot);
      ctx.strokeStyle = 'rgba(235, 252, 255, 0.72)';
      ctx.lineWidth = 1.9;
      ctx.lineCap = 'round';
      ctx.setLineDash([4, 10]);
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    } else if (item.kind === 'floating-balloon') {
      const bobY = animate ? Math.sin(t * 1.1 + kIdx) * 5 : 0;
      const rad = 34 * item.scale;
      ctx.save();
      const bg = ctx.createRadialGradient(kx, ky + bobY, 2, kx, ky + bobY, rad);
      bg.addColorStop(0, 'rgba(255, 249, 218, 0.34)');
      bg.addColorStop(0.55, 'rgba(255, 236, 184, 0.12)');
      bg.addColorStop(1, 'rgba(255, 236, 184, 0)');
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.arc(kx, ky + bobY, rad, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else if (item.kind === 'gliding-birds') {
      const driftX = animate ? Math.sin(t * 0.42 + kIdx * 1.7) * 22 : 0;
      const driftY = animate ? Math.cos(t * 0.56 + kIdx * 1.3) * 6 : 0;
      const stroke = item.variant === 'crane' ? '#364A42' : '#4A3A2D';
      const fill = item.variant === 'crane' ? 'rgba(255, 254, 248, 0.94)' : 'rgba(255, 252, 242, 0.9)';

      const drawBird = (bx: number, by: number, scale: number, phaseOffset: number) => {
        const flap = animate ? Math.sin(t * 2.8 + phaseOffset) * 3.2 : 0;
        ctx.save();
        ctx.translate(bx, by);
        ctx.scale(scale, scale);
        ctx.fillStyle = fill;
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1.45;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-10, 1 + flap * 0.5);
        ctx.quadraticCurveTo(-5, -6 - flap, 0, 0);
        ctx.quadraticCurveTo(5, -6 - flap, 10, 1 + flap * 0.5);
        ctx.quadraticCurveTo(5, -1.5 - flap * 0.4, 0, 2.5);
        ctx.quadraticCurveTo(-5, -1.5 - flap * 0.4, -10, 1 + flap * 0.5);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      };

      drawBird(kx - item.spanPx * 0.22 + driftX, ky + driftY, 1.0, kIdx);
      drawBird(kx + item.spanPx * 0.24 + driftX, ky + 9 + driftY, 0.78, kIdx + 1.1);
    }
  }
}

function stepAndDrawParticles(
  ctx: CanvasRenderingContext2D,
  particles: WorldParticle[],
  worldW: number,
  worldH: number,
  timeSec: number,
  dtScale: number,
  animate: boolean,
): void {
  for (let idx = 0; idx < particles.length; idx++) {
    const p = particles[idx]!;
    if (animate) {
      p.x += p.vx * dtScale;
      p.y += p.vy * dtScale;

      if (p.kind === 'snowfall' || p.kind === 'falling-petals') {
        p.x += Math.sin(timeSec * 1.4 + p.phase) * 0.34 * dtScale;
      } else if (p.kind === 'warm-glint') {
        p.x += Math.sin(timeSec * 1.1 + p.phase) * 0.24 * dtScale;
      }

      if (p.kind === 'meteor') {
        if (p.x < -120 || p.y > worldH * 0.74) {
          p.x = worldW * (0.35 + ((idx * 19) % 60) / 100);
          p.y = -30 - (idx * 24);
        }
      } else {
        if (p.y > worldH + 24) {
          p.y = -16;
          p.x = (p.x + worldW * 0.37) % worldW;
        }
        if (p.y < -24) p.y = worldH + 14;
        if (p.x > worldW + 44) p.x = -34;
        if (p.x < -44) p.x = worldW + 34;
      }
    }

    ctx.save();
    if (p.kind === 'snowfall') {
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    } else if (p.kind === 'raindrops') {
      ctx.globalAlpha = p.alpha;
      ctx.strokeStyle = 'rgba(214, 232, 248, 0.88)';
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + p.vx * 1.4, p.y + p.size);
      ctx.stroke();
    } else if (p.kind === 'falling-petals') {
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = '#FFEEF2';
      ctx.strokeStyle = 'rgba(138, 86, 94, 0.42)';
      ctx.lineWidth = 0.8;
      ctx.translate(p.x, p.y);
      ctx.rotate((animate ? timeSec * 0.8 : 0) + p.phase);
      ctx.beginPath();
      ctx.ellipse(0, 0, p.size, p.size * 0.56, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (p.kind === 'sea-breeze') {
      ctx.globalAlpha = p.alpha * (0.65 + 0.35 * Math.sin(timeSec * 1.5 + p.phase));
      ctx.fillStyle = '#FFFBEA';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    } else if (p.kind === 'spirit-mist') {
      const grad = ctx.createRadialGradient(p.x, p.y, 1, p.x, p.y, p.size);
      grad.addColorStop(0, `rgba(244, 250, 247, ${p.alpha})`);
      grad.addColorStop(1, 'rgba(244, 250, 247, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    } else if (p.kind === 'aurora-glow') {
      const pulse = 0.76 + 0.24 * Math.sin(timeSec * 0.65 + p.phase);
      const grad = ctx.createRadialGradient(p.x, p.y, 8, p.x, p.y, p.size);
      grad.addColorStop(0, `rgba(86, 232, 188, ${(p.alpha * pulse).toFixed(3)})`);
      grad.addColorStop(0.55, `rgba(116, 152, 242, ${(p.alpha * 0.58 * pulse).toFixed(3)})`);
      grad.addColorStop(1, 'rgba(86, 232, 188, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, p.size, p.size * 0.42, -0.12, 0, Math.PI * 2);
      ctx.fill();
    } else if (p.kind === 'starlight') {
      const twinkle = 0.35 + 0.65 * Math.abs(Math.sin(timeSec * 1.2 + p.phase));
      ctx.globalAlpha = p.alpha * twinkle;
      ctx.fillStyle = '#FFFDF5';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    } else if (p.kind === 'meteor') {
      const tailX = p.x + p.size;
      const tailY = p.y - p.size * 0.46;
      const grad = ctx.createLinearGradient(p.x, p.y, tailX, tailY);
      grad.addColorStop(0, 'rgba(255, 252, 235, 0.95)');
      grad.addColorStop(0.35, 'rgba(186, 228, 255, 0.55)');
      grad.addColorStop(1, 'rgba(186, 228, 255, 0)');
      ctx.strokeStyle = grad;
      ctx.lineWidth = 2.0;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(tailX, tailY);
      ctx.stroke();
    } else if (p.kind === 'warm-glint') {
      const glow = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(timeSec * 2.2 + p.phase));
      const grad = ctx.createRadialGradient(p.x, p.y, 0.5, p.x, p.y, p.size * 3.2);
      grad.addColorStop(0, `rgba(255, 238, 170, ${(p.alpha * glow).toFixed(3)})`);
      grad.addColorStop(1, 'rgba(255, 210, 110, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * 3.2, 0, Math.PI * 2);
      ctx.fill();
    } else if (p.kind === 'acoustic-ring') {
      const cycle = ((timeSec * 0.45 + p.phase) % 1);
      const radius = 14 + cycle * p.size * 2.2;
      ctx.globalAlpha = (1 - cycle) * p.alpha;
      ctx.strokeStyle = 'rgba(246, 226, 175, 0.72)';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function drawDaypartAndVignette(
  ctx: CanvasRenderingContext2D,
  vw: number,
  vh: number,
  daypart: HabitatDaypart,
  frameMotif: string,
): void {
  if (daypart === 'morning') {
    const g = ctx.createLinearGradient(0, 0, 0, vh);
    g.addColorStop(0, 'rgba(255, 240, 198, 0.11)');
    g.addColorStop(1, 'rgba(255, 250, 240, 0.01)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, vw, vh);
  } else if (daypart === 'dusk') {
    const g = ctx.createLinearGradient(0, 0, 0, vh);
    g.addColorStop(0, 'rgba(242, 152, 98, 0.14)');
    g.addColorStop(1, 'rgba(96, 70, 118, 0.09)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, vw, vh);
  } else if (daypart === 'night') {
    const g = ctx.createLinearGradient(0, 0, 0, vh);
    if (frameMotif === 'industrial-cutaway') {
      g.addColorStop(0, 'rgba(8, 16, 34, 0.08)');
      g.addColorStop(1, 'rgba(12, 22, 42, 0.05)');
    } else {
      g.addColorStop(0, 'rgba(16, 30, 58, 0.24)');
      g.addColorStop(1, 'rgba(18, 32, 58, 0.15)');
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, vw, vh);
  }

  const maxR = Math.hypot(vw, vh) * 0.56;
  const vig = ctx.createRadialGradient(vw / 2, vh / 2, maxR * 0.66, vw / 2, vh / 2, maxR);
  vig.addColorStop(0, 'rgba(28, 22, 16, 0)');
  vig.addColorStop(1, 'rgba(28, 22, 16, 0.14)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, vw, vh);
}

function drawPlaceScopedSceneryEvents(
  ctx: CanvasRenderingContext2D,
  sceneryEvents: readonly NimiUtopiaActiveEvent[],
  anchors: readonly WorldPlaceAnchor[] | undefined,
  worldW: number,
  worldH: number,
  timeSec: number,
  animate: boolean,
): void {
  if (!anchors || anchors.length === 0) return;
  const scoped = sceneryEvents.filter((ev) => Boolean(ev.placeId));
  if (scoped.length === 0) return;

  const anchorMap = new Map<string, WorldPlaceAnchor>(anchors.map((a) => [a.targetId, a]));

  for (let idx = 0; idx < scoped.length; idx++) {
    const ev = scoped[idx]!;
    if (!ev.placeId) continue;
    const anchor = anchorMap.get(ev.placeId);
    if (!anchor) continue;

    const cx = (anchor.xPercent / 100) * worldW;
    const cy = (anchor.yPercent / 100) * worldH;
    const radius = Math.round(worldW * 0.068);
    const pulse = animate ? 0.88 + 0.12 * Math.sin(timeSec * 2.1 + idx * 1.3) : 0.94;

    let innerRgba = 'rgba(255, 224, 150, 0.30)';
    let accentRgba = 'rgba(255, 240, 190, 0.82)';
    switch (ev.sceneryKind) {
      case 'aurora':
      case 'radio-signal':
        innerRgba = 'rgba(130, 236, 210, 0.28)';
        accentRgba = 'rgba(168, 248, 226, 0.85)';
        break;
      case 'blossom':
        innerRgba = 'rgba(250, 190, 206, 0.30)';
        accentRgba = 'rgba(255, 214, 226, 0.88)';
        break;
      case 'meteor-shower':
      case 'snowfall':
      case 'rain':
      case 'mist':
      case 'tide-pooling':
        innerRgba = 'rgba(196, 226, 255, 0.28)';
        accentRgba = 'rgba(226, 242, 255, 0.86)';
        break;
      default:
        break;
    }

    ctx.save();
    const glow = ctx.createRadialGradient(cx, cy, radius * 0.08, cx, cy, radius * pulse);
    glow.addColorStop(0, innerRgba);
    glow.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * pulse, 0, Math.PI * 2);
    ctx.fill();

    if (ev.sceneryKind === 'radio-signal' || ev.sceneryKind === 'tide-pooling') {
      for (let r = 0; r < 2; r++) {
        const phase = animate ? ((timeSec * 0.45 + r * 0.5 + idx * 0.2) % 1) : 0.35 + r * 0.3;
        const ringR = radius * (0.24 + phase * 0.68);
        ctx.strokeStyle = accentRgba;
        ctx.globalAlpha = (1 - phase) * 0.55;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(cx, cy, ringR, ringR * 0.62, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else if (ev.sceneryKind === 'rain') {
      ctx.strokeStyle = accentRgba;
      ctx.lineWidth = 1.8;
      for (let i = 0; i < 10; i++) {
        const phase = animate ? ((timeSec * 1.4 + i * 0.17) % 1) : (i * 0.1);
        const ox = ((i * 37) % 11 - 5) * (radius * 0.13);
        const oy = -radius * 0.45 + phase * radius * 0.9;
        ctx.globalAlpha = Math.sin(phase * Math.PI) * 0.72;
        ctx.beginPath();
        ctx.moveTo(cx + ox, cy + oy);
        ctx.lineTo(cx + ox - 5, cy + oy + 14);
        ctx.stroke();
      }
    } else {
      ctx.fillStyle = accentRgba;
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2 + (animate ? timeSec * 0.38 : 0.2);
        const dist = radius * (0.28 + ((i * 19) % 5) * 0.11);
        const bob = animate ? Math.sin(timeSec * 2.2 + i * 1.1) * 8 : 0;
        const px = cx + Math.cos(angle) * dist;
        const py = cy + Math.sin(angle) * dist * 0.68 + bob;
        ctx.globalAlpha = animate ? 0.42 + 0.38 * (0.5 + 0.5 * Math.sin(timeSec * 2.8 + i)) : 0.65;
        ctx.beginPath();
        ctx.arc(px, py, 2.8 + (i % 2) * 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }
}

export function UtopiaWorldCanvas(props: {
  readonly visibleLayers: readonly StageLayerSpec[];
  readonly assetUrls: Readonly<Record<string, string>>;
  readonly stageCanvasBg: string;
  readonly frameMotif: string;
  readonly aspectNum: number;
  readonly aspectDen: number;
  readonly camera: StageCameraState;
  readonly pointerOffset: Readonly<{ x: number; y: number }>;
  readonly effects: readonly ActiveAmbientEffect[];
  readonly sceneryEvents: readonly NimiUtopiaActiveEvent[];
  readonly anchors?: readonly WorldPlaceAnchor[];
  readonly daypart: HabitatDaypart;
  readonly habitatId: string;
  readonly frozen: boolean;
  readonly reducedMotion: boolean;
}) {
  const {
    visibleLayers,
    assetUrls,
    stageCanvasBg,
    frameMotif,
    aspectNum,
    aspectDen,
    camera,
    pointerOffset,
    effects,
    sceneryEvents,
    anchors,
    daypart,
    habitatId,
    frozen,
    reducedMotion,
  } = props;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const sizeRef = useRef<{ vw: number; vh: number; dpr: number }>({ vw: 0, vh: 0, dpr: 1 });
  const particlesRef = useRef<WorldParticle[]>([]);
  const smoothedPointerRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const worldW = WORLD_BASE_W;
  const worldH = Math.round((WORLD_BASE_W * aspectDen) / aspectNum);
  const animate = !frozen && !reducedMotion;

  const tufts = useMemo(() => buildMeadowTufts(habitatId), [habitatId]);
  const expandedEffects = useMemo(
    () => expandEffectsWithScenery(effects, sceneryEvents, daypart),
    [effects, sceneryEvents, daypart],
  );

  // Keep latest render inputs accessible inside rAF without restarting loop on pan/zoom
  const latestRef = useRef({
    visibleLayers,
    assetUrls,
    stageCanvasBg,
    frameMotif,
    worldW,
    worldH,
    camera,
    pointerOffset,
    sceneryEvents,
    anchors,
    daypart,
    habitatId,
    tufts,
    animate,
  });
  latestRef.current = {
    visibleLayers,
    assetUrls,
    stageCanvasBg,
    frameMotif,
    worldW,
    worldH,
    camera,
    pointerOffset,
    sceneryEvents,
    anchors,
    daypart,
    habitatId,
    tufts,
    animate,
  };

  useEffect(() => {
    particlesRef.current = createWorldParticles(expandedEffects, worldW, worldH);
  }, [expandedEffects, worldW, worldH]);

  const drawFrame = useCallback((timeSec: number, dtScale: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { vw, vh, dpr } = sizeRef.current;
    if (vw <= 0 || vh <= 0) return;

    const cur = latestRef.current;
    const sp = smoothedPointerRef.current;
    const ptrAlpha = cur.animate && dtScale > 0 ? Math.min(1, 0.12 * dtScale) : 0.25;
    sp.x += (cur.pointerOffset.x - sp.x) * ptrAlpha;
    sp.y += (cur.pointerOffset.y - sp.y) * ptrAlpha;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = cur.stageCanvasBg;
    ctx.fillRect(0, 0, vw, vh);

    const coverScale = Math.max(vw / cur.worldW, vh / cur.worldH);
    const worldToCss = coverScale * cur.camera.zoom;
    const txCss = vw / 2 + cur.camera.panX - (cur.worldW / 2) * worldToCss;
    const tyCss = vh / 2 + cur.camera.panY - (cur.worldH / 2) * worldToCss;

    ctx.setTransform(
      worldToCss * dpr,
      0,
      0,
      worldToCss * dpr,
      txCss * dpr,
      tyCss * dpr,
    );
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // 1. Draw 4K raster world map & active weather/tide/aurora/lantern layers
    for (let i = 0; i < cur.visibleLayers.length; i++) {
      const layer = cur.visibleLayers[i]!;
      const url = cur.assetUrls[layer.assetPath];
      if (!url) continue;
      const img = imageCacheRef.current.get(url);
      if (!img || !img.complete || img.naturalWidth <= 0) continue;

      const isLockedMapLayer = layer.zIndex <= 8 || layer.assetPath.includes('aurora');
      const factor = isLockedMapLayer || !cur.animate ? 0 : (layer.parallaxFactor ?? 0);
      if (factor === 0) {
        ctx.drawImage(img, 0, 0, cur.worldW, cur.worldH);
      } else {
        const dx = -sp.x * factor * 12;
        const dy = -sp.y * factor * 8;
        const bleedX = cur.worldW * 0.008;
        const bleedY = cur.worldH * 0.008;
        ctx.drawImage(
          img,
          -bleedX + dx,
          -bleedY + dy,
          cur.worldW + bleedX * 2,
          cur.worldH + bleedY * 2,
        );
      }
    }

    // 2. Draw crisp vector hand-drawn world micro-scenery & kinetic props in world coordinates
    drawWorldVectorScenery(
      ctx,
      cur.habitatId,
      cur.daypart,
      cur.tufts,
      cur.worldW,
      cur.worldH,
      timeSec,
      cur.animate,
    );

    // 2b. Draw localized place-scoped scenery effects anchored strictly to target landmarks
    drawPlaceScopedSceneryEvents(
      ctx,
      cur.sceneryEvents,
      cur.anchors,
      cur.worldW,
      cur.worldH,
      timeSec,
      cur.animate,
    );

    // 3. Draw world-anchored atmospheric & scenery particles
    stepAndDrawParticles(
      ctx,
      particlesRef.current,
      cur.worldW,
      cur.worldH,
      timeSec,
      dtScale,
      cur.animate,
    );

    // 4. Screen-space daypart wash & subtle picture-book vignette
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawDaypartAndVignette(ctx, vw, vh, cur.daypart, cur.frameMotif);
  }, []);

  // Sync backing buffer resolution to exact viewport × Retina DPR (like AI Town's viewport <canvas>)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const syncSize = () => {
      const rect = canvas.getBoundingClientRect();
      const vw = Math.max(1, Math.round(rect.width));
      const vh = Math.max(1, Math.round(rect.height));
      const dpr = Math.max(1.5, Math.min(window.devicePixelRatio || 1, 2.5));
      const physW = Math.max(1, Math.round(vw * dpr));
      const physH = Math.max(1, Math.round(vh * dpr));

      sizeRef.current = { vw, vh, dpr };
      if (canvas.width !== physW || canvas.height !== physH) {
        canvas.width = physW;
        canvas.height = physH;
      }
      drawFrame(performance.now() / 1000, 0);
    };

    syncSize();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(syncSize) : null;
    ro?.observe(canvas);
    window.addEventListener('resize', syncSize);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', syncSize);
    };
  }, [drawFrame]);

  // Preload & decode stage layer images into cache and redraw immediately when ready
  useEffect(() => {
    if (typeof Image === 'undefined') return;
    let cancelled = false;
    const cache = imageCacheRef.current;
    const urls = new Set<string>();
    for (const url of Object.values(assetUrls)) {
      if (url && !/\.(wav|mp3|ogg)(\?|$)/i.test(url)) {
        urls.add(url);
      }
    }

    for (const url of urls) {
      let img = cache.get(url);
      if (!img) {
        img = new Image();
        img.decoding = 'async';
        cache.set(url, img);
        const onReady = () => {
          if (!cancelled) {
            drawFrame(performance.now() / 1000, 0);
          }
        };
        img.onload = onReady;
        img.src = url;
        if (typeof img.decode === 'function') {
          img.decode().then(onReady).catch(() => undefined);
        }
      }
    }
    drawFrame(performance.now() / 1000, 0);
    return () => {
      cancelled = true;
    };
  }, [assetUrls, visibleLayers, drawFrame]);

  // Static redraw on camera/daypart/frozen state changes when animation loop is paused
  useEffect(() => {
    if (animate) return;
    drawFrame(1.8, 0);
  }, [animate, camera, daypart, habitatId, visibleLayers, drawFrame]);

  // Smooth 60fps Retina canvas render loop when active (pauses when tab is hidden)
  useEffect(() => {
    if (!animate) return;
    let rafId = 0;
    let running = true;
    let lastTs = performance.now();

    const tick = (now: number) => {
      if (!running) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        rafId = 0;
        return;
      }
      const dtMs = Math.min(48, Math.max(4, now - lastTs));
      lastTs = now;
      drawFrame(now / 1000, dtMs / 16.667);
      rafId = window.requestAnimationFrame(tick);
    };

    const handleVisibility = () => {
      if (!running) return;
      if (document.visibilityState === 'visible' && rafId === 0) {
        lastTs = performance.now();
        rafId = window.requestAnimationFrame(tick);
      } else if (document.visibilityState === 'hidden' && rafId !== 0) {
        window.cancelAnimationFrame(rafId);
        rafId = 0;
      }
    };

    if (typeof document === 'undefined' || document.visibilityState === 'visible') {
      rafId = window.requestAnimationFrame(tick);
    }
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      running = false;
      if (rafId !== 0) window.cancelAnimationFrame(rafId);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [animate, drawFrame]);

  return (
    <canvas
      ref={canvasRef}
      className="utopia-world-stage-canvas"
      data-utopia-canvas-renderer="retina-2d"
      aria-hidden="true"
    />
  );
}
