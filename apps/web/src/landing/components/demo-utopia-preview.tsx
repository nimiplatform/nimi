import { type RefObject, useContext, useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  Check,
  Compass,
  DoorClosed,
  Lock,
  MapPin,
  MessageCircle,
  PackageCheck,
  Send,
  Sliders,
  Sparkles,
  Users,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { DemoSessionContext } from './hero-demo-context.js';
import { useAppPreviewLocale } from '../i18n/app-preview-locale.js';
import { DEFAULT_STORY_AGENT } from '../content/story-model.js';
import {
  createUtopiaPreviewContent,
  type UtopiaHabitatId,
  type UtopiaPoint2D,
  type UtopiaPreviewContent,
  type UtopiaPreviewResident,
} from '../content/landing-content.utopia.js';

type DrawerTab = 'journal' | 'residents' | 'tuner';
type HeadwearKind = 'straw-hat' | 'beret' | 'leaf-sprout' | 'star-clip';

export type UtopiaWalkerFrame = Readonly<{
  readonly x: number;
  readonly y: number;
  readonly walking: boolean;
  readonly facing: 'left' | 'right';
}>;

type InternalWalkerState = {
  modeKey: string;
  x: number;
  y: number;
  wpIndex: number;
  pauseSec: number;
  walking: boolean;
  facing: 'left' | 'right';
};

function resolvePlacement(
  resident: UtopiaPreviewResident,
  tuned: boolean,
  solitude: boolean,
) {
  if (solitude) return resident.solitary;
  return tuned ? resident.tuned : resident.normal;
}

export function useUtopiaWalkers(
  habitatId: UtopiaHabitatId,
  residents: readonly UtopiaPreviewResident[],
  isTuned: boolean,
  solitude = false,
  paused = false,
  options?: {
    stageRef?: RefObject<HTMLElement | null>;
    actorRefs?: RefObject<Map<string, HTMLElement>>;
    zBase?: number;
    zScale?: number;
  },
): Readonly<Record<string, UtopiaWalkerFrame>> {
  const walkersRef = useRef<Map<string, InternalWalkerState>>(new Map());
  const lastHabitatRef = useRef<UtopiaHabitatId>(habitatId);
  const stageSizeRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });
  const [, setTick] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(() =>
    typeof window !== 'undefined'
      ? Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
      : false,
  );

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReducedMotion(mq.matches);
    setReducedMotion(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const stageRef = options?.stageRef;
  const actorRefs = options?.actorRefs;
  const zBase = options?.zBase ?? 4;
  const zScale = options?.zScale ?? 0.1;

  useEffect(() => {
    const stageEl = stageRef?.current;
    if (!stageEl || typeof window === 'undefined') return;
    const updateSize = () => {
      stageSizeRef.current = {
        width: stageEl.clientWidth,
        height: stageEl.clientHeight,
      };
    };
    updateSize();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(updateSize);
      ro.observe(stageEl);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, [stageRef, habitatId]);

  if (lastHabitatRef.current !== habitatId) {
    lastHabitatRef.current = habitatId;
    walkersRef.current.clear();
  }

  useEffect(() => {
    const resetDomActors = () => {
      const actors = actorRefs?.current;
      if (!actors) return;
      for (const el of actors.values()) {
        el.style.setProperty('--walker-dx', '0px');
        el.style.setProperty('--walker-dy', '0px');
        el.classList.remove('is-walking');
        const chibi = el.querySelector<HTMLElement>('.utopia-mini-chibi');
        if (chibi) {
          chibi.classList.remove('is-walking');
          chibi.classList.add('is-idle');
        }
      }
    };

    if (paused || reducedMotion || typeof window === 'undefined') {
      resetDomActors();
      return;
    }

    const useDomDrivers = Boolean(stageRef && actorRefs);
    let rafId = 0;
    let lastTs = performance.now();
    let uiAccum = 0;

    const step = (now: number) => {
      const dt = Math.min(0.08, Math.max(0.001, (now - lastTs) / 1000));
      lastTs = now;
      uiAccum += dt;

      const modeKey = `${isTuned ? 'tuned' : 'normal'}:${solitude ? 'solo' : 'social'}`;
      const map = walkersRef.current;
      const actors = actorRefs?.current;
      const { width: stageW, height: stageH } = stageSizeRef.current;

      residents.forEach((resident, idx) => {
        const placement = resolvePlacement(resident, isTuned, solitude);
        const trail: readonly UtopiaPoint2D[] =
          placement.trail && placement.trail.length >= 2
            ? placement.trail
            : [{ x: placement.x, y: placement.y }];

        let st = map.get(resident.id);
        if (!st) {
          st = {
            modeKey,
            x: placement.x,
            y: placement.y,
            wpIndex: trail.length > 1 ? 1 : 0,
            pauseSec: 0.28 + idx * 0.55,
            walking: false,
            facing: idx % 2 === 0 ? 'right' : 'left',
          };
          map.set(resident.id, st);
        } else if (st.modeKey !== modeKey) {
          st.modeKey = modeKey;
          st.wpIndex = 0;
          st.pauseSec = 0;
        }

        if (trail.length <= 1) {
          const dx = placement.x - st.x;
          const dy = placement.y - st.y;
          const dist = Math.hypot(dx, dy);
          if (dist > 0.2) {
            const move = Math.min(dist, 6.2 * dt);
            st.x += (dx / dist) * move;
            st.y += (dy / dist) * move;
            if (Math.abs(dx) > 0.04) st.facing = dx < 0 ? 'left' : 'right';
            st.walking = true;
          } else {
            st.x = placement.x;
            st.y = placement.y;
            st.walking = false;
          }
        } else if (st.pauseSec > 0) {
          st.pauseSec -= dt;
          st.walking = false;
        } else {
          const target = trail[st.wpIndex % trail.length]!;
          const dx = target.x - st.x;
          const dy = target.y - st.y;
          const dist = Math.hypot(dx, dy);
          const speed = 4.6 + idx * 0.35;

          if (dist <= 0.28) {
            st.x = target.x;
            st.y = target.y;
            const atHome = st.wpIndex % trail.length === 0;
            st.wpIndex = (st.wpIndex + 1) % trail.length;
            st.pauseSec = atHome ? 1.55 + idx * 0.35 : 0.65 + (st.wpIndex % 2) * 0.3;
            st.walking = false;
          } else {
            const move = Math.min(dist, speed * dt);
            st.x += (dx / dist) * move;
            st.y += (dy / dist) * move;
            if (Math.abs(dx) > 0.04) {
              st.facing = dx < 0 ? 'left' : 'right';
            }
            st.walking = true;
          }
        }

        if (useDomDrivers && actors) {
          const el = actors.get(resident.id);
          if (el) {
            const dxPx = stageW > 0 ? ((st.x - placement.x) / 100) * stageW : 0;
            const dyPx = stageH > 0 ? ((st.y - placement.y) / 100) * stageH : 0;
            el.style.setProperty('--walker-dx', `${dxPx.toFixed(2)}px`);
            el.style.setProperty('--walker-dy', `${dyPx.toFixed(2)}px`);
            el.style.zIndex = String(zBase + Math.round(st.y * zScale));
            el.classList.toggle('is-walking', st.walking);
            const chibi = el.querySelector<HTMLElement>('.utopia-mini-chibi');
            if (chibi) {
              chibi.classList.toggle('is-walking', st.walking);
              chibi.classList.toggle('is-idle', !st.walking);
              chibi.classList.toggle('is-facing-left', st.facing === 'left');
            }
          }
        }
      });

      if (!useDomDrivers && uiAccum >= 0.032) {
        uiAccum = 0;
        setTick((n) => (n + 1) & 0xffff);
      }
      rafId = window.requestAnimationFrame(step);
    };

    rafId = window.requestAnimationFrame(step);
    return () => {
      window.cancelAnimationFrame(rafId);
      resetDomActors();
    };
  }, [habitatId, residents, isTuned, solitude, paused, reducedMotion, stageRef, actorRefs, zBase, zScale]);

  const result: Record<string, UtopiaWalkerFrame> = {};
  for (const [idx, resident] of residents.entries()) {
    const placement = resolvePlacement(resident, isTuned, solitude);
    const st = walkersRef.current.get(resident.id);
    result[resident.id] = st && !reducedMotion
      ? { x: st.x, y: st.y, walking: st.walking, facing: st.facing }
      : {
          x: placement.x,
          y: placement.y,
          walking: false,
          facing: idx % 2 === 0 ? 'right' : 'left',
        };
  }
  return result;
}

export function UtopiaMiniChibiSvg({
  cloakColor,
  headwear,
  size = 40,
  walking = false,
  facing = 'right',
}: {
  cloakColor: string;
  headwear: HeadwearKind;
  size?: number;
  walking?: boolean;
  facing?: 'left' | 'right';
}) {
  const ink = '#3E3025';
  return (
    <span
      aria-hidden="true"
      className={`utopia-mini-chibi${walking ? ' is-walking' : ' is-idle'}${facing === 'left' ? ' is-facing-left' : ''}`}
    >
      <svg
        width={size}
        height={Math.round(size * 1.1)}
        viewBox="0 0 64 70"
        fill="none"
        className="utopia-mini-chibi-svg"
      >
        <ellipse cx="32" cy="65" rx="13.5" ry="3.8" fill="rgba(48, 34, 22, 0.24)" />
        <g className="utopia-mini-chibi-flip">
          <g className="utopia-mini-body">
            {/* Stepping Stockinged Legs & Leather Boots */}
            <g className="utopia-mini-leg is-left">
              <rect x="24" y="51" width="4.4" height="8.2" rx="1.8" fill="#FFFDF7" stroke={ink} strokeWidth="2" />
              <ellipse cx="25.8" cy="60.8" rx="4.2" ry="2.8" fill="#5B4333" stroke={ink} strokeWidth="2.1" />
            </g>
            <g className="utopia-mini-leg is-right">
              <rect x="35.6" y="51" width="4.4" height="8.2" rx="1.8" fill="#FFFDF7" stroke={ink} strokeWidth="2" />
              <ellipse cx="38.2" cy="60.8" rx="4.2" ry="2.8" fill="#5B4333" stroke={ink} strokeWidth="2.1" />
            </g>

            {/* Swinging Coat Sleeves & Little Hands */}
            <g className="utopia-mini-arm is-left">
              <path
                d="M22 37 C17.5 39, 14.8 44, 14.5 48.5 C14.5 50.2, 17 50.8, 18.8 49.5 C20.4 48.2, 21.8 44, 22.8 41 Z"
                fill={cloakColor}
                stroke={ink}
                strokeWidth="2.1"
                strokeLinejoin="round"
              />
              <circle cx="16.2" cy="49.8" r="2.5" fill="#FDE8D2" stroke={ink} strokeWidth="2" />
            </g>
            <g className="utopia-mini-arm is-right">
              <path
                d="M42 37 C46.5 39, 49.2 44, 49.5 48.5 C49.5 50.2, 47 50.8, 45.2 49.5 C43.6 48.2, 42.2 44, 41.2 41 Z"
                fill={cloakColor}
                stroke={ink}
                strokeWidth="2.1"
                strokeLinejoin="round"
              />
              <circle cx="47.8" cy="49.8" r="2.5" fill="#FDE8D2" stroke={ink} strokeWidth="2" />
            </g>

            {/* Cloak body */}
            <path
              d="M18.5 53.5 C19.5 39, 24.2 35, 32 35 C39.8 35, 44.5 39, 45.5 53.5 C40.5 55.8, 23.5 55.8, 18.5 53.5 Z"
              fill={cloakColor}
              stroke={ink}
              strokeWidth="2.5"
              strokeLinejoin="round"
            />
            {/* Scarf collar */}
            <path
              d="M23.5 36.5 Q32 41 40.5 36.5"
              stroke="#FFFDF7"
              strokeWidth="3.2"
              strokeLinecap="round"
            />
            {/* Head & warm cheeks */}
            <circle cx="32" cy="25.5" r="12.5" fill="#FDE8D2" stroke={ink} strokeWidth="2.5" />
            <path
              d="M19.8 24 C20.5 15.5, 26 12.5, 32 12.5 C38 12.5, 43.5 15.5, 44.2 24 C40 20.8, 35.8 19.6, 32 21.2 C28.2 19.6, 24 20.8, 19.8 24 Z"
              fill="#5A4436"
              stroke={ink}
              strokeWidth="2.3"
              strokeLinejoin="round"
            />
            <circle cx="27.4" cy="26.8" r="1.7" fill={ink} />
            <circle cx="37" cy="26.8" r="1.7" fill={ink} />
            <ellipse cx="24.2" cy="29.4" rx="2.3" ry="1.3" fill="#F4A393" opacity="0.74" />
            <ellipse cx="39.8" cy="29.4" rx="2.3" ry="1.3" fill="#F4A393" opacity="0.74" />
            <path d="M29.8 30.2 Q32.2 32 34.6 30.2" stroke={ink} strokeWidth="2" strokeLinecap="round" />

            {/* Headwear */}
            {headwear === 'straw-hat' && (
              <g stroke={ink} strokeWidth="2.3" strokeLinejoin="round">
                <ellipse cx="32" cy="14.5" rx="16.5" ry="4.2" fill="#F5D380" />
                <path d="M23 14 C24 8.5, 40 8.5, 41 14 Z" fill="#F5D380" />
                <path d="M23.5 13.5 Q32 15 40.5 13.5" stroke="#D96B43" strokeWidth="2.4" />
              </g>
            )}
            {headwear === 'beret' && (
              <g stroke={ink} strokeWidth="2.3" strokeLinejoin="round">
                <path d="M18.5 16.5 C19 9, 34 6.5, 44.5 13.5 C42 16.8, 25 17.5, 18.5 16.5 Z" fill="#D96B43" />
                <path d="M32 8.2 L33.5 5.5" strokeLinecap="round" />
              </g>
            )}
            {headwear === 'leaf-sprout' && (
              <g stroke={ink} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M32 12.5 Q32 7.5 31.5 5.5" />
                <path d="M31.8 7.5 C26.5 4.5, 23.5 8.5, 29.5 10.2 Z" fill="#7AC167" />
                <path d="M32.2 7.2 C37.5 4.2, 40.2 8.2, 34.2 10 Z" fill="#7AC167" />
              </g>
            )}
            {headwear === 'star-clip' && (
              <path
                d="M41 11 L42.6 14.3 L46.2 14.8 L43.6 17.3 L44.2 20.8 L41 19.1 L37.8 20.8 L38.4 17.3 L35.8 14.8 L39.4 14.3 Z"
                fill="#F9D65C"
                stroke={ink}
                strokeWidth="2"
                strokeLinejoin="round"
              />
            )}
          </g>
        </g>
      </svg>
    </span>
  );
}

export function DemoUtopiaPreview({
  content: providedContent,
}: {
  content?: UtopiaPreviewContent;
}) {
  const { previewLocale } = useAppPreviewLocale();
  const session = useContext(DemoSessionContext);
  const content = providedContent ?? createUtopiaPreviewContent(previewLocale);

  const [habitatId, setHabitatId] = useState<UtopiaHabitatId>('seaside-island');
  const [tunedByHabitat, setTunedByHabitat] = useState<Partial<Record<UtopiaHabitatId, boolean>>>({});
  const [solitudeAll, setSolitudeAll] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [relocatedOnce, setRelocatedOnce] = useState(false);
  const [activeTab, setActiveTab] = useState<DrawerTab>('residents');
  const [selectedResidentId, setSelectedResidentId] = useState<string>('heguan');
  const [wardrobeOverrides, setWardrobeOverrides] = useState<
    Record<string, { cloak?: string; headwear?: HeadwearKind }>
  >({});
  const [draftText, setDraftText] = useState('');
  const [sentReplies, setSentReplies] = useState<Record<string, string>>({});
  const [selectedWishIndex, setSelectedWishIndex] = useState(0);
  const [wishAppliedId, setWishAppliedId] = useState<string | null>(null);
  const [sampleValidated, setSampleValidated] = useState(false);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const actorRefs = useRef<Map<string, HTMLElement>>(new Map());
  const habitat = content.habitats.find((item) => item.id === habitatId) ?? content.habitats[0]!;
  const isTuned = Boolean(tunedByHabitat[habitat.id]);
  useUtopiaWalkers(habitat.id, habitat.residents, isTuned, solitudeAll, false, {
    stageRef,
    actorRefs,
    zBase: 4,
    zScale: 0.1,
  });

  const selectedResident =
    habitat.residents.find((item) => item.id === selectedResidentId) ?? habitat.residents[0]!;
  const selectedPlacement = resolvePlacement(selectedResident, isTuned, solitudeAll);
  const selectedWish = habitat.wishes[selectedWishIndex] ?? habitat.wishes[0]!;

  const currentOutfit = {
    cloak: wardrobeOverrides[selectedResident.id]?.cloak ?? selectedResident.defaultCloak,
    headwear: wardrobeOverrides[selectedResident.id]?.headwear ?? selectedResident.defaultHeadwear,
  };

  const switchHabitat = (nextId: UtopiaHabitatId) => {
    if (nextId !== habitat.id) {
      setRelocatedOnce(true);
      setHabitatId(nextId);
      setSelectedWishIndex(0);
      setWishAppliedId(null);
    }
  };

  const toggleEnvironment = () => {
    setTunedByHabitat((prev) => ({
      ...prev,
      [habitat.id]: !prev[habitat.id],
    }));
    setWishAppliedId(null);
  };

  const sendDoorstepNote = () => {
    const text = draftText.trim() || content.doorstepQuickNotes[0] || '';
    if (!text) return;
    setSentReplies((prev) => ({
      ...prev,
      [`${habitat.id}:${selectedResident.id}`]: selectedPlacement.doorstepReply,
    }));
    setDraftText('');
  };

  const handoffToZhiyu = () => {
    if (session) {
      session.openPreview('nimi.zhiyu', 'companion', DEFAULT_STORY_AGENT);
    }
  };

  const sentReply = sentReplies[`${habitat.id}:${selectedResident.id}`];

  return (
    <div className="demo-utopia-root" data-demo-utopia-root="true">
      {/* Top Storybook Parchment Horizon Ribbon */}
      <header className="demo-utopia-horizon">
        <div className="demo-utopia-horizon-left">
          <span className="demo-utopia-seal" aria-hidden="true">
            <Compass size={14} />
          </span>
          <strong className="demo-utopia-title">{habitat.title}</strong>
          <span className="demo-utopia-theme">{habitat.themeLabel}</span>
          <span className="demo-utopia-pill is-clock">{habitat.clockLabel}</span>

          <button
            type="button"
            className={`demo-utopia-pill is-interactive${isTuned ? ' is-tuned' : ''}`}
            aria-pressed={isTuned}
            title={content.horizonHint}
            onClick={toggleEnvironment}
          >
            <Sparkles size={13} aria-hidden="true" />
            <span>{isTuned ? habitat.tunedEnvLabel : habitat.normalEnvLabel}</span>
          </button>
        </div>

        <div className="demo-utopia-horizon-right">
          <button
            type="button"
            className={`demo-utopia-pill is-action${solitudeAll ? ' is-active' : ''}`}
            aria-pressed={solitudeAll}
            onClick={() => setSolitudeAll((prev) => !prev)}
          >
            {solitudeAll ? <DoorClosed size={13} aria-hidden="true" /> : <Users size={13} aria-hidden="true" />}
            <span>{solitudeAll ? content.solitudeToggleOn : content.solitudeToggleOff}</span>
          </button>

          <button
            type="button"
            className="demo-utopia-pill is-action"
            aria-pressed={zoomed}
            onClick={() => setZoomed((prev) => !prev)}
          >
            {zoomed ? <ZoomOut size={13} aria-hidden="true" /> : <ZoomIn size={13} aria-hidden="true" />}
            <span>{zoomed ? content.zoomCloseup : content.zoomOverview}</span>
          </button>
        </div>
      </header>

      <div className="demo-utopia-workspace">
        {/* Left: Hand-Drawn 2.5D Habitat Scroll Viewport */}
        <div className="demo-utopia-stage-col">
          <div className={`demo-utopia-canvas${zoomed ? ' is-zoomed' : ''}`}>
            <div
              ref={stageRef}
              className="demo-utopia-canvas-inner"
              style={
                zoomed
                  ? {
                      transform: `translate3d(${(-0.28 * selectedPlacement.x).toFixed(2)}%, ${(-0.28 * selectedPlacement.y).toFixed(2)}%, 0) scale(1.28)`,
                    }
                  : undefined
              }
            >
              <img
                src={habitat.baseImageSrc}
                alt={habitat.title}
                className="demo-utopia-base-img"
                decoding="async"
              />
              <img
                src={habitat.overlayImageSrc}
                alt=""
                aria-hidden="true"
                className={`demo-utopia-overlay-img${isTuned ? ' is-visible' : ''}`}
                decoding="async"
              />

              {/* Courtyard Place Markers (hide when occupied by a resident pin to avoid badge overlap) */}
              {(() => {
                const occupiedPlaceIds = new Set(
                  habitat.residents.map((resident) => resolvePlacement(resident, isTuned, solitudeAll).placeId),
                );
                return habitat.places
                  .filter((place) => !occupiedPlaceIds.has(place.id))
                  .map((place) => {
                    const closed = Boolean(isTuned && place.closedWhenTuned);
                    return (
                      <span
                        key={place.id}
                        className={`demo-utopia-place-tag${closed ? ' is-closed' : ''}`}
                        style={{ left: `${place.x}%`, top: `${place.y}%` }}
                      >
                        <MapPin size={10} aria-hidden="true" />
                        <span>{place.name}</span>
                      </span>
                    );
                  });
              })()}

              {/* Living Walking Chibi Companion Pins */}
              {habitat.residents.map((resident, idx) => {
                const placement = resolvePlacement(resident, isTuned, solitudeAll);
                const outfit = {
                  cloak: wardrobeOverrides[resident.id]?.cloak ?? resident.defaultCloak,
                  headwear: wardrobeOverrides[resident.id]?.headwear ?? resident.defaultHeadwear,
                };
                const isSelected = resident.id === selectedResident.id;
                return (
                  <button
                    key={resident.id}
                    ref={(node) => {
                      if (node) actorRefs.current.set(resident.id, node);
                      else actorRefs.current.delete(resident.id);
                    }}
                    type="button"
                    aria-pressed={isSelected}
                    className={`demo-utopia-actor${isSelected ? ' is-selected' : ''}`}
                    style={{
                      left: `${placement.x.toFixed(2)}%`,
                      top: `${placement.y.toFixed(2)}%`,
                      zIndex: 4 + Math.round(placement.y * 0.1),
                    }}
                    onClick={() => {
                      setSelectedResidentId(resident.id);
                      setActiveTab('residents');
                    }}
                  >
                    <UtopiaMiniChibiSvg
                      cloakColor={outfit.cloak}
                      headwear={outfit.headwear}
                      size={44}
                      walking={false}
                      facing={idx % 2 === 0 ? 'right' : 'left'}
                    />
                    <span className="demo-utopia-actor-label">
                      <strong>{resident.name}</strong>
                      <small>{placement.placeName}</small>
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Bottom Habitat Scroll Switcher Dock */}
            <div className="demo-utopia-habitat-dock" role="group" aria-label={content.packSectionHeading}>
              {content.habitats.map((item) => {
                const active = item.id === habitat.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={active}
                    className={`demo-utopia-habitat-chip${active ? ' is-active' : ''}`}
                    onClick={() => switchHabitat(item.id)}
                  >
                    <span>{item.shortTitle}</span>
                  </button>
                );
              })}
              <span className="demo-utopia-pack-tag">{content.packBadge}</span>
            </div>
          </div>

          <p className="demo-utopia-consequence-bar">
            <Sparkles size={13} aria-hidden="true" />
            <span>{isTuned ? habitat.tunedConsequence : habitat.normalConsequence}</span>
          </p>
        </div>

        {/* Right: Storybook Parchment Drawer */}
        <aside className="demo-utopia-drawer">
          <div className="demo-utopia-tabs" role="tablist">
            {(
              [
                ['residents', content.drawerTabs.residents, MessageCircle],
                ['journal', content.drawerTabs.journal, BookOpen],
                ['tuner', content.drawerTabs.tuner, Sliders],
              ] as const
            ).map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={activeTab === id}
                className={`demo-utopia-tab${activeTab === id ? ' is-active' : ''}`}
                onClick={() => setActiveTab(id)}
              >
                <Icon size={13.5} aria-hidden="true" />
                <span>{label}</span>
              </button>
            ))}
          </div>

          <div className="demo-utopia-drawer-body">
            {activeTab === 'residents' && (
              <div className="demo-utopia-panel">
                <div className="demo-utopia-resident-pills">
                  {habitat.residents.map((resident) => (
                    <button
                      key={resident.id}
                      type="button"
                      aria-pressed={resident.id === selectedResident.id}
                      className={`demo-utopia-resident-chip${resident.id === selectedResident.id ? ' is-active' : ''}`}
                      onClick={() => setSelectedResidentId(resident.id)}
                    >
                      <img src={resident.avatarSrc} alt="" width={22} height={22} />
                      <span>{resident.name}</span>
                    </button>
                  ))}
                </div>

                <div className="demo-utopia-profile-card">
                  <div className="demo-utopia-profile-head">
                    <img src={selectedResident.avatarSrc} alt="" width={44} height={44} />
                    <div>
                      <span className="demo-utopia-world-pill">{selectedResident.worldName}</span>
                      <strong>{selectedResident.name}</strong>
                      <small>{selectedResident.role}</small>
                    </div>
                    <UtopiaMiniChibiSvg
                      cloakColor={currentOutfit.cloak}
                      headwear={currentOutfit.headwear}
                      size={42}
                      walking={false}
                    />
                  </div>
                  <div className="demo-utopia-status-box">
                    <strong>
                      {selectedPlacement.placeName} · {selectedPlacement.activityTitle}
                    </strong>
                    <p>{selectedPlacement.detail}</p>
                  </div>

                  {/* Chibi Wardrobe Quick Customizer */}
                  <div className="demo-utopia-wardrobe">
                    <span className="demo-utopia-label">{content.wardrobeLabel}</span>
                    <div className="demo-utopia-wardrobe-row">
                      <div className="demo-utopia-swatches">
                        {content.cloakColors.map((swatch) => (
                          <button
                            key={swatch.hex}
                            type="button"
                            aria-label={swatch.label}
                            aria-pressed={currentOutfit.cloak === swatch.hex}
                            title={swatch.label}
                            className={`demo-utopia-swatch${currentOutfit.cloak === swatch.hex ? ' is-active' : ''}`}
                            style={{ backgroundColor: swatch.hex }}
                            onClick={() =>
                              setWardrobeOverrides((prev) => ({
                                ...prev,
                                [selectedResident.id]: {
                                  ...prev[selectedResident.id],
                                  cloak: swatch.hex,
                                },
                              }))
                            }
                          />
                        ))}
                      </div>
                      <div className="demo-utopia-headwear-pills">
                        {content.headwearOptions.map((hw) => (
                          <button
                            key={hw.id}
                            type="button"
                            aria-pressed={currentOutfit.headwear === hw.id}
                            className={`demo-utopia-mini-btn${currentOutfit.headwear === hw.id ? ' is-active' : ''}`}
                            onClick={() =>
                              setWardrobeOverrides((prev) => ({
                                ...prev,
                                [selectedResident.id]: {
                                  ...prev[selectedResident.id],
                                  headwear: hw.id,
                                },
                              }))
                            }
                          >
                            {hw.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Zero-Side-Effect Doorstep Note & Zhiyu Handoff */}
                <div className="demo-utopia-doorstep">
                  <strong>{content.doorstepHeading}</strong>
                  <p className="demo-utopia-hint">{content.doorstepHint}</p>
                  <div className="demo-utopia-quick-notes">
                    {content.doorstepQuickNotes.map((note) => (
                      <button
                        key={note}
                        type="button"
                        className="demo-utopia-quick-chip"
                        onClick={() => setDraftText(note)}
                      >
                        {note}
                      </button>
                    ))}
                  </div>
                  <textarea
                    rows={2}
                    value={draftText}
                    onChange={(event) => setDraftText(event.target.value)}
                    aria-label={content.doorstepPlaceholder}
                    placeholder={content.doorstepPlaceholder}
                    className="demo-utopia-textarea"
                  />
                  {sentReply ? (
                    <div className="demo-utopia-reply-bubble">
                      <span>{content.doorstepSentBadge}</span>
                      <p>{sentReply}</p>
                    </div>
                  ) : null}
                  <div className="demo-utopia-doorstep-actions">
                    <button
                      type="button"
                      className="demo-utopia-btn is-primary"
                      onClick={sendDoorstepNote}
                    >
                      <Send size={13} aria-hidden="true" />
                      <span>{content.doorstepSendAction}</span>
                    </button>
                    {session ? (
                      <button
                        type="button"
                        className="demo-utopia-btn is-handoff"
                        onClick={handoffToZhiyu}
                      >
                        <img src="/demo/zhiyu-icon.png" alt="" width={15} height={15} />
                        <span>{content.zhiyuHandoffAction}</span>
                        <ArrowRight size={13} aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'journal' && (
              <div className="demo-utopia-panel">
                <div className="demo-utopia-section-head">
                  <strong>{content.journalHeading}</strong>
                  <p>{content.journalSubheading}</p>
                </div>

                {relocatedOnce ? (
                  <div className="demo-utopia-relocation-banner">
                    <Check size={14} aria-hidden="true" />
                    <span>{content.relocationGraceNote}</span>
                  </div>
                ) : null}

                <div className="demo-utopia-shared-card">
                  <span className="demo-utopia-badge">{content.sharedActivityBadge}</span>
                  <p>{habitat.sharedMomentLabel}</p>
                </div>

                <ul className="demo-utopia-place-list">
                  {habitat.places.map((place) => {
                    const closed = Boolean(isTuned && place.closedWhenTuned);
                    return (
                      <li key={place.id} className={closed ? 'is-closed' : undefined}>
                        <div>
                          <strong>{place.name}</strong>
                          <p>{place.sensory}</p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {activeTab === 'tuner' && (
              <div className="demo-utopia-panel">
                <div className="demo-utopia-section-head">
                  <strong>{content.tunerHeading}</strong>
                  <p className="demo-utopia-privacy-line">
                    <Lock size={12.5} aria-hidden="true" />
                    <span>{content.tunerPrivacyNote}</span>
                  </p>
                </div>

                <div className="demo-utopia-wishes">
                  {habitat.wishes.map((wish, idx) => (
                    <button
                      key={wish.id}
                      type="button"
                      aria-pressed={idx === selectedWishIndex}
                      className={`demo-utopia-wish-chip${idx === selectedWishIndex ? ' is-active' : ''}`}
                      onClick={() => {
                        setSelectedWishIndex(idx);
                        setWishAppliedId(null);
                      }}
                    >
                      {wish.prompt}
                    </button>
                  ))}
                </div>

                <div className="demo-utopia-diff-box">
                  <span className="demo-utopia-label">{content.tunerPreviewLabel}</span>
                  <strong>{selectedWish.summary}</strong>
                  <code>{selectedWish.parameterDiff}</code>
                  <small>{selectedWish.placeDiff}</small>
                  <button
                    type="button"
                    className="demo-utopia-btn is-primary"
                    onClick={() => {
                      setTunedByHabitat((prev) => ({
                        ...prev,
                        [habitat.id]: selectedWish.targetTuned,
                      }));
                      setWishAppliedId(selectedWish.id);
                    }}
                  >
                    <Sparkles size={13} aria-hidden="true" />
                    <span>
                      {wishAppliedId === selectedWish.id
                        ? content.tunerAppliedNote
                        : content.tunerApplyAction}
                    </span>
                  </button>
                </div>

                <div className="demo-utopia-pack-card">
                  <span className="demo-utopia-label">{content.packSectionHeading}</span>
                  <strong>{content.creatorSampleTitle}</strong>
                  <small>{content.creatorSampleMeta}</small>
                  <ul>
                    {content.creatorSampleChecks.map((line) => (
                      <li key={line}>
                        <Check size={12.5} aria-hidden="true" />
                        <span>{line}</span>
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    className="demo-utopia-btn"
                    onClick={() => setSampleValidated(true)}
                  >
                    <PackageCheck size={13.5} aria-hidden="true" />
                    <span>
                      {sampleValidated ? content.validatedSampleBadge : content.validateSampleAction}
                    </span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
