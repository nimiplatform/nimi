import { useCallback, useEffect, useRef, useState } from 'react';
import { AppWindow, ArrowDown, Check, Cpu, HardDrive, RefreshCw, Sparkles, X, Zap } from 'lucide-react';
import type { LandingLocale } from '../landing/i18n/locale.js';

// @nimi-authority: rule.nimi.runtime.service-operations.r003
interface SurfaceItem {
  name: string;
  tag: string;
  isFuture?: boolean;
}

interface CorePillar {
  name: string;
  role: string;
}

interface LegacySilo {
  app: string;
  issue1: string;
  issue2: string;
}

export interface PlatformStackStageCopy {
  blueprintSwitchLabel: string;
  blueprintModeNimi: string;
  blueprintModeLegacy: string;
  blueprintTopTierLabel: string;
  blueprintTopTierNote: string;
  blueprintSurfaces: ReadonlyArray<SurfaceItem>;
  blueprintCoreLabel: string;
  blueprintCoreTitle: string;
  blueprintCorePillars: ReadonlyArray<CorePillar>;
  blueprintBottomTierLabel: string;
  blueprintBottomTierNote: string;
  blueprintSubstrates: ReadonlyArray<string>;
  legacyCaption: string;
  legacySilos: ReadonlyArray<LegacySilo>;
  legacySummary: string;
}

type StageStep = 0 | 1 | 2 | 3;

interface ActCopy {
  num: string;
  pillLabel: string;
  pillLabelMobile: string;
  eyebrow: string;
  title: string;
  summary: string;
}

interface StageCopy {
  stepCues: readonly [string, string, string, string];
  step0WindowBadge: string;
  step0SubTag: string;
  step0FloorInvite: string;
  step0FloorInviteMobile: string;
  wallCollisionBadge: string;
  continuityOrbBadge: string;
  hotSwapHintBadge: string;
  cubeLabelsLong: readonly [string, string, string];
  cubeLabelsShort: readonly [string, string, string];
  streamCallouts: readonly [string, string, string];
  silosDesktop: readonly [string, string, string, string];
  silosMobile: readonly [string, string, string, string];
  siloSubTag: string;
  surfacesDesktop: readonly [string, string, string, string, string];
  surfacesMobile: readonly [string, string, string, string, string];
  siloFloorNote: string;
  siloFloorNoteMobile: string;
  gpuClashTitle: string;
  gpuClashTitleMobile: string;
  gpuClashMeter: string;
  coreSettledNote: string;
  coreSettledNoteMobile: string;
  coreTagline: string;
  coreChambers: readonly [
    { id: string; title: string; sub: string },
    { id: string; title: string; sub: string },
    { id: string; title: string; sub: string },
  ];
  coreChambersMobile: readonly [
    { id: string; title: string; sub: string },
    { id: string; title: string; sub: string },
    { id: string; title: string; sub: string },
  ];
  substratesDesktop: readonly [string, string, string];
  substratesMobile: readonly [string, string, string];
  substrateActiveTag: string;
  substrateSwapTag: string;
  substrateVaultTag: string;
  acts: readonly [ActCopy, ActCopy, ActCopy, ActCopy];
}

// 4 Canonical Discrete States:
// 0 (0.00): Screen-1 Compact Everyday Scattered AI Apps (100% fits above the fold, zero truncation)
// 1 (0.34): Screen-2 Full-Screen X-Ray Silo Dilemma (cracked open monoliths + collision walls)
// 2 (0.68): Screen-2 Full-Screen Stack Inversion (bricks extracted into Personal Core)
// 3 (1.00): Screen-2 Full-Screen Continuum & Live Hot-Swappable Compute Engines
const STEP_TARGETS: readonly [number, number, number, number] = [0, 0.34, 0.68, 1];

