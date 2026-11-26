import { useEffect, useMemo, useRef, useState } from 'react';
import type { NimiUtopiaResident, NimiUtopiaSnapshot } from '@nimiplatform/sdk/app';
import { HandDrawnChibiActorFigure } from '../components/HandDrawnChibi.js';
import { resolveResidentPresence, type ResidentPresenceSummary } from '../domain/agent-profiles.js';
import type { UtopiaDeclarativeStageV1 } from '../domain/bundle-validator.js';
import { resolveChibiAppearance, type ChibiWardrobeMap } from '../domain/chibi-wardrobe.js';
import { buildPlaceOccupancyBreakdown } from './FallbackJournalStage.js';

type Point2D = Readonly<{ x: number; y: number }>;

type HabitatSpatialTopology = Readonly<{
  readonly courtyards: Readonly<Record<string, Point2D>>;
  readonly walkways: readonly Point2D[];
}>;

const HABITAT_TOPOLOGIES: Readonly<Record<string, HabitatSpatialTopology>> = {
  'nimi.builtin.seaside-island': {
    courtyards: {
      'personal-quarter': { x: 26, y: 66 },
      'bird-hide': { x: 53, y: 22 },
      'tidal-reef': { x: 49, y: 71 },
      'island-deck': { x: 80, y: 56 },
      'boat-workshop': { x: 75, y: 31 },
    },
    walkways: [
      { x: 22, y: 28 },
      { x: 27, y: 42 },
      { x: 33, y: 50 },
      { x: 36, y: 62 },
      { x: 30, y: 74 },
      { x: 25, y: 84 },
      { x: 30, y: 74 },
      { x: 38, y: 61 },
      { x: 46, y: 59 },
      { x: 54, y: 60 },
      { x: 67, y: 58 },
      { x: 75, y: 48 },
      { x: 77, y: 35 },
      { x: 84, y: 30 },
      { x: 76, y: 49 },
      { x: 81, y: 57 },
      { x: 67, y: 58 },
      { x: 55, y: 62 },
      { x: 46, y: 60 },
      { x: 36, y: 34 },
      { x: 45, y: 27 },
      { x: 52, y: 22 },
    ],
  },
  'nimi.builtin.starfield-town': {
    courtyards: {
      'personal-quarter': { x: 25, y: 74 },
      'clocktower-library': { x: 29, y: 39 },
      'bakery-cafe': { x: 38, y: 59 },
      'fountain-plaza': { x: 53, y: 75 },
      'sunlight-greenhouse': { x: 52, y: 35 },
      'brookside-teadeck': { x: 57, y: 47 },
      'windmill-atelier': { x: 73, y: 29 },
      'balloon-meadow': { x: 87, y: 40 },
      'grove-stage': { x: 82, y: 78 },
    },
    walkways: [
      { x: 11, y: 24 },
      { x: 18, y: 42 },
      { x: 26, y: 50 },
      { x: 34, y: 61 },
      { x: 43, y: 69 },
      { x: 52, y: 55 },
      { x: 51, y: 42 },
      { x: 53, y: 62 },
      { x: 46, y: 78 },
      { x: 57, y: 84 },
      { x: 64, y: 72 },
      { x: 62, y: 57 },
      { x: 69, y: 49 },
      { x: 76, y: 42 },
      { x: 74, y: 29 },
      { x: 77, y: 43 },
      { x: 86, y: 42 },
      { x: 82, y: 78 },
    ],
  },
  'nimi.builtin.polar-station': {
    courtyards: {
      'weather-deck': { x: 15, y: 39 },
      'rover-apron': { x: 23, y: 78 },
      'ice-core-vault': { x: 33, y: 65 },
      'observation-window': { x: 52, y: 36 },
      'hydro-garden': { x: 48, y: 79 },
      'geothermal-hearth': { x: 61, y: 58 },
      'radio-comms-room': { x: 71, y: 36 },
      'common-lab': { x: 82, y: 55 },
      'personal-quarter': { x: 83, y: 84 },
    },
    walkways: [
      { x: 22, y: 78 },
      { x: 31, y: 69 },
      { x: 39, y: 65 },
      { x: 48, y: 58 },
      { x: 57, y: 53 },
      { x: 63, y: 61 },
      { x: 57, y: 39 },
      { x: 67, y: 37 },
      { x: 74, y: 45 },
      { x: 81, y: 56 },
      { x: 75, y: 72 },
      { x: 83, y: 83 },
    ],
  },
  'nimi.builtin.cloud-bamboo-abode': {
    courtyards: {
      'cloud-terrace': { x: 15, y: 56 },
      'pine-bell-platform': { x: 28, y: 36 },
      'herb-terrace': { x: 37, y: 82 },
      'waterfall-pavilion': { x: 43, y: 29 },
      'elixir-hearth': { x: 53, y: 56 },
      'bamboo-cloister': { x: 54, y: 76 },
      'craft-scroll-hall': { x: 70, y: 31 },
      'tea-pavilion': { x: 78, y: 58 },
      'personal-quarter': { x: 84, y: 84 },
    },
    walkways: [
      { x: 16, y: 56 },
      { x: 23, y: 46 },
      { x: 28, y: 36 },
      { x: 36, y: 44 },
      { x: 44, y: 56 },
      { x: 41, y: 74 },
      { x: 37, y: 83 },
      { x: 43, y: 68 },
      { x: 50, y: 64 },
      { x: 64, y: 66 },
      { x: 68, y: 75 },
      { x: 76, y: 82 },
      { x: 84, y: 85 },
      { x: 77, y: 64 },
      { x: 69, y: 39 },
    ],
  },
  'creator.autumn-farm': {
    courtyards: {
      'apple-orchard': { x: 15, y: 32 },
      'personal-quarter': { x: 23, y: 82 },
      'hilltop-windmill': { x: 39, y: 33 },
      'watermill-house': { x: 34, y: 76 },
      'pumpkin-glasshouse': { x: 63, y: 33 },
      'grain-courtyard': { x: 58, y: 55 },
      'reed-duck-pond': { x: 81, y: 75 },
      'cider-reading-loft': { x: 75, y: 37 },
      'hearth-barn': { x: 86, y: 64 },
    },
    walkways: [
      { x: 18, y: 42 },
      { x: 27, y: 55 },
      { x: 29, y: 72 },
      { x: 24, y: 84 },
      { x: 34, y: 84 },
      { x: 44, y: 84 },
      { x: 53, y: 82 },
      { x: 58, y: 69 },
      { x: 62, y: 56 },
      { x: 51, y: 46 },
      { x: 64, y: 35 },
      { x: 72, y: 42 },
      { x: 77, y: 62 },
      { x: 86, y: 65 },
    ],
  },
};

