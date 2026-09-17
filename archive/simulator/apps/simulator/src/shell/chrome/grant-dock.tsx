import {
  ArrowRight,
  Check,
  Clock3,
  KeyRound,
  Sparkles,
  X,
} from 'lucide-react';
import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from 'react';
import {
  useProductPresentation,
  type PresentationGrant,
} from './product-presentation.tsx';
import { AppLogo } from './app-logo.tsx';

type GrantDockStatus = PresentationGrant['status'];

interface GrantCardGeometry {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly rotateY: number;
  readonly rotateZ: number;
  readonly scale: number;
  readonly opacity: number;
}

const STATUS_LABEL: Readonly<Record<GrantDockStatus, string>> = {
  pending: '待授权',
  active: '已授权',
  revoked: '已撤销',
};

const CARD_STRIDE = 72;
const RESTING_HIT_INSET = 124;

/**
 * The dock is a projection over the existing deterministic grant state:
 * every grant from the current logical day, plus unresolved grants from an
 * earlier logical day. Historical resolved grants stay in the ledger.
 */
export function selectGrantDockCards(
  grants: readonly PresentationGrant[],
): readonly PresentationGrant[] {
  const earlierPending = grants.filter(
    (grant) => grant.day === 'earlier' && grant.status === 'pending',
  );
  const today = grants.filter((grant) => grant.day !== 'earlier');
  return [...earlierPending, ...today];
}

/**
 * Receipts rest as a straight row of upright book-like volumes. Hover turns
 * the targeted receipt into a crest while its neighbours follow a continuous
 * wave; click reveals the receipt actions in the same card.
 */
export function grantCardGeometry(
  index: number,
  activeIndex: number,
  cardCount: number,
): GrantCardGeometry {
  const baseX = index * CARD_STRIDE;
  const depth = cardCount <= 1 ? 0 : index / (cardCount - 1);
  const resting: GrantCardGeometry = {
    x: baseX,
    y: 0,
    z: 0,
    rotateY: -64,
    rotateZ: 0,
    scale: 0.88,
    opacity: 1 - depth * 0.52,
  };
  if (activeIndex < 0) return resting;

  const distance = index - activeIndex;
  const magnitude = Math.abs(distance);
  const side = Math.sign(distance);
  const lift = Math.max(0, 62 - magnitude * magnitude * 14 - magnitude * 4);
  const targeted = magnitude === 0;
  return {
    x: baseX + side * Math.min(magnitude * 4, 10),
    y: -lift,
    z: targeted ? 160 : -40 - magnitude * 20,
    rotateY: targeted ? 0 : -18 - Math.min(magnitude * 8, 24),
    rotateZ: targeted ? 0 : side * Math.min(magnitude * 3.2, 7),
    scale: targeted ? 1.04 : Math.max(0.84, 0.94 - magnitude * 0.025),
    opacity: targeted ? 1 : Math.max(0.16, 0.46 - magnitude * 0.12),
  };
}

function cardStyle(geometry: GrantCardGeometry, index: number): CSSProperties {
  const slotX = index * CARD_STRIDE + RESTING_HIT_INSET;
  return {
    ['--grant-slot-x' as string]: `${slotX}px`,
    ['--grant-card-x' as string]: `${geometry.x - slotX}px`,
    ['--grant-card-y' as string]: `${geometry.y}px`,
    ['--grant-card-z' as string]: `${geometry.z}px`,
    ['--grant-card-rotate-y' as string]: `${geometry.rotateY}deg`,
    ['--grant-card-rotate-z' as string]: `${geometry.rotateZ}deg`,
    ['--grant-card-scale' as string]: geometry.scale,
    ['--grant-card-opacity' as string]: geometry.opacity,
    ['--grant-card-order' as string]: index,
  };
}

function StatusMark({ status }: { readonly status: GrantDockStatus }) {
  return (
    <span className="grant-receipt-card__status-mark" data-status={status} aria-hidden="true">
      {status === 'active' ? <Check size={14} strokeWidth={2.4} /> : null}
      {status === 'pending' ? <Clock3 size={13} strokeWidth={2.2} /> : null}
      {status === 'revoked' ? <X size={13} strokeWidth={2.2} /> : null}
    </span>
  );
}

function grantSourceModuleId(grant: PresentationGrant): 'desktop' | 'zhiyu' | null {
  const source = grant.from.toLowerCase();
  if (source.startsWith('desktop')) return 'desktop';
  if (source.startsWith('zhiyu')) return 'zhiyu';
  return null;
}

function GrantSourceIcon({ grant }: { readonly grant: PresentationGrant }) {
  const moduleId = grantSourceModuleId(grant);
  return (
    <span className="grant-receipt-card__app-icon" aria-hidden="true">
      {moduleId
        ? <AppLogo moduleId={moduleId} size="card" />
        : <Sparkles size={19} strokeWidth={1.8} />}
    </span>
  );
}

export function grantGeneratedDayLabel(grant: PresentationGrant): string {
  if (grant.day !== 'earlier') return '今天';
  const [, month, day] = grant.generatedDate.split('-');
  return `${Number(month)}月${Number(day)}日`;
}