const STAGE_COPY: Readonly<Record<LandingLocale, StageCopy>> = {
  zh: {
    stepCues: [
      '向下滚动剖开底层 · 1 / 4',
      '继续滚动触发栈反转 · 2 / 4',
      '继续滚动展开全貌 · 3 / 4',
      '继续向下阅读详情 · 4 / 4',
    ],
    step0WindowBadge: '独立进程',
    step0SubTag: '各自独立运行',
    step0FloorInvite: '↓ 向下滚动：剖开这 4 款软件背后的「上下文孤岛」与「本地显卡争抢」',
    step0FloorInviteMobile: '↓ 向下滑动：剖开孤岛与本地抢卡困局',
    wallCollisionBadge: '切窗撞墙 · 上下文瞬间归零',
    continuityOrbBadge: '记忆 100% 跨窗口连续贯通（悬停任意窗口聚焦）',
    hotSwapHintBadge: '点击切换底层活跃引擎 · 上层窗口零感知无损换代',
    cubeLabelsLong: ['独立 API 密钥', '局部上下文碎片', '独立模型进程'],
    cubeLabelsShort: ['密钥', '记忆', '进程'],
    streamCallouts: ['↓ 进程收口统一调度', '↓ 记忆沉淀至 Cognition', '↓ 身份统一至 Realm'],
    silosDesktop: ['搜索研究软件', '音视频创作软件', '日常笔记工具', '网页聊天窗口'],
    silosMobile: ['搜索研究', '影音创作', '日常笔记', '网页聊天'],
    siloSubTag: '孤立黑盒',
    surfacesDesktop: ['Nimi Home', '23 款精选应用', '有声常驻伙伴', '授权网页与手机', '家庭与泛在空间'],
    surfacesMobile: ['Nimi Home', '23 款应用', '有声伙伴', '网页与手机', '空间节点'],
    gpuClashTitle: '⚡ 本机唯一 GPU 与显存池：4 个独立模型进程同时盲目争抢',
    gpuClashTitleMobile: '⚡ 本机唯一显卡：多进程同时盲目抢卡',
    gpuClashMeter: '争抢过载',
    siloFloorNote: '显存爆满闪退 · 算力踩踏卡顿 —— 未来安装的 AI 应用越多，并发冲突越失控',
    siloFloorNoteMobile: '显存冲突闪退 · AI 应用越多越寸步难行',
    coreSettledNote: 'Runtime 单一调度池有序分配显卡 + 记忆跨窗共享 —— 再多 AI 应用同开也丝滑共生',
    coreSettledNoteMobile: '统一调度显卡 + 记忆共享 —— 多应用同开井然有序',
    coreTagline: '算力有序调度、连续记忆与唯一身份合流 —— 窗口变迁，内核始终随行',
    coreChambers: [
      { id: 'runtime', title: 'Runtime · 算力调度内核', sub: '统一编排本地模型租约与 20 项算力，终结并发抢卡' },
      { id: 'cognition', title: 'Cognition · 记忆内核', sub: '跨应用沉淀可溯源、可涂改的本地长期上下文' },
      { id: 'realm', title: 'Realm · 身份与世界网络', sub: '跨终端锚定唯一身份，连接共享世界原语' },
    ],
    coreChambersMobile: [
      { id: 'runtime', title: 'Runtime', sub: '统一模型调度' },
      { id: 'cognition', title: 'Cognition', sub: '本地连续记忆' },
      { id: 'realm', title: 'Realm', sub: '跨端身份与世界' },
    ],
    substratesDesktop: ['本机 Apple Silicon / GPU 引擎', '你自选的云端多模态服务', '本地私有目录存储'],
    substratesMobile: ['本机 GPU', '自选云端', '本地目录'],
    substrateActiveTag: '有序调度中',
    substrateSwapTag: '点击热切换',
    substrateVaultTag: '本机挂载',
    acts: [
      {
        num: '01',
        pillLabel: '日常零散应用',
        pillLabelMobile: '零散应用',
        eyebrow: '01 · 今日传统应用生态',
        title: '桌面上散落着各式 AI 软件，单开一扇窗看似各自安好',
        summary: '搜索、影音、笔记、伴侣……只打开其中一款时似乎并无异样；向下滚动一次，看看多款软件同时运行时底层发生了什么。',
      },
      {
        num: '02',
        pillLabel: '孤岛与抢卡',
        pillLabelMobile: '孤岛抢卡',
        eyebrow: '02 · 孤岛失忆与本地算力踩踏',
        title: '上层记忆老死不相往来，底层模型却在疯抢同一块显卡',
        summary: '每款软件既把上下文锁进黑盒，又各自拉起一套本地模型进程——多应用并发时直接引发显存碰撞与算力踩踏；未来 AI 软件越多，你的电脑越寸步难行。',
      },
      {
        num: '03',
        pillLabel: '栈反转下沉',
        pillLabelMobile: '栈反转',
        eyebrow: '03 · 将软件栈上下反转',
        title: '抽离重复进程与碎片记忆，收口为统一调度的个人内核',
        summary: 'Nimi 将各软件私自启动的模型进程、长期记忆与身份彻底下沉——由 Runtime 统一模型池与硬件租约按序调度，终结并发抢卡。',
      },
      {
        num: '04',
        pillLabel: '万窗同源',
        pillLabelMobile: '万窗同源',
        eyebrow: '04 · 多应用丝滑共生与无损换代',
        title: '十余款应用同开井然有序，底层引擎随时无损热插拔',
        summary: '上层再多应用与终端也只是共享同一内核的轻量视口；底层无论在本机 GPU 与云端服务间如何换代，上层体验丝毫无损。',
      },
    ],
  },
  en: {
    stepCues: [
      'Scroll to X-ray silos · 1 / 4',
      'Scroll to invert stack · 2 / 4',
      'Scroll to expand continuum · 3 / 4',
      'Scroll down for details · 4 / 4',
    ],
    step0WindowBadge: 'Standalone',
    step0SubTag: 'Runs in isolation',
    step0FloorInvite: '↓ Scroll once to X-ray walled-off context & local GPU contention beneath these 4 apps',
    step0FloorInviteMobile: '↓ Swipe up to X-ray silos & GPU clashes',
    wallCollisionBadge: 'Blocked by silo wall · Context resets to 0%',
    continuityOrbBadge: '100% Continuous Context across windows (hover any viewport)',
    hotSwapHintBadge: 'Click a compute engine below to hot-swap live with zero disruption',
    cubeLabelsLong: ['Separate API Key', 'Trapped Context', 'Own Model Process'],
    cubeLabelsShort: ['Key', 'Memory', 'Process'],
    streamCallouts: ['↓ Unified GPU Scheduler', '↓ Context → Cognition', '↓ Identity → Realm'],
    silosDesktop: ['Research App', 'Media Studio', 'Notes Tool', 'Web Chat Tab'],
    silosMobile: ['Research', 'Media', 'Notes', 'Web Chat'],
    siloSubTag: 'Isolated Silo',
    surfacesDesktop: ['Nimi Home Hub', '23 Curated Apps', 'Voiced Companions', 'Web & Mobile', 'Ambient Spaces'],
    surfacesMobile: ['Nimi Home', '23 Apps', 'Companions', 'Web/Mobile', 'Ambient'],
    gpuClashTitle: '⚡ Shared Local GPU & VRAM: 4 Isolated Model Processes Colliding at Once',
    gpuClashTitleMobile: '⚡ One GPU: 4 Processes Colliding at Once',
    gpuClashMeter: 'OVERLOAD',
    siloFloorNote: 'VRAM crashes & thermal stalls — scaling to 10+ concurrent AI apps becomes impossible',
    siloFloorNoteMobile: 'VRAM thrashing — more AI apps mean constant stalls',
    coreSettledNote: 'One Runtime scheduler arbitrates GPU leases + shared memory — 20+ AI apps run side by side smoothly',
    coreSettledNoteMobile: 'Scheduled GPU + shared memory — apps coexist cleanly',
    coreTagline: 'Scheduled compute, memory & identity converge — screens change, your core stays yours',
    coreChambers: [
      { id: 'runtime', title: 'Runtime · Compute Scheduler', sub: 'Arbitrates local GPU model leases & 20 capabilities cleanly' },
      { id: 'cognition', title: 'Cognition · Memory Kernel', sub: 'Compounds inspectable local memory across apps' },
      { id: 'realm', title: 'Realm · Identity & Worlds', sub: 'Anchors cross-device identity & shared worlds' },
    ],
    coreChambersMobile: [
      { id: 'runtime', title: 'Runtime', sub: 'GPU scheduler' },
      { id: 'cognition', title: 'Cognition', sub: 'Local memory' },
      { id: 'realm', title: 'Realm', sub: 'Identity & worlds' },
    ],
    substratesDesktop: ['Local Apple silicon / GPU', 'User-chosen Cloud Connectors', 'Local Private Vault'],
    substratesMobile: ['Local GPU', 'Cloud API', 'Local Vault'],
    substrateActiveTag: 'Scheduled',
    substrateSwapTag: 'Click to Swap',
    substrateVaultTag: 'Mounted',
    acts: [
      {
        num: '01',
        pillLabel: 'Scattered Apps',
        pillLabelMobile: 'Apps',
        eyebrow: '01 · Everyday App Landscape',
        title: 'Standalone AI tools look calm when opened one at a time',
        summary: 'Search, studio, notes, companion—each looks harmless alone. Scroll once to see what happens when several run together.',
      },
      {
        num: '02',
        pillLabel: 'Silos & GPU Clash',
        pillLabelMobile: 'Clash',
        eyebrow: '02 · Walled Context & Local GPU Contention',
        title: 'Memories walled off above—while local models fight over one GPU below',
        summary: 'Every app traps context in a silo and spawns its own local model server—triggering VRAM crashes and GPU contention that spiral out of control as AI apps multiply.',
      },
      {
        num: '03',
        pillLabel: 'Stack Inversion',
        pillLabelMobile: 'Invert',
        eyebrow: '03 · Inverting the AI Stack',
        title: 'Pull competing processes and scattered memory into one Personal Core',
        summary: 'Nimi sinks isolated model servers, memory, and identity downward—so Runtime arbitrates local GPU leases and queues without contention.',
      },
      {
        num: '04',
        pillLabel: 'One Continuum',
        pillLabelMobile: 'Continuum',
        eyebrow: '04 · Conflict-Free Coexistence & Hot-Swap',
        title: 'Dozens of lightweight apps coexist smoothly above hot-swappable engines',
        summary: 'Apps and future endpoints become thin viewports over one coordinated core—while local GPUs and cloud engines swap underneath seamlessly.',
      },
    ],
  },
};

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const clamp01 = (v: number) => clamp(v, 0, 1);
const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = clamp01((x - edge0) / Math.max(0.0001, edge1 - edge0));
  return t * t * (3 - 2 * t);
};
const easeGentle = (t: number) => 0.5 * (1 - Math.cos(Math.PI * t));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const WALL_CYCLE_SEC = 3.6;

const FOUR_X_PCT = [0.155, 0.385, 0.615, 0.845] as const;
const STAGGER_Y_PCT = [-0.032, 0.028, -0.018, 0.034] as const;
const FIVE_X_PCT = [0.125, 0.3125, 0.5, 0.6875, 0.875] as const;
const THREE_SUB_X_PCT = [0.205, 0.5, 0.795] as const;

export function computePlatformStageProgress(
  containerTop: number,
  stickyTop: number,
  travel: number,
): number {
  if (travel <= 0) return 0;
  return clamp01((stickyTop - containerTop) / travel);
}

export function resolvePlatformStageStep(progress: number): StageStep {
  if (progress < 0.17) return 0;
  if (progress < 0.51) return 1;
  if (progress < 0.84) return 2;
  return 3;
}

function readIsDarkScheme(): boolean {
  if (typeof document === 'undefined') return false;
  return (
    document.documentElement.dataset.nimiScheme === 'dark'
    || document.documentElement.classList.contains('dark')
  );
}

function drawRoundedSlab(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  depth: number,
  topFill: string | CanvasGradient,
  sideFill: string | CanvasGradient,
  strokeColor: string,
  dashed = false,
) {
  if (depth > 0.5) {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y + depth, w, h, r);
    ctx.fillStyle = sideFill;
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  if (dashed) ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = topFill;
  ctx.fill();
  ctx.lineWidth = 1.25;
  ctx.strokeStyle = strokeColor;
  ctx.stroke();
  ctx.restore();
}

