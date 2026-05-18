/**
 * Count-based layout dispatcher for the multi-appliance orthodontic surface
 * (PO-ORTHO-003a). Hero cards are always presented in pairs; the appliance
 * that would otherwise be left unpaired is promoted to a full-width compact
 * card rather than shrunk, so visual weight stays balanced at any count:
 *
 *   1 → 1 hero (full width)
 *   2 → 2 hero side-by-side
 *   3 → 2 hero + 1 compact
 *   4 → 2×2 hero
 *   5 → 2×2 hero + 1 compact
 *   N → even: N/2 hero rows; odd: (N-1)/2 hero rows + 1 compact
 *
 * The hero appliances' forward actions live in `ApplianceNextActionRow`, which
 * is rendered by the parent shell adjacent to the case-level review card so
 * the two "next steps" surfaces share one horizontal row. Input is expected
 * pre-sorted by appliance priority so the highest-priority appliance leads
 * and the lowest is the one promoted to compact.
 */
import type {
  OrthodonticApplianceRow,
  OrthodonticCaseRow,
  OrthodonticCheckinRow,
  OrthodonticUnwearIntervalRow,
} from '../../bridge/sqlite-bridge.js';
import { ApplianceHeroCard } from './appliance-hero-card.js';
import { ApplianceCompactCard } from './appliance-compact-card.js';
import type { ApplianceCardHandlers } from './appliance-card-shared.js';

export interface ApplianceGridItem {
  appliance: OrthodonticApplianceRow;
  intervals: OrthodonticUnwearIntervalRow[];
  checkins: OrthodonticCheckinRow[];
}

/**
 * Split a sorted appliance list into the hero appliances (rendered as large
 * cards, paired side-by-side) and an optional compact appliance (the
 * lowest-priority one when the total count is odd). Exported so the shell can
 * derive hero appliances for the externalised next-action row without
 * re-deriving the count formula.
 */
export function splitApplianceGridItems(items: ApplianceGridItem[]): {
  heroItems: ApplianceGridItem[];
  compactItem: ApplianceGridItem | null;
} {
  const count = items.length;
  const isOdd = count > 1 && count % 2 === 1;
  const heroItems = isOdd ? items.slice(0, count - 1) : items;
  const compactItem = isOdd ? items[count - 1]! : null;
  return { heroItems, compactItem };
}

export function OrthodonticAppliancesGrid({
  items,
  caseRow,
  childBirthDate,
  nowIso,
  handlers,
}: {
  /** Active appliances + their per-appliance data, pre-sorted by priority. */
  items: ApplianceGridItem[];
  caseRow: OrthodonticCaseRow;
  childBirthDate: string;
  nowIso: string;
  handlers: ApplianceCardHandlers;
}) {
  const { heroItems, compactItem } = splitApplianceGridItems(items);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns:
            heroItems.length <= 1 ? '1fr' : 'repeat(2, minmax(0, 1fr))',
          gap: 16,
        }}
      >
        {heroItems.map((item) => (
          <ApplianceHeroCard
            key={item.appliance.applianceId}
            appliance={item.appliance}
            caseRow={caseRow}
            childBirthDate={childBirthDate}
            intervals={item.intervals}
            checkins={item.checkins}
            nowIso={nowIso}
            handlers={handlers}
          />
        ))}
      </div>

      {compactItem && (
        <ApplianceCompactCard
          appliance={compactItem.appliance}
          caseRow={caseRow}
          childBirthDate={childBirthDate}
          intervals={compactItem.intervals}
          checkins={compactItem.checkins}
          nowIso={nowIso}
          handlers={handlers}
        />
      )}
    </div>
  );
}