function GrantCardContent({
  grant,
  logicalDay,
}: {
  readonly grant: PresentationGrant;
  readonly logicalDay: string;
}) {
  return (
    <>
      <span className="grant-receipt-card__topline">
        <span className="grant-receipt-card__identity">
          <GrantSourceIcon grant={grant} />
          <span className="grant-receipt-card__identity-copy">
            <span className="grant-receipt-card__app-name">{grant.from}</span>
            <span className="grant-receipt-card__eyebrow">授权卡 · {logicalDay}</span>
          </span>
        </span>
        <StatusMark status={grant.status} />
      </span>

      <span className="grant-receipt-card__route">
        <span>{grant.from}</span>
        <ArrowRight size={14} strokeWidth={1.7} aria-hidden="true" />
        <span>{grant.to}</span>
      </span>

      <span className="grant-receipt-card__title">{grant.title}</span>
      <span className="grant-receipt-card__access">
        <KeyRound size={13} strokeWidth={1.8} aria-hidden="true" />
        <span>{grant.receipt.access}</span>
        <span aria-hidden="true">·</span>
        <span>{grant.receipt.range}</span>
      </span>

      <span className="grant-receipt-card__validity-row">
        <Clock3 size={13} strokeWidth={1.8} aria-hidden="true" />
        <span className="grant-receipt-card__validity-label">有效期</span>
        <span className="grant-receipt-card__validity-value">{grant.receipt.validity}</span>
        {grant.receipt.expiry ? (
          <span className="grant-receipt-card__expiry">{grant.receipt.expiry}</span>
        ) : null}
      </span>

      <span className="grant-receipt-card__footer">
        <span className="grant-receipt-card__state">
          <span>{STATUS_LABEL[grant.status]}</span>
        </span>
        <span className="grant-receipt-card__time">{grant.meta}</span>
      </span>
    </>
  );
}

function GrantReceiptCard({
  grant,
  index,
  cardCount,
  activeIndex,
  onHover,
  onLeave,
  detailOpen,
  onToggleDetail,
  onResolve,
}: {
  readonly grant: PresentationGrant;
  readonly index: number;
  readonly cardCount: number;
  readonly activeIndex: number;
  readonly onHover: (grantId: string) => void;
  readonly onLeave: () => void;
  readonly detailOpen: boolean;
  readonly onToggleDetail: (grantId: string) => void;
  readonly onResolve: (grantId: string, accept: boolean) => void;
}) {
  const active = index === activeIndex;
  const geometry = grantCardGeometry(index, activeIndex, cardCount);
  const logicalDay = grantGeneratedDayLabel(grant);
  return (
    <article
      className="grant-receipt-slot"
      data-active={active || undefined}
      data-detail-open={detailOpen || undefined}
      role="listitem"
      style={cardStyle(geometry, index)}
      onPointerEnter={() => onHover(grant.id)}
      onPointerLeave={onLeave}
      onFocusCapture={() => onHover(grant.id)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onLeave();
      }}
    >
      <button
        type="button"
        className="grant-receipt-slot__trigger"
        aria-label={`${STATUS_LABEL[grant.status]}授权卡：${grant.title}，${logicalDay}`}
        aria-expanded={detailOpen}
        aria-controls={`grant-actions-${grant.id}`}
        disabled={grant.status === 'revoked'}
        onClick={() => onToggleDetail(grant.id)}
      />
      <div
        className="grant-receipt-card"
        data-status={grant.status}
        data-active={active || undefined}
        data-detail-open={detailOpen || undefined}
      >
        <div className="grant-receipt-card__select">
          <GrantCardContent grant={grant} logicalDay={logicalDay} />
        </div>

        {detailOpen && grant.status === 'pending' ? (
          <span
            id={`grant-actions-${grant.id}`}
            className="grant-receipt-card__actions"
            role="group"
            aria-label={`授权卡操作：${grant.title}`}
          >
            <button
              type="button"
              className="grant-receipt-card__action grant-receipt-card__action--deny"
              onClick={() => onResolve(grant.id, false)}
            >
              拒绝
            </button>
            <button
              type="button"
              className="grant-receipt-card__action grant-receipt-card__action--approve"
              onClick={() => onResolve(grant.id, true)}
            >
              授权
            </button>
          </span>
        ) : null}

        {detailOpen ? (
          <button
            type="button"
            className="grant-receipt-card__close"
            aria-label="收起授权卡选项"
            onClick={() => onToggleDetail(grant.id)}
          >
            <X size={13} strokeWidth={2} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </article>
  );
}

export function GrantDock() {
  const { grants, resolveGrant } = useProductPresentation();
  const cards = useMemo(() => selectGrantDockCards(grants), [grants]);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  useEffect(() => {
    if (detailId && !cards.some((grant) => grant.id === detailId)) setDetailId(null);
    if (hoveredId && !cards.some((grant) => grant.id === hoveredId)) setHoveredId(null);
  }, [cards, detailId, hoveredId]);

  if (cards.length === 0) return null;

  const activeId = hoveredId ?? detailId;
  const activeIndex = activeId ? cards.findIndex((grant) => grant.id === activeId) : -1;
  return (
    <aside
      className="grant-dock"
      aria-label={`授权卡：共 ${cards.length} 张`}
      data-active={activeIndex >= 0 || undefined}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && detailId) {
          event.stopPropagation();
          setDetailId(null);
        }
      }}
    >
      <div
        className="grant-dock__track"
        role="list"
        aria-label="授权卡"
        style={{ ['--grant-card-count' as string]: cards.length }}
      >
        {cards.map((grant, index) => (
          <GrantReceiptCard
            key={grant.id}
            grant={grant}
            index={index}
            cardCount={cards.length}
            activeIndex={activeIndex}
            onHover={setHoveredId}
            onLeave={() => setHoveredId(null)}
            detailOpen={detailId === grant.id}
            onToggleDetail={(grantId) => {
              setDetailId((current) => current === grantId ? null : grantId);
            }}
            onResolve={resolveGrant}
          />
        ))}
      </div>
    </aside>
  );
}