// Draws miniature everyday app chrome + UI skeleton inside each Step-0 window
function drawEverydayAppChrome(
  ctx: CanvasRenderingContext2D,
  idx: number,
  x: number,
  y: number,
  w: number,
  h: number,
  alpha: number,
  badgeText: string,
  compact: boolean,
  isDark: boolean,
) {
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = alpha;

  // Clip to window interior
  ctx.beginPath();
  ctx.roundRect(x + 1, y + 1, w - 2, h - 2, 14);
  ctx.clip();

  // Top titlebar strip
  const barH = Math.max(22, h * 0.15);
  ctx.fillStyle = isDark ? '#111827' : '#f8fafc';
  ctx.fillRect(x, y, w, barH);
  ctx.strokeStyle = isDark ? 'rgba(148, 163, 184, 0.2)' : '#e2e8f0';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y + barH);
  ctx.lineTo(x + w, y + barH);
  ctx.stroke();

  // Traffic-light window dots
  const dotColors = ['#fda4af', '#fcd34d', '#6ee7b7'] as const;
  dotColors.forEach((c, dIdx) => {
    ctx.beginPath();
    ctx.arc(x + 13 + dIdx * 9, y + barH * 0.5, 2.7, 0, Math.PI * 2);
    ctx.fillStyle = c;
    ctx.fill();
  });

  if (!compact) {
    ctx.fillStyle = isDark ? '#94a3b8' : '#64748b';
    ctx.font = '600 9.5px "Inter", "PingFang SC", "Noto Sans SC", sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(badgeText, x + w - 12, y + barH * 0.5 + 0.5);
  }

  // Distinct per-app calm UI skeleton in lower half of window
  const bodyTop = y + h * 0.50;
  const bodyH = h * 0.40;
  const padX = w * 0.10;
  const innerW = w - padX * 2;

  if (idx === 0) {
    // Search App: search bar + 2 result cards
    ctx.fillStyle = isDark ? '#172554' : '#eff6ff';
    ctx.beginPath();
    ctx.roundRect(x + padX, bodyTop, innerW, Math.max(12, bodyH * 0.28), 999);
    ctx.fill();
    ctx.strokeStyle = isDark ? 'rgba(96, 165, 250, 0.35)' : '#bfdbfe';
    ctx.stroke();

    ctx.fillStyle = isDark ? '#1e293b' : '#e2e8f0';
    ctx.beginPath();
    ctx.roundRect(x + padX, bodyTop + bodyH * 0.42, innerW * 0.88, Math.max(8, bodyH * 0.18), 5);
    ctx.roundRect(x + padX, bodyTop + bodyH * 0.68, innerW * 0.68, Math.max(8, bodyH * 0.18), 5);
    ctx.fill();
  } else if (idx === 1) {
    // Media Studio: preview frame + multi-track bars
    ctx.fillStyle = isDark ? '#0f2928' : '#f0fdfa';
    ctx.beginPath();
    ctx.roundRect(x + padX, bodyTop, innerW, Math.max(16, bodyH * 0.46), 7);
    ctx.fill();
    ctx.strokeStyle = isDark ? 'rgba(45, 212, 191, 0.32)' : '#99f6e4';
    ctx.stroke();

    ctx.fillStyle = isDark ? '#1e3a5f' : '#bae6fd';
    ctx.beginPath();
    ctx.roundRect(x + padX, bodyTop + bodyH * 0.58, innerW * 0.72, Math.max(6, bodyH * 0.14), 4);
    ctx.fill();
    ctx.fillStyle = isDark ? '#115e59' : '#a7f3d0';
    ctx.beginPath();
    ctx.roundRect(x + padX + innerW * 0.16, bodyTop + bodyH * 0.78, innerW * 0.76, Math.max(6, bodyH * 0.14), 4);
    ctx.fill();
  } else if (idx === 2) {
    // Notes Tool: document lines
    const rows = [0.92, 0.74, 0.84];
    rows.forEach((rw, rIdx) => {
      ctx.fillStyle = rIdx === 0
        ? (isDark ? '#1e3a5f' : '#dbeafe')
        : (isDark ? '#1e293b' : '#e2e8f0');
      ctx.beginPath();
      ctx.roundRect(x + padX, bodyTop + rIdx * (bodyH * 0.30), innerW * rw, Math.max(8, bodyH * 0.19), 5);
      ctx.fill();
    });
  } else {
    // Web Chat Tab: left & right chat bubbles
    ctx.fillStyle = isDark ? '#1e293b' : '#e2e8f0';
    ctx.beginPath();
    ctx.roundRect(x + padX, bodyTop, innerW * 0.72, Math.max(12, bodyH * 0.34), 8);
    ctx.fill();

    ctx.fillStyle = isDark ? '#1e3a5f' : '#dbeafe';
    ctx.beginPath();
    ctx.roundRect(x + padX + innerW * 0.24, bodyTop + bodyH * 0.46, innerW * 0.76, Math.max(12, bodyH * 0.34), 8);
    ctx.fill();
  }

  ctx.restore();
}