const ROAM_THOUGHT_GLYPHS = ['♪ 散步中', '✿ 看看风景', '✦ 吹吹微风', '☁ 闲庭漫步', '🍵 悠然放空'] as const;

function hashHandle(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pickActivityBadgeGlyph(title: string): string {
  if (/茶|煮|汤|饮|炉|火/u.test(title)) return '🍵';
  if (/画|写生|绘|尺|图/u.test(title)) return '🎨';
  if (/书|读|日志|经|整理|核对/u.test(title)) return '📖';
  if (/星|极光|鸟|观|风|雪|云/u.test(title)) return '🔭';
  if (/花|苗|药|果|贝|谷/u.test(title)) return '🌿';
  if (/船|工|网|修/u.test(title)) return '🔨';
  if (/乐|琴|电台|歌/u.test(title)) return '♪';
  return '✦';
}

function resolveTopology(habitatId: string, stage: UtopiaDeclarativeStageV1): HabitatSpatialTopology {
  const preset = HABITAT_TOPOLOGIES[habitatId];
  if (preset) return preset;

  const courtyards: Record<string, Point2D> = {};
  const walkways: Point2D[] = [];
  const sorted = [...stage.anchors].sort((a, b) => a.xPercent - b.xPercent);
  for (const anchor of sorted) {
    const pt = {
      x: Math.max(12, Math.min(88, anchor.xPercent)),
      y: Math.max(20, Math.min(86, anchor.yPercent + 11)),
    };
    courtyards[anchor.targetId] = pt;
    walkways.push(pt);
  }
  if (walkways.length >= 2) {
    walkways.push({ x: 50, y: 62 });
  } else if (walkways.length === 0) {
    walkways.push({ x: 35, y: 60 }, { x: 65, y: 60 });
  }
  return { courtyards, walkways };
}

const PLAZA_OFFSETS: readonly Point2D[] = [
  { x: -3.2, y: -1.4 },
  { x: 3.8, y: 2.4 },
  { x: -5.8, y: 3.2 },
  { x: 5.4, y: -2.6 },
  { x: 0, y: 4.2 },
];

export type ResidentTargetSlot = Readonly<{
  readonly resident: NimiUtopiaResident;
  readonly presence: ResidentPresenceSummary;
  readonly stationary: boolean;
  readonly target: Point2D;
  readonly facing: 'left' | 'right';
  readonly bubbleText: string | null;
  readonly bubbleGlyph: string;
  readonly isSharedPartnerRight: boolean;
  readonly sharedDuoBanner: Readonly<{
    readonly activityLabel: string;
    readonly midX: number;
    readonly midY: number;
  }> | null;
  readonly coPresentHint: boolean;
}>;

export function computeResidentSpatialTargets(
  snapshot: NimiUtopiaSnapshot,
  stage: UtopiaDeclarativeStageV1,
): {
  readonly slots: readonly ResidentTargetSlot[];
  readonly walkways: readonly Point2D[];
} {
  const topology = resolveTopology(snapshot.habitat.habitatId, stage);
  const anchorIds = new Set(stage.anchors.map((a) => a.targetId));

  // Collect exact place assignments strictly from Runtime occupancy & resident.current
  const assignedSlotByHandle = new Map<string, {
    target: Point2D;
    facing: 'left' | 'right';
    bubbleText: string;
    bubbleGlyph: string;
    isSharedPartnerRight: boolean;
    sharedDuoBanner: ResidentTargetSlot['sharedDuoBanner'];
    coPresentHint: boolean;
  }>();

  for (const anchorId of anchorIds) {
    const center = topology.courtyards[anchorId] ?? { x: 50, y: 56 };
    const breakdown = buildPlaceOccupancyBreakdown(anchorId, snapshot);
    let offsetIdx = 0;

    for (const pair of breakdown.sharedPairs) {
      const base = PLAZA_OFFSETS[offsetIdx % PLAZA_OFFSETS.length]!;
      offsetIdx += 1;
      const cx = Math.max(10, Math.min(90, center.x + base.x));
      const cy = Math.max(18, Math.min(89, center.y + base.y));
      const leftPos = { x: Math.max(9, cx - 2.5), y: cy };
      const rightPos = { x: Math.min(91, cx + 2.5), y: cy + 0.3 };

      assignedSlotByHandle.set(pair.initiator.agentHandle, {
        target: leftPos,
        facing: 'right',
        bubbleText: pair.activity.activityLabel,
        bubbleGlyph: '🍵',
        isSharedPartnerRight: false,
        sharedDuoBanner: {
          activityLabel: `${pair.initiator.displayName} · ${pair.recipient.displayName}｜${pair.activity.activityLabel}`,
          midX: cx,
          midY: cy,
        },
        coPresentHint: false,
      });
      assignedSlotByHandle.set(pair.recipient.agentHandle, {
        target: rightPos,
        facing: 'left',
        bubbleText: pair.activity.activityLabel,
        bubbleGlyph: '🍵',
        isSharedPartnerRight: true,
        sharedDuoBanner: null,
        coPresentHint: false,
      });
    }

    const publicCoPresentMultiple =
      anchorId !== 'personal-quarter' && (breakdown.sharedPairs.length + breakdown.independentResidents.length >= 2);
    const publicHandleSet = new Set(breakdown.independentResidents.map((r) => r.agentHandle));
    const singles = [...breakdown.independentResidents, ...breakdown.privateResidents];

    for (const res of singles) {
      const off = PLAZA_OFFSETS[offsetIdx % PLAZA_OFFSETS.length]!;
      offsetIdx += 1;
      const rawTitle = res.current?.title;
      const actTitle = (!rawTitle || rawTitle === 'Activity')
        ? (res.solitary ? '私舍静息' : '日常小憩')
        : rawTitle;
      assignedSlotByHandle.set(res.agentHandle, {
        target: {
          x: Math.max(10, Math.min(90, center.x + off.x)),
          y: Math.max(18, Math.min(89, center.y + off.y)),
        },
        facing: off.x < 0 ? 'right' : 'left',
        bubbleText: actTitle,
        bubbleGlyph: pickActivityBadgeGlyph(actTitle),
        isSharedPartnerRight: false,
        sharedDuoBanner: null,
        coPresentHint: publicCoPresentMultiple && publicHandleSet.has(res.agentHandle),
      });
    }
  }

  const totalUnassigned = Math.max(
    1,
    snapshot.residents.filter((r) => !assignedSlotByHandle.has(r.agentHandle) && !r.solitary).length,
  );
  let roamerIndex = 0;
  const walkways = topology.walkways;
  const slots: ResidentTargetSlot[] = snapshot.residents.map((resident) => {
    const presence = resolveResidentPresence(resident, snapshot);
    const assigned = assignedSlotByHandle.get(resident.agentHandle);

    if (assigned) {
      return {
        resident,
        presence,
        stationary: true,
        target: assigned.target,
        facing: assigned.facing,
        bubbleText: assigned.bubbleText,
        bubbleGlyph: assigned.bubbleGlyph,
        isSharedPartnerRight: assigned.isSharedPartnerRight,
        sharedDuoBanner: assigned.sharedDuoBanner,
        coPresentHint: assigned.coPresentHint,
      };
    }

    if (presence.tone === 'conversing') {
      const wp = walkways[roamerIndex % walkways.length] ?? { x: 50, y: 60 };
      roamerIndex += 1;
      return {
        resident,
        presence,
        stationary: true,
        target: wp,
        facing: 'right',
        bubbleText: '对话或协作中',
        bubbleGlyph: '💬',
        isSharedPartnerRight: false,
        sharedDuoBanner: null,
        coPresentHint: false,
      };
    }

    if (resident.solitary) {
      const quarterCenter = topology.courtyards['personal-quarter'] ?? { x: 23, y: 73 };
      const off = PLAZA_OFFSETS[roamerIndex % PLAZA_OFFSETS.length]!;
      roamerIndex += 1;
      return {
        resident,
        presence,
        stationary: true,
        target: {
          x: Math.max(10, Math.min(90, quarterCenter.x + off.x)),
          y: Math.max(18, Math.min(89, quarterCenter.y + off.y)),
        },
        facing: 'right',
        bubbleText: '安静独处',
        bubbleGlyph: '🍵',
        isSharedPartnerRight: false,
        sharedDuoBanner: null,
        coPresentHint: false,
      };
    }

    // Unscheduled idle companion: illustrative walkway motion without claiming any placeId or fabricating an activity
    const wpIdx = Math.floor(((roamerIndex + 0.5) * walkways.length) / totalUnassigned) % walkways.length;
    const wp = walkways[wpIdx] ?? { x: 50, y: 60 };
    const glyph = ROAM_THOUGHT_GLYPHS[(hashHandle(resident.agentHandle) + roamerIndex) % ROAM_THOUGHT_GLYPHS.length]!;
    roamerIndex += 1;
    return {
      resident,
      presence,
      stationary: false,
      target: wp,
      facing: roamerIndex % 2 === 0 ? 'left' : 'right',
      bubbleText: null,
      bubbleGlyph: glyph,
      isSharedPartnerRight: false,
      sharedDuoBanner: null,
      coPresentHint: false,
    };
  });

  return { slots, walkways };
}

type LiveSpriteMotion = {
  x: number;
  y: number;
  facing: 'left' | 'right';
  walking: boolean;
  wpIndex: number;
  wpStep: 1 | -1;
  pauseTimerSec: number;
  thoughtVisible: boolean;
};

export function LivingResidentsLayer(props: {
  readonly snapshot: NimiUtopiaSnapshot;
  readonly stage: UtopiaDeclarativeStageV1;
  readonly frozen: boolean;
  readonly reducedMotion: boolean;
  readonly selectedResidentHandle: string | null;
  readonly chibiWardrobe?: ChibiWardrobeMap;
  readonly bindingsByHandle?: Readonly<Record<string, string>>;
  readonly liveCoordsRef?: { current: Map<string, Point2D> };
  readonly projectPercent?: (
    xPercent: number,
    yPercent: number,
    offsetX?: string,
    offsetY?: string,
  ) => React.CSSProperties;
  readonly onSelectResident: (resident: NimiUtopiaResident, currentCoords?: Point2D) => void;
}) {
  const {
    snapshot,
    stage,
    frozen,
    reducedMotion,
    selectedResidentHandle,
    chibiWardrobe,
    bindingsByHandle,
    liveCoordsRef,
    projectPercent,
    onSelectResident,
  } = props;

  const { slots, walkways } = useMemo(
    () => computeResidentSpatialTargets(snapshot, stage),
    [snapshot, stage],
  );

  const motionMapRef = useRef<Map<string, LiveSpriteMotion>>(new Map());
  const [, setFrameTick] = useState(0);
  const [reactingHandle, setReactingHandle] = useState<string | null>(null);

  // Sync newly added handles or habitat resets
  useEffect(() => {
    const map = motionMapRef.current;
    const activeHandles = new Set<string>(slots.map((s) => s.resident.agentHandle));
    for (const key of map.keys()) {
      if (!activeHandles.has(key)) map.delete(key);
    }
    slots.forEach((slot, idx) => {
      const handle = slot.resident.agentHandle;
      if (!map.has(handle)) {
        const nearestIdx = walkways.reduce((best, wp, wIdx) => {
          const dBest = Math.hypot(walkways[best]!.x - slot.target.x, walkways[best]!.y - slot.target.y);
          const dCur = Math.hypot(wp.x - slot.target.x, wp.y - slot.target.y);
          return dCur < dBest ? wIdx : best;
        }, 0);
        const stepDir: 1 | -1 = idx % 2 === 0 ? 1 : -1;
        const nextWp = Math.max(0, Math.min(Math.max(0, walkways.length - 1), nearestIdx + stepDir));
        map.set(handle, {
          x: slot.target.x,
          y: slot.target.y,
          facing: slot.facing,
          walking: false,
          wpIndex: nextWp,
          wpStep: stepDir,
          pauseTimerSec: (idx % 3) * 0.4,
          thoughtVisible: idx % 2 === 0,
        });
      }
      const cur = map.get(handle)!;
      liveCoordsRef?.current.set(handle, { x: cur.x, y: cur.y });
    });
  }, [slots, walkways, snapshot.habitatActivationId, liveCoordsRef]);

  // Reset positions cleanly on habitat relocation
  useEffect(() => {
    motionMapRef.current.clear();
  }, [snapshot.habitatActivationId]);

  useEffect(() => {
    if (frozen || reducedMotion || slots.length === 0) return;

    let rafId = 0;
    let lastTs = performance.now();
    let uiAccum = 0;

    const step = (now: number) => {
      const dt = Math.min(0.08, Math.max(0.001, (now - lastTs) / 1000));
      lastTs = now;
      uiAccum += dt;

      const map = motionMapRef.current;
      for (const slot of slots) {
        const handle = slot.resident.agentHandle;
        let state = map.get(handle);
        if (!state) {
          state = {
            x: slot.target.x,
            y: slot.target.y,
            facing: slot.facing,
            walking: false,
            wpIndex: 0,
            wpStep: 1,
            pauseTimerSec: 0,
            thoughtVisible: false,
          };
          map.set(handle, state);
        }

        if (slot.stationary) {
          const dx = slot.target.x - state.x;
          const dy = slot.target.y - state.y;
          const dist = Math.hypot(dx, dy);
          if (dist > 0.25) {
            const speed = 5.4;
            const move = Math.min(dist, speed * dt);
            state.x += (dx / dist) * move;
            state.y += (dy / dist) * move;
            state.facing = dx < -0.05 ? 'left' : (dx > 0.05 ? 'right' : slot.facing);
            state.walking = true;
          } else {
            state.x = slot.target.x;
            state.y = slot.target.y;
            state.facing = slot.facing;
            state.walking = false;
          }
          state.thoughtVisible = true;
        } else if (walkways.length >= 2) {
          if (state.pauseTimerSec > 0) {
            state.pauseTimerSec -= dt;
            state.walking = false;
            state.thoughtVisible = state.pauseTimerSec > 0.6;
          } else {
            const dest = walkways[state.wpIndex % walkways.length]!;
            const dx = dest.x - state.x;
            const dy = dest.y - state.y;
            const dist = Math.hypot(dx, dy);
            const speed = 2.15 + ((hashHandle(handle) % 5) * 0.14);
            if (dist <= 0.35) {
              // Walk smoothly back-and-forth along connected walkway segments (never cutting across roofs)
              let nextIdx = state.wpIndex + state.wpStep;
              if (nextIdx >= walkways.length) {
                state.wpStep = -1;
                nextIdx = Math.max(0, walkways.length - 2);
              } else if (nextIdx < 0) {
                state.wpStep = 1;
                nextIdx = Math.min(walkways.length - 1, 1);
              }
              state.wpIndex = nextIdx;
              state.pauseTimerSec = 2.4 + ((hashHandle(handle) % 4) * 0.85);
              state.walking = false;
              state.thoughtVisible = true;
            } else {
              const move = Math.min(dist, speed * dt);
              state.x += (dx / dist) * move;
              state.y += (dy / dist) * move;
              if (Math.abs(dx) > 0.04) {
                state.facing = dx < 0 ? 'left' : 'right';
              }
              state.walking = true;
              state.thoughtVisible = false;
            }
          }
        }
        liveCoordsRef?.current.set(handle, { x: state.x, y: state.y });
      }

      // 30fps state commit keeps React reconciliation feather-light while CSS smooths sub-frames
      if (uiAccum >= 0.033) {
        uiAccum = 0;
        setFrameTick((n) => (n + 1) & 0xffff);
      }
      rafId = window.requestAnimationFrame(step);
    };

    rafId = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(rafId);
  }, [frozen, reducedMotion, slots, walkways]);

  const handleClickSprite = (slot: ResidentTargetSlot, pos: Point2D, e: React.MouseEvent) => {
    e.stopPropagation();
    setReactingHandle(slot.resident.agentHandle);
    window.setTimeout(() => {
      setReactingHandle((cur) => (cur === slot.resident.agentHandle ? null : cur));
    }, 850);
    onSelectResident(slot.resident, pos);
  };

  return (
    <div className="utopia-living-residents-layer" aria-label="洞天伙伴动态">
      {slots.map((slot, index) => {
        const { resident, presence } = slot;
        const live = motionMapRef.current.get(resident.agentHandle);
        const x = live ? live.x : slot.target.x;
        const y = live ? live.y : slot.target.y;
        const facing = live ? live.facing : slot.facing;
        const walking = Boolean(live?.walking) && !frozen && !reducedMotion;
        const showRoamThought = !slot.stationary && Boolean(live?.thoughtVisible);
        const isSelected = selectedResidentHandle === resident.agentHandle;
        const isReacting = reactingHandle === resident.agentHandle;
        const appearance = resolveChibiAppearance(resident.agentHandle, chibiWardrobe, bindingsByHandle);
        const depthZ = 54 + Math.round(y);

        const actorPos: React.CSSProperties = projectPercent
          ? projectPercent(x, y, '-50%', '-86%')
          : { left: `${x.toFixed(2)}%`, top: `${y.toFixed(2)}%` };
        const duoPos: React.CSSProperties | null = slot.sharedDuoBanner
          ? (projectPercent
            ? projectPercent(slot.sharedDuoBanner.midX, slot.sharedDuoBanner.midY, '-50%', '-74px')
            : { left: `${slot.sharedDuoBanner.midX.toFixed(2)}%`, top: `${slot.sharedDuoBanner.midY.toFixed(2)}%` })
          : null;

        return (
          <div key={resident.agentHandle}>
            {slot.sharedDuoBanner && duoPos && (
              <div
                className="utopia-shared-duo-cloud"
                style={{
                  ...duoPos,
                  zIndex: depthZ + 4,
                }}
              >
                <span className="utopia-duo-notes" aria-hidden="true">♪ ✦</span>
                <span className="utopia-duo-cloud-pill">
                  <span aria-hidden="true">💬</span>
                  <span>{slot.sharedDuoBanner.activityLabel}</span>
                </span>
              </div>
            )}

            <button
              type="button"
              data-utopia-resident-sprite={resident.agentHandle}
              className={[
                'utopia-chibi-actor',
                `tone-${presence.tone}`,
                walking ? 'is-walking' : 'is-idle',
                isSelected ? 'is-selected' : '',
                isReacting ? 'is-reacting' : '',
              ].filter(Boolean).join(' ')}
              style={{
                ...actorPos,
                zIndex: isSelected ? 160 : depthZ,
                '--chibi-delay': `${(index * 0.37).toFixed(2)}s`,
              } as React.CSSProperties}
              aria-label={`${resident.displayName}，${presence.shortLocationOrState}`}
              title={`${resident.displayName} · ${presence.shortLocationOrState}`}
              onClick={(e) => handleClickSprite(slot, { x, y }, e)}
            >
              {/* Speech / Activity / Thought Bubble Above Head */}
              {!slot.isSharedPartnerRight && !slot.sharedDuoBanner && slot.bubbleText && (
                <span className="utopia-chibi-speech-bubble">
                  <span className="utopia-chibi-bubble-glyph" aria-hidden="true">{slot.bubbleGlyph}</span>
                  <span className="utopia-chibi-bubble-label">{slot.bubbleText}</span>
                  {slot.coPresentHint && <em className="utopia-chibi-copresent-dot">偶遇</em>}
                </span>
              )}

              {!slot.stationary && (showRoamThought || isSelected) && (
                <span className={`utopia-chibi-thought-dot ${isSelected ? 'is-expanded' : ''}`}>
                  <span aria-hidden="true">{slot.bubbleGlyph}</span>
                  {isSelected && <span className="utopia-chibi-bubble-label">{presence.shortLocationOrState}</span>}
                </span>
              )}

              {isReacting && (
                <span className="utopia-chibi-sparkle-burst" aria-hidden="true">✦ ♥ ✦</span>
              )}

              {/* Ground Shadow */}
              <span className="utopia-chibi-shadow" aria-hidden="true" />

              {/* Selection Halo on Ground */}
              {isSelected && <span className="utopia-chibi-focus-ring" aria-hidden="true" />}

              {/* Pure Hand-Drawn Chibi Sprite (Customizable / Seeded, Independent of LocalAgent Photo) */}
              <HandDrawnChibiActorFigure
                appearance={appearance}
                facing={facing}
                presenceTone={presence.tone}
              />

              {/* Crisp Storybook Nameplate */}
              <span className="utopia-chibi-nameplate">
                <span className={`utopia-chibi-status-pip is-${presence.tone}`} aria-hidden="true" />
                <span className="utopia-chibi-name-text">{resident.displayName}</span>
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
