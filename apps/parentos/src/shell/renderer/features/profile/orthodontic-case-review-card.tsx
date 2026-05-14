/**
 * Case-level consolidated review card (PO-ORTHO-015). When a case runs
 * multiple appliances in parallel they often share one physical clinic visit;
 * this card surfaces the nearest review date across all active appliances and
 * lists each appliance's parent-entered agenda ("当次议程") so the parent walks
 * in knowing what every appliance needs that visit.
 */
import type { OrthodonticApplianceRow } from '../../bridge/sqlite-bridge.js';
import { S } from '../../app-shell/page-style.js';
import { applianceIdentity } from './appliance-identity.js';
import { applianceTypeLabel } from './orthodontic-derive.js';
import { formatMonthDay } from './appliance-card-shared.js';

export function OrthodonticCaseReviewCard({
  appliances,
  nowIso,
  onLogClinicalEvent,
}: {
  /** Active appliances of the case. */
  appliances: OrthodonticApplianceRow[];
  nowIso: string;
  onLogClinicalEvent: () => void;
}) {
  const reviewDates = appliances
    .map((a) => a.nextReviewDate)
    .filter((d): d is string => d !== null)
    .sort();
  const nextReview = reviewDates[0] ?? null;
  const daysAway =
    nextReview !== null
      ? Math.round(
          (new Date(`${nextReview}T00:00:00.000Z`).getTime() - new Date(nowIso).getTime()) /
            (1000 * 60 * 60 * 24),
        )
      : null;

  return (
    <section
      style={{
        background: '#ffffff',
        borderRadius: 24,
        padding: '22px 26px',
        boxShadow: '0 8px 28px rgba(15,23,42,0.07), 0 1px 3px rgba(15,23,42,0.05)',
        display: 'flex',
        gap: 28,
        alignItems: 'flex-start',
        flexWrap: 'wrap',
      }}
    >
      {/* left: consolidated date */}
      <div style={{ minWidth: 150 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--nimi-text-muted)',
          }}
        >
          下次复诊
          {daysAway !== null && (
            <span
              style={{
                fontSize: 11,
                padding: '2px 8px',
                borderRadius: 999,
                background: daysAway < 0 ? 'rgba(245,158,11,0.18)' : 'rgba(16,185,129,0.18)',
                color: daysAway < 0 ? '#9a6404' : '#047857',
                fontWeight: 600,
                textTransform: 'none',
                letterSpacing: 0,
              }}
            >
              {daysAway < 0 ? `已过期 ${-daysAway} 天` : `还有 ${daysAway} 天`}
            </span>
          )}
        </div>
        <div
          style={{
            fontSize: 30,
            fontWeight: 700,
            letterSpacing: '-0.02em',
            color: 'var(--nimi-text-primary)',
            marginTop: 8,
          }}
        >
          {nextReview ? formatMonthDay(nextReview) : '未安排'}
        </div>
        {nextReview && (
          <div style={{ fontSize: 12, color: S.sub, marginTop: 2, fontFamily: 'var(--nimi-font-mono)' }}>
            {nextReview}
          </div>
        )}
      </div>

      {/* middle: per-appliance agenda */}
      <div style={{ flex: 1, minWidth: 220 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--nimi-text-muted)',
            marginBottom: 10,
          }}
        >
          当次议程
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {appliances.map((appliance) => {
            const identity = applianceIdentity(appliance.applianceType);
            return (
              <div
                key={appliance.applianceId}
                style={{ display: 'flex', alignItems: 'baseline', gap: 10, fontSize: 13 }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: 999,
                    background: identity.solid,
                    flexShrink: 0,
                    transform: 'translateY(1px)',
                  }}
                />
                <span style={{ color: 'var(--nimi-text-primary)', fontWeight: 600, minWidth: 96 }}>
                  {applianceTypeLabel(appliance.applianceType)}
                </span>
                {/* PO-ORTHO-015: a parent-empty agenda renders as a neutral
                    empty marker — never fabricated or inferred agenda text. */}
                <span style={{ color: appliance.nextReviewAgenda ? S.text : S.sub }}>
                  {appliance.nextReviewAgenda ?? '—'}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* right: log visit */}
      <button
        type="button"
        onClick={onLogClinicalEvent}
        className="text-white hover:-translate-y-0.5"
        style={{
          background: 'var(--nimi-text-primary)',
          border: 0,
          padding: '11px 22px',
          borderRadius: 999,
          cursor: 'pointer',
          fontSize: 13,
          fontWeight: 600,
          fontFamily: 'inherit',
          boxShadow: '0 6px 18px rgba(15,23,42,0.16)',
          transition: 'all 160ms',
          whiteSpace: 'nowrap',
          flexShrink: 0,
        }}
      >
        记录就诊
      </button>
    </section>
  );
}