export function PlatformStackStage({
  locale,
  copy,
}: {
  locale: LandingLocale;
  copy: PlatformStackStageCopy;
}) {
  const ui = STAGE_COPY[locale];
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [activeStep, setActiveStep] = useState<StageStep>(0);
  const [displayProgress, setDisplayProgress] = useState(0);
  const [focusedViewport, setFocusedViewport] = useState<number | null>(null);
  const [activeEngine, setActiveEngine] = useState<0 | 1>(0);
  const [activeWallIdxState, setActiveWallIdxState] = useState(0);
  const [isCompactWidth, setIsCompactWidth] = useState(false);

  const stepRef = useRef<StageStep>(0);
  const requestDrawRef = useRef<() => void>(() => {});
  const topLabelRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const canvasSizeRef = useRef({ width: 1080, height: 420 });

  const liveRef = useRef({
    progress: 0,
    tweenFrom: 0,
    tweenTo: 0,
    tweenStart: 0,
    tweenDuration: 0,
    focusedViewport: null as number | null,
    activeEngine: 0 as 0 | 1,
    ui,
    isDark: readIsDarkScheme(),
  });
  liveRef.current.focusedViewport = focusedViewport;
  liveRef.current.activeEngine = activeEngine;
  liveRef.current.ui = ui;

  const getStickyMetrics = useCallback(() => {
    if (typeof window === 'undefined') return null;
    const containerEl = containerRef.current;
    const stageEl = stageRef.current;
    if (!containerEl || !stageEl) return null;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const parsedTop = Number.parseFloat(window.getComputedStyle(stageEl).top);
    const stickyTop = Number.isFinite(parsedTop) ? parsedTop : 82;
    const travel = containerEl.offsetHeight - stageEl.offsetHeight;
    const isStickyActive = !reduced && window.innerWidth > 980 && travel > 40;
    return { containerEl, stageEl, stickyTop, travel, isStickyActive, reduced };
  }, []);

  // Jumps to a discrete step via native smooth scroll (sticky desktop) or immediate/tweened draw (reduced-motion / compact)
  const commitStep = useCallback(
    (nextStep: StageStep) => {
      stepRef.current = nextStep;
      setActiveStep(nextStep);

      const target = STEP_TARGETS[nextStep];
      const metrics = getStickyMetrics();

      if (metrics?.isStickyActive) {
        const containerDocTop = metrics.containerEl.getBoundingClientRect().top + window.scrollY;
        const targetScrollY = Math.max(
          0,
          Math.round(containerDocTop - metrics.stickyTop + target * metrics.travel),
        );
        window.scrollTo({ top: targetScrollY, behavior: 'smooth' });
        requestDrawRef.current();
        return;
      }

      const reduced =
        metrics?.reduced
        ?? (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      const cur = liveRef.current.progress;
      const distance = Math.abs(target - cur);
      const duration = reduced || distance < 0.005 ? 0 : distance > 0.45 ? 820 : 580;

      liveRef.current.tweenFrom = cur;
      liveRef.current.tweenTo = target;
      liveRef.current.tweenStart = typeof performance !== 'undefined' ? performance.now() : 0;
      liveRef.current.tweenDuration = duration;

      if (duration === 0) {
        liveRef.current.progress = target;
        setDisplayProgress(target);
      }
      requestDrawRef.current();
    },
    [getStickyMetrics],
  );

  // Passive native scroll-driven progression (zero wheel/touch interception)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let scrollRaf = 0;

    const syncFromScroll = () => {
      scrollRaf = 0;
      const metrics = getStickyMetrics();
      if (!metrics?.isStickyActive) return;

      const p = computePlatformStageProgress(
        metrics.containerEl.getBoundingClientRect().top,
        metrics.stickyTop,
        metrics.travel,
      );
      liveRef.current.tweenDuration = 0;
      liveRef.current.tweenFrom = p;
      liveRef.current.tweenTo = p;
      liveRef.current.progress = p;

      const nextStep = resolvePlatformStageStep(p);
      if (nextStep !== stepRef.current) {
        stepRef.current = nextStep;
        setActiveStep(nextStep);
      }
      requestDrawRef.current();
    };

    const scheduleSync = () => {
      if (!scrollRaf) scrollRaf = window.requestAnimationFrame(syncFromScroll);
    };

    const onResize = () => {
      setIsCompactWidth(window.innerWidth <= 980);
      scheduleSync();
      requestDrawRef.current();
    };

    onResize();
    const settleId = window.setTimeout(syncFromScroll, 80);

    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', scheduleSync, { passive: true });

    return () => {
      window.clearTimeout(settleId);
      window.cancelAnimationFrame(scrollRaf);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', scheduleSync);
    };
  }, [getStickyMetrics]);

  // Gentle auto-toggle of bottom engine in Step 3
  const userPickedEngineRef = useRef(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const engineTimer = window.setInterval(() => {
      if (!userPickedEngineRef.current && stepRef.current === 3) {
        setActiveEngine((prev) => (prev === 0 ? 1 : 0));
      }
    }, 6200);
    return () => {
      window.clearInterval(engineTimer);
    };
  }, []);

  useEffect(() => {
    requestDrawRef.current();
  }, [activeEngine, focusedViewport, ui]);

  // Full-Width 2.5D Canvas Renderer + Synchronized Frame Unfolding (Step 0 -> Step 1..3)
  useEffect(() => {
    const canvas = canvasRef.current;
    const frameEl = frameRef.current;
    if (!canvas || !frameEl || typeof window === 'undefined') return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

    let rafId = 0;
    let isVisible = true;
    let lastSyncedDomP = -1;
    let lastSyncedWallIdx = 0;
    const startTime = performance.now();

    const syncTopLabelTransforms = (p: number, cssW: number, cssH: number) => {
      const tXrayDomNow = smoothstep(0.03, 0.31, p);
      const tInvertDomNow = smoothstep(0.37, 0.63, p);
      for (let idx = 0; idx < 5; idx += 1) {
        const el = topLabelRefs.current[idx];
        if (!el) continue;
        const isFifth = idx === 4;
        const opacity = isFifth ? smoothstep(0.74, 0.92, p) : 1;
        const leftPct = isFifth
          ? FIVE_X_PCT[4]
          : lerp(FOUR_X_PCT[idx]!, FIVE_X_PCT[idx]!, tInvertDomNow);
        const step0TopPct = 0.33 + (isFifth ? 0 : STAGGER_Y_PCT[idx]!);
        const topPct = isFifth
          ? 0.175
          : lerp(lerp(step0TopPct, 0.196, tXrayDomNow), 0.175, tInvertDomNow);
        const xPx = Math.round(leftPct * cssW * 10) / 10;
        const yPx = Math.round(topPct * cssH * 10) / 10;
        el.style.transform = `translate3d(${xPx}px, ${yPx}px, 0) translate(-50%, -50%)`;
        el.style.opacity = String(opacity);
        el.style.pointerEvents = opacity > 0.4 ? 'auto' : 'none';
      }
    };

    const updateCachedCanvasSize = () => {
      const rect = canvas.getBoundingClientRect();
      const compact = window.innerWidth <= 980;
      canvasSizeRef.current = {
        width: Math.max(300, rect.width || (compact ? 360 : 1080)),
        height: Math.max(220, rect.height || (compact ? 270 : 420)),
      };
    };
    updateCachedCanvasSize();

    const render = (now: number) => {
      rafId = 0;
      const compact = window.innerWidth <= 980;
      const elapsed = reduced.matches ? 1.2 : (now - startTime) / 1000;
      const state = liveRef.current;

      // Advance self-completing discrete state tween
      if (state.tweenDuration > 0) {
        const rawT = clamp01((now - state.tweenStart) / state.tweenDuration);
        const easedT = easeGentle(rawT);
        state.progress = lerp(state.tweenFrom, state.tweenTo, easedT);
        if (rawT >= 1) {
          state.progress = state.tweenTo;
          state.tweenDuration = 0;
        }
      } else {
        state.progress = state.tweenTo;
      }

      const p = state.progress;

      const cssW = canvasSizeRef.current.width;
      const cssH = canvasSizeRef.current.height;
      syncTopLabelTransforms(p, cssW, cssH);

      if (
        Math.abs(p - lastSyncedDomP) > 0.04
        || (state.tweenDuration === 0 && lastSyncedDomP !== p)
      ) {
        lastSyncedDomP = p;
        setDisplayProgress(p);
      }

      const W = compact ? 720 : 1080;
      const H = Math.max(260, Math.round(W * (cssH / cssW)));

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const bw = Math.round(cssW * dpr);
      const bh = Math.round(cssH * dpr);
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
      }
      ctx.setTransform(bw / W, 0, 0, bh / H, 0, 0);

      const curUi = state.ui;
      const isDark = state.isDark;

      // 4-State Choreographed Phase Curves:
      // p = 0.00 (Step 0: Scattered Everyday Apps)
      // p = 0.34 (Step 1: X-Ray Silo Monoliths + Collision Walls)
      // p = 0.68 (Step 2: Stack Inversion -> Personal Core)
      // p = 1.00 (Step 3: 5 Viewports + Hot-Swappable Substrates)
      const tXray = smoothstep(0.03, 0.31, p);
      const tInvert = smoothstep(0.37, 0.63, p);
      const tCore = smoothstep(0.43, 0.65, p);
      const tFlow = smoothstep(0.72, 0.96, p);

      ctx.clearRect(0, 0, W, H);

      // 1. Architectural Drafting Surface (adapts to light & dark color schemes)
      const bgGrad = ctx.createRadialGradient(W * 0.5, H * 0.48, 30, W * 0.5, H * 0.5, W * 0.62);
      bgGrad.addColorStop(0, isDark ? '#111a2c' : '#ffffff');
      bgGrad.addColorStop(1, isDark ? '#0b1220' : '#f1f6fc');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, W, H);

      // Receding 2.5D drafting grid lines
      ctx.save();
      ctx.strokeStyle = isDark ? 'rgba(148, 163, 184, 0.08)' : 'rgba(15, 23, 42, 0.04)';
      ctx.lineWidth = 1;
      for (let i = -9; i <= 9; i += 1) {
        ctx.beginPath();
        ctx.moveTo(W * 0.5 + i * (W * 0.046), 0);
        ctx.lineTo(W * 0.5 + i * (W * 0.072), H);
        ctx.stroke();
      }
      for (let r = 1; r <= 8; r += 1) {
        const gy = (r / 9) * H;
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(W, gy);
        ctx.stroke();
      }
      ctx.restore();

      // 2. Top Tier Geometry
      const fourCenters = FOUR_X_PCT.map((f) => f * W);
      const fiveCenters = FIVE_X_PCT.map((f) => f * W);
      const baseTopY = lerp(lerp(H * 0.155, H * 0.132, tXray), H * 0.105, tInvert);
      const topH = lerp(lerp(H * 0.54, H * 0.495, tXray), H * 0.14, tInvert);
      const topW = lerp(lerp(W * 0.194, W * 0.20, tXray), W * 0.168, tInvert);
      const topDepth = lerp(lerp(7, 12, tXray), 5, tInvert);

      // Step 0 Bottom Invitation Pill (visible only in Step 0 before X-ray opens)
      const step0InviteAlpha = 1 - smoothstep(0.02, 0.16, p);
      if (step0InviteAlpha > 0.01) {
        ctx.save();
        ctx.globalAlpha = step0InviteAlpha;
        const iw = compact ? W * 0.84 : W * 0.64;
        const ih = Math.max(28, H * 0.10);
        const iy = H * 0.815;
        drawRoundedSlab(
          ctx,
          (W - iw) * 0.5,
          iy,
          iw,
          ih,
          999,
          3,
          isDark ? '#162033' : '#ffffff',
          isDark ? '#1e293b' : '#e2e8f0',
          isDark ? 'rgba(96, 165, 250, 0.36)' : 'rgba(20, 118, 212, 0.24)',
        );
        ctx.fillStyle = isDark ? '#93c5fd' : '#1e40af';
        ctx.font = `600 ${compact ? 13 : 12.5}px "Inter", "PingFang SC", "Noto Sans SC", "Microsoft YaHei UI", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(compact ? curUi.step0FloorInviteMobile : curUi.step0FloorInvite, W * 0.5, iy + ih * 0.5);
        ctx.restore();
      }

      // Step 1 Legacy Isolation Walls & Consequence Ribbon (rises as X-Ray exposes silos, dissolves in Step 2)
      const wallAlpha = smoothstep(0.14, 0.30, p) * (1 - smoothstep(0.36, 0.46, p));
      if (wallAlpha > 0.01) {
        const wallXs = [0.27 * W, 0.5 * W, 0.73 * W];
        const activeWall = Math.floor(elapsed / WALL_CYCLE_SEC) % 3;
        const pulsePhase = (elapsed / WALL_CYCLE_SEC) % 1;
        if (!reduced.matches && activeWall !== lastSyncedWallIdx) {
          lastSyncedWallIdx = activeWall;
          setActiveWallIdxState(activeWall);
        }

        wallXs.forEach((wx, idx) => {
          ctx.save();
          ctx.globalAlpha = wallAlpha;
          ctx.setLineDash([5, 5]);
          ctx.strokeStyle = idx === activeWall
            ? 'rgba(244, 63, 94, 0.78)'
            : (isDark ? 'rgba(148, 163, 184, 0.42)' : 'rgba(148, 163, 184, 0.52)');
          ctx.lineWidth = idx === activeWall ? 1.8 : 1.4;
          ctx.beginPath();
          ctx.moveTo(wx, baseTopY - 10);
          ctx.lineTo(wx, baseTopY + topH + 18);
          ctx.stroke();
          ctx.restore();

          if (idx === activeWall) {
            const startX = fourCenters[idx]! + topW * 0.18;
            const hitX = wx - 4;
            ctx.save();
            ctx.globalAlpha = wallAlpha;
            if (pulsePhase < 0.6) {
              const u = pulsePhase / 0.6;
              const ox = lerp(startX, hitX, u);
              const oy = baseTopY + 32 - Math.sin(u * Math.PI) * 14;
              ctx.beginPath();
              ctx.moveTo(startX, baseTopY + 32);
              ctx.quadraticCurveTo((startX + hitX) * 0.5, baseTopY + 12, ox, oy);
              ctx.strokeStyle = 'rgba(244, 63, 94, 0.65)';
              ctx.lineWidth = 2.2;
              ctx.stroke();

              ctx.beginPath();
              ctx.arc(ox, oy, 5, 0, Math.PI * 2);
              ctx.fillStyle = '#f43f5e';
              ctx.fill();
            } else {
              const u = (pulsePhase - 0.6) / 0.4;
              ctx.beginPath();
              ctx.arc(hitX, baseTopY + 30, 5 + u * 20, 0, Math.PI * 2);
              ctx.strokeStyle = `rgba(244, 63, 94, ${(1 - u) * 0.85})`;
              ctx.lineWidth = 2;
              ctx.stroke();
            }
            ctx.restore();
          }
        });

        // Bottom Concurrent Local GPU & VRAM Stampede Visualization (4 processes slamming into 1 GPU)
        const floorW = W * 0.86;
        const floorH = H * 0.145;
        const floorX = (W - floorW) * 0.5;
        const floorY = H * 0.775;
        const siloBottomY = baseTopY + topH + topDepth;

        fourCenters.forEach((sx, sIdx) => {
          const targetX = W * (0.41 + sIdx * 0.06);
          const cyMid = (siloBottomY + floorY) * 0.52;

          ctx.save();
          ctx.globalAlpha = wallAlpha;
          ctx.beginPath();
          ctx.moveTo(sx, siloBottomY);
          ctx.bezierCurveTo(sx, cyMid, targetX, cyMid, targetX, floorY);
          ctx.strokeStyle = 'rgba(245, 158, 11, 0.5)';
          ctx.lineWidth = 1.8;
          ctx.setLineDash([4, 4]);
          ctx.stroke();
          ctx.restore();
        });

        ctx.save();
        ctx.globalAlpha = wallAlpha;
        drawRoundedSlab(
          ctx,
          floorX,
          floorY,
          floorW,
          floorH,
          15,
          5,
          isDark ? '#28121a' : '#fff7f8',
          isDark ? '#4c1d28' : '#fecdd3',
          isDark ? 'rgba(251, 113, 133, 0.45)' : 'rgba(244, 63, 94, 0.36)',
          true,
        );

        const row1Y = floorY + floorH * 0.37;
        const row2Y = floorY + floorH * 0.74;

        if (!compact) {
          // Live Oscillating VRAM Contention Meter on Right
          const meterLoad = reduced.matches ? 0.96 : 0.92 + Math.abs(Math.sin(elapsed * 0.85)) * 0.07;
          const pctNum = Math.min(99, Math.round(meterLoad * 100));
          const barW = 92;
          const barH = 8;
          const meterRight = floorX + floorW - 22;
          const labelW = 98;
          const barX = meterRight - labelW - barW - 8;

          ctx.fillStyle = isDark ? '#fda4af' : '#9f1239';
          ctx.font = '700 13px "Inter", "PingFang SC", "Noto Sans SC", "Microsoft YaHei UI", sans-serif';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(curUi.gpuClashTitle, floorX + 22, row1Y, Math.max(180, barX - (floorX + 22) - 16));

          ctx.fillStyle = isDark ? '#3f1824' : '#ffe4e6';
          ctx.beginPath();
          ctx.roundRect(barX, row1Y - barH * 0.5, barW, barH, 999);
          ctx.fill();

          const barGrad = ctx.createLinearGradient(barX, row1Y, barX + barW, row1Y);
          barGrad.addColorStop(0, '#f59e0b');
          barGrad.addColorStop(1, '#e11d48');
          ctx.fillStyle = barGrad;
          ctx.beginPath();
          ctx.roundRect(barX, row1Y - barH * 0.5, barW * meterLoad, barH, 999);
          ctx.fill();

          ctx.fillStyle = isDark ? '#fda4af' : '#be123c';
          ctx.font = '700 11.5px "Inter", "PingFang SC", "Noto Sans SC", monospace';
          ctx.textAlign = 'right';
          ctx.fillText(`${pctNum}% ${curUi.gpuClashMeter}`, meterRight, row1Y);

          ctx.fillStyle = isDark ? '#fecdd3' : '#881337';
          ctx.font = '560 12.5px "Inter", "PingFang SC", "Noto Sans SC", "Microsoft YaHei UI", sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(curUi.siloFloorNote, W * 0.5, row2Y, floorW - 36);
        } else {
          ctx.fillStyle = isDark ? '#fda4af' : '#9f1239';
          ctx.font = '700 13.5px "Inter", "PingFang SC", "Noto Sans SC", sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(curUi.gpuClashTitleMobile, W * 0.5, row1Y, floorW - 24);
          ctx.fillStyle = isDark ? '#fecdd3' : '#881337';
          ctx.font = '560 12.5px "Inter", "PingFang SC", "Noto Sans SC", sans-serif';
          ctx.fillText(curUi.siloFloorNoteMobile, W * 0.5, row2Y, floorW - 24);
        }
        ctx.restore();

        if (!reduced.matches) {
          fourCenters.forEach((sx, sIdx) => {
            const targetX = W * (0.41 + sIdx * 0.06);
            const cyMid = (siloBottomY + floorY) * 0.52;
            const boltU = (elapsed * 0.44 + sIdx * 0.23) % 1;
            const omt = 1 - boltU;
            const bx = omt ** 3 * sx + 3 * omt ** 2 * boltU * sx + 3 * omt * boltU ** 2 * targetX + boltU ** 3 * targetX;
            const by = omt ** 3 * siloBottomY + 3 * omt ** 2 * boltU * cyMid + 3 * omt * boltU ** 2 * cyMid + boltU ** 3 * floorY;

            ctx.save();
            ctx.globalAlpha = wallAlpha;
            ctx.beginPath();
            ctx.arc(bx, by, 4.2, 0, Math.PI * 2);
            ctx.fillStyle = sIdx % 2 === 0 ? '#f43f5e' : '#f59e0b';
            ctx.fill();

            if (boltU > 0.78) {
              const ringT = (boltU - 0.78) / 0.22;
              ctx.beginPath();
              ctx.arc(targetX, floorY, 4 + ringT * 11, 0, Math.PI * 2);
              ctx.strokeStyle = `rgba(244, 63, 94, ${(1 - ringT) * 0.75})`;
              ctx.lineWidth = 1.8;
              ctx.stroke();
            }
            ctx.restore();
          });
        }
      }

      // 3. Upper & Lower Curved Bezier Conduits
      const coreY = lerp(H * 0.46, H * 0.425, tCore);
      const coreH = H * 0.22;
      const activeFocusIdx =
        state.focusedViewport !== null
          ? state.focusedViewport
          : Math.floor(elapsed / 3.4) % 5;

      if (tCore > 0.15) {
        const conduitAlpha = smoothstep(0.52, 0.66, p);
        fiveCenters.forEach((tx, idx) => {
          const ox = W * (0.28 + idx * 0.11);
          const sy = coreY;
          const ey = baseTopY + topH + topDepth;
          const isFocus = idx === activeFocusIdx;

          ctx.save();
          ctx.globalAlpha = conduitAlpha * (idx === 4 ? smoothstep(0.74, 0.92, p) : 1);
          ctx.beginPath();
          ctx.moveTo(ox, sy);
          ctx.bezierCurveTo(ox, (sy + ey) * 0.5, tx, (sy + ey) * 0.5, tx, ey);
          ctx.strokeStyle = isFocus
            ? 'rgba(17, 188, 226, 0.72)'
            : (isDark ? 'rgba(148, 163, 184, 0.36)' : 'rgba(100, 116, 139, 0.44)');
          ctx.lineWidth = isFocus ? 2.5 : 1.5;
          if (idx === 4 && !isFocus) ctx.setLineDash([4, 4]);
          ctx.stroke();

          if (!reduced.matches && tFlow > 0.1) {
            const u = (elapsed * (isFocus ? 0.46 : 0.30) + idx * 0.21) % 1;
            const omt = 1 - u;
            const cyMid = (sy + ey) * 0.5;
            const px = omt ** 3 * ox + 3 * omt ** 2 * u * ox + 3 * omt * u ** 2 * tx + u ** 3 * tx;
            const py = omt ** 3 * sy + 3 * omt ** 2 * u * cyMid + 3 * omt * u ** 2 * cyMid + u ** 3 * ey;
            ctx.beginPath();
            ctx.arc(px, py, isFocus ? 3.8 : 2.5, 0, Math.PI * 2);
            ctx.fillStyle = isFocus ? '#05dc78' : '#38bdf8';
            ctx.fill();
          }
          ctx.restore();
        });
      }

      const subY = lerp(H * 0.82, H * 0.785, tFlow);
      if (tFlow > 0.05) {
        const subCenters = THREE_SUB_X_PCT.map((f) => f * W);
        subCenters.forEach((sx, idx) => {
          const ex = W * (0.27 + idx * 0.23);
          const sy = subY;
          const ey = coreY + coreH + 10;
          const isActive = idx === state.activeEngine || idx === 2;

          ctx.save();
          ctx.globalAlpha = tFlow;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.bezierCurveTo(sx, (sy + ey) * 0.5, ex, (sy + ey) * 0.5, ex, ey);
          ctx.strokeStyle = isActive
            ? (isDark ? 'rgba(96, 165, 250, 0.65)' : 'rgba(20, 118, 212, 0.56)')
            : (isDark ? 'rgba(148, 163, 184, 0.32)' : 'rgba(100, 116, 139, 0.38)');
          ctx.lineWidth = isActive ? 2.3 : 1.3;
          ctx.stroke();

          if (isActive && !reduced.matches) {
            const u = (elapsed * 0.42 + idx * 0.33) % 1;
            const omt = 1 - u;
            const cyMid = (sy + ey) * 0.5;
            const px = omt ** 3 * sx + 3 * omt ** 2 * u * sx + 3 * omt * u ** 2 * ex + u ** 3 * ex;
            const py = omt ** 3 * sy + 3 * omt ** 2 * u * cyMid + 3 * omt * u ** 2 * cyMid + u ** 3 * ey;
            ctx.beginPath();
            ctx.arc(px, py, 3.4, 0, Math.PI * 2);
            ctx.fillStyle = idx === 2 ? '#05dc78' : '#38bdf8';
            ctx.fill();
          }
          ctx.restore();
        });
      }

      // 4. Draw Top 4 -> 5 App Windows / X-Ray Silos / Lightweight Viewports
      const windowChromeAlpha = 1 - smoothstep(0.03, 0.19, p);
      for (let i = 0; i < 5; i += 1) {
        const isFifth = i === 4;
        const alpha = isFifth ? smoothstep(0.72, 0.92, p) : 1;
        if (alpha <= 0.01) continue;

        const staggerPx = isFifth
          ? 0
          : (STAGGER_Y_PCT[i]! * H + (reduced.matches ? 0 : Math.sin(elapsed * 0.72 + i * 1.4) * 2.5)) *
            (1 - tXray);
        const itemY = baseTopY + staggerPx;
        const cx = isFifth ? fiveCenters[4]! : lerp(fourCenters[i]!, fiveCenters[i]!, tInvert);
        const x = cx - topW * 0.5;
        const isFocused = tFlow > 0.35 && i === activeFocusIdx;

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.shadowColor = isFocused
          ? 'rgba(17, 188, 226, 0.24)'
          : (isDark ? 'rgba(0, 0, 0, 0.35)' : 'rgba(15, 23, 42, 0.07)');
        ctx.shadowBlur = isFocused ? 22 : 14;
        ctx.shadowOffsetY = 6;

        const topSurface = isFocused
          ? (isDark ? '#0e2c29' : '#f0fdf9')
          : (isDark ? '#162033' : '#ffffff');
        const sideBevel = isFocused
          ? (isDark ? '#0d9488' : '#99f6e4')
          : isDark
            ? '#1e293b'
            : (tInvert > 0.5 ? '#dbe4f0' : '#cbd5e1');
        const borderStroke = isFocused
          ? (isDark ? '#34d399' : '#05dc78')
          : tInvert < 0.35
            ? (isDark ? 'rgba(148, 163, 184, 0.34)' : 'rgba(148, 163, 184, 0.55)')
            : (isDark ? 'rgba(96, 165, 250, 0.34)' : 'rgba(20, 118, 212, 0.24)');

        drawRoundedSlab(ctx, x, itemY, topW, topH, 15, topDepth, topSurface, sideBevel, borderStroke, isFifth);
        ctx.restore();

        if (!isFifth && windowChromeAlpha > 0.01) {
          drawEverydayAppChrome(
            ctx,
            i,
            x,
            itemY,
            topW,
            topH,
            windowChromeAlpha,
            curUi.step0WindowBadge,
            compact,
            isDark,
          );
        }
      }

      // 5. Middle Tier: Monumental Nimi Personal Core 3D Slab
      const coreFullW = W * 0.87;
      if (tCore > 0.02) {
        const coreW = lerp(W * 0.68, coreFullW, tCore);
        const coreX = (W - coreW) * 0.5;

        ctx.save();
        ctx.globalAlpha = tCore;
        ctx.shadowColor = isDark ? 'rgba(0, 0, 0, 0.45)' : 'rgba(20, 118, 212, 0.16)';
        ctx.shadowBlur = 30;
        ctx.shadowOffsetY = 10;

        const bevelGrad = ctx.createLinearGradient(coreX, coreY, coreX + coreW, coreY);
        bevelGrad.addColorStop(0, '#05dc78');
        bevelGrad.addColorStop(0.5, '#11bce2');
        bevelGrad.addColorStop(1, '#1a75ff');

        drawRoundedSlab(
          ctx,
          coreX,
          coreY,
          coreW,
          coreH,
          20,
          10,
          isDark ? '#131f33' : '#ffffff',
          bevelGrad,
          isDark ? 'rgba(56, 189, 248, 0.45)' : 'rgba(17, 188, 226, 0.45)',
        );
        ctx.restore();

        const pad = W * 0.015;
        const gap = W * 0.012;
        const chW = (coreW - pad * 2 - gap * 2) / 3;
        const chY = coreY + coreH * 0.33;
        const chH = coreH * 0.54;
        for (let c = 0; c < 3; c += 1) {
          const chX = coreX + pad + c * (chW + gap);
          ctx.save();
          ctx.globalAlpha = tCore;
          ctx.beginPath();
          ctx.roundRect(chX, chY, chW, chH, 12);
          ctx.fillStyle = c === 1
            ? (isDark ? '#0f2928' : '#f0fdf9')
            : (isDark ? '#172540' : '#f5f9ff');
          ctx.fill();
          ctx.lineWidth = 1;
          ctx.strokeStyle = c === 1
            ? (isDark ? 'rgba(52, 211, 153, 0.32)' : 'rgba(5, 220, 120, 0.34)')
            : (isDark ? 'rgba(96, 165, 250, 0.28)' : 'rgba(20, 118, 212, 0.22)');
          ctx.stroke();
          ctx.restore();
        }
      }

      // 6. X-Ray Duplicated Bricks (exposed in Step 1, extracted as capsules into Core in Step 2)
      const xrayReveal = smoothstep(0.11, 0.29, p);
      const cubeAbsorb = 1 - smoothstep(0.57, 0.64, p);
      const cubeAlpha = xrayReveal * cubeAbsorb;
      if (cubeAlpha > 0.01) {
        const targetChamberForRow = [2, 1, 0] as const;
        const rowFill = isDark
          ? (['#1e293b', '#172554', '#3b2509'] as const)
          : (['#e8eef5', '#eff6ff', '#fffbeb'] as const);
        const rowStroke = isDark
          ? (['#94a3b8', '#60a5fa', '#fbbf24'] as const)
          : (['#64748b', '#60a5fa', '#f59e0b'] as const);
        const chamberCenters = [W * 0.22, W * 0.5, W * 0.78];
        const brickLabels = compact ? curUi.cubeLabelsShort : curUi.cubeLabelsLong;
        const brickTextAlpha = cubeAlpha * (1 - smoothstep(0.36, 0.45, p));

        for (let s = 0; s < 4; s += 1) {
          const siloCx = lerp(fourCenters[s]!, fiveCenters[s]!, tInvert * 0.45);
          for (let r = 0; r < 3; r += 1) {
            const startX = siloCx;
            const startY = H * 0.132 + H * 0.162 + r * (H * 0.098);
            const localT = smoothstep(0.38 + r * 0.016 + s * 0.006, 0.61 + r * 0.012, p);
            const fanOffset = (s - 1.5) * (W * 0.044) * (1 - localT * 0.42);
            const destX = chamberCenters[targetChamberForRow[r]!]! + fanOffset;
            const destY = coreY + coreH * 0.58;

            const cx = lerp(startX, destX, localT);
            const cy = lerp(startY, destY, localT) + Math.sin(localT * Math.PI) * 10;
            const popScale = lerp(0.9, 1, xrayReveal);
            const cw = lerp(W * 0.168 * popScale, W * 0.036, localT);
            const ch = lerp(H * 0.068 * popScale, H * 0.036, localT);

            ctx.save();
            ctx.globalAlpha = cubeAlpha * (1 - localT * 0.15);
            drawRoundedSlab(
              ctx,
              cx - cw * 0.5,
              cy - ch * 0.5,
              cw,
              ch,
              8,
              3.5 * (1 - localT * 0.5),
              rowFill[r]!,
              isDark ? '#334155' : '#cbd5e1',
              rowStroke[r]!,
            );

            if (brickTextAlpha > 0.02) {
              ctx.globalAlpha = brickTextAlpha;
              ctx.fillStyle = isDark ? '#e2e8f0' : '#334155';
              ctx.font = `600 ${compact ? 11 : 12}px "Inter", "PingFang SC", "Noto Sans SC", "Microsoft YaHei UI", sans-serif`;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText(`${brickLabels[r]} #${s + 1}`, cx, cy + 0.5);
            }
            ctx.restore();
          }
        }
      }

      // In-Scene Extraction Stream Callout Pills (during Step 1 -> Step 2 transition)
      const streamTagAlpha = smoothstep(0.41, 0.48, p) * (1 - smoothstep(0.58, 0.65, p));
      if (streamTagAlpha > 0.01 && !compact) {
        const tagXs = [W * 0.22, W * 0.5, W * 0.78];
        tagXs.forEach((tx, idx) => {
          ctx.save();
          ctx.globalAlpha = streamTagAlpha;
          drawRoundedSlab(
            ctx,
            tx - 94,
            H * 0.305,
            188,
            28,
            999,
            0,
            isDark ? '#172554' : '#eff6ff',
            isDark ? '#1e3a8a' : '#bfdbfe',
            isDark ? 'rgba(96, 165, 250, 0.42)' : 'rgba(20, 118, 212, 0.35)',
          );
          ctx.fillStyle = isDark ? '#93c5fd' : '#1d4ed8';
          ctx.font = '600 11.5px "Inter", "PingFang SC", "Noto Sans SC", "Microsoft YaHei UI", sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(curUi.streamCallouts[idx]!, tx, H * 0.305 + 14);
          ctx.restore();
        });
      }

      // In-Scene Core Settled Ribbon (resting state of Step 2 at p = 0.68)
      const step2RibbonAlpha = smoothstep(0.62, 0.67, p) * (1 - smoothstep(0.73, 0.80, p));
      if (step2RibbonAlpha > 0.01) {
        ctx.save();
        ctx.globalAlpha = step2RibbonAlpha;
        const rw = compact ? W * 0.86 : W * 0.76;
        drawRoundedSlab(
          ctx,
          (W - rw) * 0.5,
          H * 0.78,
          rw,
          H * 0.095,
          999,
          4,
          isDark ? '#0d2922' : '#f0fdf9',
          isDark ? '#115e59' : '#99f6e4',
          isDark ? 'rgba(52, 211, 153, 0.42)' : 'rgba(5, 220, 120, 0.38)',
        );
        ctx.fillStyle = isDark ? '#6ee7b7' : '#065f46';
        ctx.font = `600 ${compact ? 14 : 13}px "Inter", "PingFang SC", "Noto Sans SC", "Microsoft YaHei UI", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(compact ? curUi.coreSettledNoteMobile : curUi.coreSettledNote, W * 0.5, H * 0.78 + H * 0.0475);
        ctx.restore();
      }

      // 7. Bottom Tier: 3 Wide Hot-Swappable Substrate Docks (Step 3)
      if (tFlow > 0.02) {
        const subCenters = THREE_SUB_X_PCT.map((f) => f * W);
        const subW = W * 0.272;
        const subH = H * 0.115;

        subCenters.forEach((scx, idx) => {
          const isSelected = idx === state.activeEngine;
          const isVault = idx === 2;
          ctx.save();
          ctx.globalAlpha = tFlow;
          ctx.shadowColor = isDark ? 'rgba(0, 0, 0, 0.35)' : 'rgba(15, 23, 42, 0.06)';
          ctx.shadowBlur = 14;
          ctx.shadowOffsetY = 5;

          drawRoundedSlab(
            ctx,
            scx - subW * 0.5,
            subY,
            subW,
            subH,
            14,
            6,
            isSelected ? (isDark ? '#152b4a' : '#eff8ff') : (isDark ? '#162033' : '#ffffff'),
            isSelected ? (isDark ? '#3b82f6' : '#93c5fd') : (isDark ? '#1e293b' : '#dbe4f0'),
            isSelected
              ? (isDark ? '#60a5fa' : '#1476d4')
              : isVault
                ? (isDark ? 'rgba(52, 211, 153, 0.45)' : 'rgba(5, 220, 120, 0.42)')
                : (isDark ? 'rgba(148, 163, 184, 0.32)' : 'rgba(148, 163, 184, 0.42)'),
          );
          ctx.restore();
        });
      }

      // 8. Continuous Cross-Viewport Gliding Orb (Step 3)
      if (tFlow > 0.45 && !reduced.matches) {
        const glideAlpha = smoothstep(0.80, 0.96, p);
        const pingPong = (Math.sin(elapsed * 0.42) + 1) * 0.5;
        const gx = lerp(fiveCenters[0]!, fiveCenters[4]!, pingPong);
        const gy = baseTopY - H * 0.024;

        ctx.save();
        ctx.globalAlpha = glideAlpha;
        ctx.beginPath();
        ctx.moveTo(fiveCenters[0]!, gy);
        ctx.lineTo(fiveCenters[4]!, gy);
        ctx.strokeStyle = 'rgba(5, 220, 120, 0.36)';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(gx, gy, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#05dc78';
        ctx.shadowColor = '#05dc78';
        ctx.shadowBlur = 10;
        ctx.fill();
        ctx.restore();
      }

      if (isVisible && (!reduced.matches || state.tweenDuration > 0)) {
        rafId = window.requestAnimationFrame(render);
      }
    };

    const requestDraw = () => {
      if (rafId !== 0) return;
      rafId = window.requestAnimationFrame(render);
    };
    requestDrawRef.current = requestDraw;

    requestDraw();

    const ro = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver((entries) => {
          const entry = entries[0];
          if (entry) {
            const compact = window.innerWidth <= 980;
            canvasSizeRef.current = {
              width: Math.max(300, entry.contentRect.width || (compact ? 360 : 1080)),
              height: Math.max(220, entry.contentRect.height || (compact ? 270 : 420)),
            };
          } else {
            updateCachedCanvasSize();
          }
          requestDraw();
        })
      : null;
    ro?.observe(canvas);

    const onReducedChange = () => {
      if (reduced.matches) {
        liveRef.current.tweenDuration = 0;
        liveRef.current.progress = liveRef.current.tweenTo;
      }
      requestDraw();
    };
    reduced.addEventListener('change', onReducedChange);

    const mo = typeof MutationObserver !== 'undefined'
      ? new MutationObserver(() => {
          const nextDark = readIsDarkScheme();
          if (liveRef.current.isDark !== nextDark) {
            liveRef.current.isDark = nextDark;
            requestDraw();
          }
        })
      : null;
    mo?.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-nimi-scheme', 'class'],
    });

    const io = new IntersectionObserver(
      (entries) => {
        const e = entries[0];
        if (!e) return;
        isVisible = e.isIntersecting;
        window.cancelAnimationFrame(rafId);
        rafId = 0;
        if (isVisible) requestDraw();
      },
      { threshold: 0.04 },
    );
    io.observe(canvas);

    return () => {
      requestDrawRef.current = () => {};
      window.cancelAnimationFrame(rafId);
      ro?.disconnect();
      mo?.disconnect();
      reduced.removeEventListener('change', onReducedChange);
      io.disconnect();
    };
  }, []);

  const activeAct = ui.acts[activeStep]!;
  const tXrayDom = smoothstep(0.03, 0.31, displayProgress);
  const tInvertDom = smoothstep(0.37, 0.63, displayProgress);
  const tCoreTextDom = smoothstep(0.61, 0.67, displayProgress);
  const tFlowDom = smoothstep(0.72, 0.96, displayProgress);

  const handleCueClick = () => {
    if (activeStep < 3) {
      const next = (activeStep + 1) as StageStep;
      commitStep(next);
      return;
    }
    if (typeof document !== 'undefined') {
      const prefersReduced =
        typeof window !== 'undefined' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      document
        .getElementById('capabilities')
        ?.scrollIntoView({ behavior: prefersReduced ? 'instant' : 'smooth' });
    }
  };

  const handleStageKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      if (activeStep < 3) {
        e.preventDefault();
        const next = (activeStep + 1) as StageStep;
        commitStep(next);
      }
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      if (activeStep > 0) {
        e.preventDefault();
        const next = (activeStep - 1) as StageStep;
        commitStep(next);
      }
    }
  };

  const wallLeftPcts = [27, 50, 73] as const;
  const faultPillAlpha =
    smoothstep(0.16, 0.30, displayProgress) * (1 - smoothstep(0.36, 0.45, displayProgress));

  return (
    <div ref={containerRef} className="platform-scrolly-inversion is-full-cinema">
      <div
        ref={stageRef}
        className="public-arch-diagram platform-blueprint-stage"
        data-step={activeStep}
        data-expanded={activeStep > 0 ? 'true' : 'false'}
        role="region"
        tabIndex={0}
        aria-label={copy.blueprintSwitchLabel}
        onKeyDown={handleStageKeyDown}
      >
        {/* Integrated Narrative & Progress Header Fused Inside the Stage */}
        <div className="platform-cinema-header">
          <div className="platform-cinema-narrative" key={activeAct.num}>
            <div className="platform-cinema-eyebrow-row">
              <span className={`platform-cinema-eyebrow is-step-${activeStep}`}>
                {activeStep === 0 ? (
                  <AppWindow size={12} aria-hidden="true" />
                ) : activeStep === 1 ? (
                  <X size={12} aria-hidden="true" />
                ) : activeStep === 2 ? (
                  <Sparkles size={12} aria-hidden="true" />
                ) : (
                  <Check size={12} aria-hidden="true" />
                )}
                <span>{activeAct.eyebrow}</span>
              </span>
              <button
                type="button"
                className="platform-cinema-scroll-cue"
                onClick={handleCueClick}
              >
                <ArrowDown size={12} aria-hidden="true" />
                <span>{ui.stepCues[activeStep]}</span>
              </button>
            </div>
            <h3>{activeAct.title}</h3>
            <p>{activeAct.summary}</p>
          </div>

          {/* 4-Step Discrete Stepper Pills */}
          <ol className="platform-cinema-stepper" aria-label={copy.blueprintSwitchLabel}>
            {ui.acts.map((act, idx) => {
              const isCurrent = idx === activeStep;
              return (
                <li key={act.num}>
                  <button
                    type="button"
                    aria-current={isCurrent ? 'step' : undefined}
                    className={`platform-stepper-pill${isCurrent ? ' is-current' : ''}`}
                    style={{ '--pill-fill': isCurrent ? '1' : '0' } as React.CSSProperties}
                    onClick={() => commitStep(idx as StageStep)}
                  >
                    <span className="platform-stepper-num">{act.num}</span>
                    <span className="platform-stepper-label">
                      {isCompactWidth ? act.pillLabelMobile : act.pillLabel}
                    </span>
                    <i className="platform-stepper-bar" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ol>
        </div>

        {/* Full-Width 2.5D Panorama Frame (Unfolds smoothly from Screen-1 Fit -> Full-Screen Stage) */}
        <div ref={frameRef} className="platform-iso-frame">
          <canvas ref={canvasRef} className="platform-iso-canvas" aria-hidden="true" />

          {/* In-Scene Spatial Callout 1: Dynamic Wall Collision Pill (Step 1) */}
          <div
            className="platform-iso-floating-pill is-fault"
            style={{
              left: `${wallLeftPcts[activeWallIdxState]}%`,
              opacity: faultPillAlpha,
            }}
            aria-hidden="true"
          >
            <X size={11} />
            <span>{ui.wallCollisionBadge}</span>
          </div>

          {/* In-Scene Spatial Callout 2: Continuity Ribbon Badge (Step 3) */}
          <div
            className="platform-iso-floating-pill is-continuity"
            style={{ opacity: smoothstep(0.80, 0.95, displayProgress) }}
            aria-hidden="true"
          >
            <Check size={11} />
            <span>{ui.continuityOrbBadge}</span>
          </div>

          {/* In-Scene Spatial Callout 3: Bottom Hot-Swap Micro-Caption (Step 3) */}
          <div
            className="platform-iso-floating-pill is-hotswap"
            style={{ opacity: smoothstep(0.82, 0.96, displayProgress) }}
            aria-hidden="true"
          >
            <Zap size={11} />
            <span>{ui.hotSwapHintBadge}</span>
          </div>

          {/* Anchored Top Tier Labels (4 Scattered Apps -> 4 X-Ray Silos -> 5 Viewports) */}
          {[0, 1, 2, 3, 4].map((idx) => {
            const isFifth = idx === 4;
            const opacity = isFifth ? smoothstep(0.74, 0.92, displayProgress) : 1;
            const leftPct = isFifth
              ? FIVE_X_PCT[4] * 100
              : lerp(FOUR_X_PCT[idx]! * 100, FIVE_X_PCT[idx]! * 100, tInvertDom);
            const step0TopPct = 33.0 + (isFifth ? 0 : STAGGER_Y_PCT[idx]! * 100);
            const topPct = isFifth
              ? 17.5
              : lerp(lerp(step0TopPct, 19.6, tXrayDom), 17.5, tInvertDom);

            const siloList = isCompactWidth ? ui.silosMobile : ui.silosDesktop;
            const surfList = isCompactWidth ? ui.surfacesMobile : ui.surfacesDesktop;
            const label =
              tInvertDom < 0.45 && !isFifth
                ? siloList[idx] ?? surfList[idx]
                : surfList[idx];
            const subTag = !isFifth && tXrayDom < 0.45
              ? ui.step0SubTag
              : !isFifth && tInvertDom < 0.45
                ? ui.siloSubTag
                : copy.blueprintSurfaces[idx]?.tag ?? '';

            const xPx = Math.round((leftPct / 100) * canvasSizeRef.current.width * 10) / 10;
            const yPx = Math.round((topPct / 100) * canvasSizeRef.current.height * 10) / 10;
            const isInteractive = opacity > 0.4;

            return (
              <button
                key={idx}
                ref={(node) => {
                  topLabelRefs.current[idx] = node;
                }}
                type="button"
                tabIndex={isInteractive ? 0 : -1}
                disabled={!isInteractive}
                aria-hidden={!isInteractive || undefined}
                aria-pressed={focusedViewport === idx}
                className={`platform-iso-top-label${focusedViewport === idx ? ' is-hovered' : ''}`}
                style={{
                  left: 0,
                  top: 0,
                  transform: `translate3d(${xPx}px, ${yPx}px, 0) translate(-50%, -50%)`,
                  opacity,
                  pointerEvents: isInteractive ? 'auto' : 'none',
                }}
                onMouseEnter={() => { if (isInteractive) setFocusedViewport(idx); }}
                onMouseLeave={() => setFocusedViewport(null)}
                onClick={() => { if (isInteractive) setFocusedViewport((prev) => (prev === idx ? null : idx)); }}
              >
                <strong>{label}</strong>
                <small>{subTag}</small>
              </button>
            );
          })}

          {/* Anchored Middle Personal Core Labels (Step 2 & Step 3) */}
          <div
            className="platform-iso-core-overlay"
            aria-hidden={tCoreTextDom <= 0.5 || undefined}
            style={{
              opacity: tCoreTextDom,
              transform: `translateY(${lerp(8, 0, tCoreTextDom)}px)`,
              pointerEvents: tCoreTextDom > 0.5 ? 'auto' : 'none',
            }}
          >
            <div className="platform-iso-core-header">
              <img src="/logo.svg" alt="" width={17} height={17} />
              <strong>{copy.blueprintCoreLabel}</strong>
              <span className="platform-iso-core-tagline">{ui.coreTagline}</span>
            </div>
            <div className="platform-iso-core-chambers">
              {(isCompactWidth ? ui.coreChambersMobile : ui.coreChambers).map((ch) => (
                <div key={ch.id} className="platform-iso-chamber">
                  <strong>{ch.title}</strong>
                  <span>{ch.sub}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Anchored Bottom Hot-Swappable Substrate Docks (Step 3) */}
          <div
            className="platform-iso-bottom-overlay"
            aria-hidden={tFlowDom <= 0.5 || undefined}
            style={{
              opacity: tFlowDom,
              pointerEvents: tFlowDom > 0.5 ? 'auto' : 'none',
            }}
          >
            {(isCompactWidth ? ui.substratesMobile : ui.substratesDesktop).map((label, idx) => {
              const isCompute = idx < 2;
              const isDockInteractive = tFlowDom > 0.5;
              const isSelected = idx === activeEngine;
              const Icon = idx === 0 ? Cpu : idx === 1 ? RefreshCw : HardDrive;
              const statusTag =
                idx === 2
                  ? ui.substrateVaultTag
                  : isSelected
                    ? ui.substrateActiveTag
                    : ui.substrateSwapTag;
              return (
                <button
                  key={label}
                  type="button"
                  tabIndex={isDockInteractive && isCompute ? 0 : -1}
                  disabled={!isCompute || !isDockInteractive}
                  aria-hidden={!isDockInteractive || undefined}
                  aria-pressed={isCompute ? isSelected : undefined}
                  className={`platform-iso-sub-btn${isSelected ? ' is-active' : ''}${idx === 2 ? ' is-vault' : ''}`}
                  onClick={() => {
                    if (!isCompute || !isDockInteractive) return;
                    userPickedEngineRef.current = true;
                    setActiveEngine(idx as 0 | 1);
                  }}
                >
                  <span className="platform-iso-sub-main">
                    <Icon size={14} aria-hidden="true" />
                    <strong>{label}</strong>
                  </span>
                  {!isCompactWidth && <small>{statusTag}</small>}
                </button>
              );
            })}
          </div>
        </div>

        {/* Accessible / SSR Structural Summary Nodes */}
        <div className="sr-only">
          <div className="platform-legacy-schematic">
            <p>{copy.legacyCaption}</p>
            {copy.legacySilos.map((silo) => (
              <div key={silo.app}>{silo.app}: {silo.issue1} / {silo.issue2}</div>
            ))}
          </div>
          <div className="platform-stack-schematic">
            <p>{copy.blueprintCoreTitle}</p>
            {copy.blueprintCorePillars.map((pillar) => (
              <div key={pillar.name}>{pillar.name}: {pillar.role}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
