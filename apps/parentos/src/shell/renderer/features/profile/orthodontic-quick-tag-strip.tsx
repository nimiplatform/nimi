import { S } from '../../app-shell/page-style.js';

/**
 * Admitted quick-tag identifiers. Each one routes to a typed parent
 * callback that mounts the right modal with a prefilled payload. The names
 * are taken from the Claude Designs reference; the routing semantics are
 * captured in `OrthodonticPage` so this surface stays a pure leaf.
 */
export type OrthodonticQuickTagId =
  | 'fall'
  | 'break'
  | 'miss'
  | 'pain'
  | 'swell'
  | 'note';

export type OrthodonticQuickTagGroup = 'device' | 'symptom';

interface Tag {
  id: OrthodonticQuickTagId;
  label: string;
  group: OrthodonticQuickTagGroup;
}

const TAGS: Tag[] = [
  { id: 'fall', label: '脱落', group: 'device' },
  { id: 'break', label: '断裂', group: 'device' },
  { id: 'miss', label: '漏戴', group: 'device' },
  { id: 'pain', label: '疼痛', group: 'symptom' },
  { id: 'swell', label: '肿胀', group: 'symptom' },
  { id: 'note', label: '其他', group: 'symptom' },
];

interface GroupSpec {
  group: OrthodonticQuickTagGroup;
  label: string;
  hint: string;
}

const GROUPS: GroupSpec[] = [
  { group: 'device', label: '牙套状况', hint: '通常需要联系诊所' },
  { group: 'symptom', label: '症状反馈', hint: '先记录、再观察' },
];

interface Props {
  onTagClick: (id: OrthodonticQuickTagId) => void;
}

/**
 * Two-group quick-log strip rendered inside the wearing hero. Each chip is
 * a parent-initiated entry point into the clinical event / un-wear backfill
 * modals — the click is forwarded to `onTagClick` and the page-level
 * controller decides which modal to mount with what prefill.
 *
 * The strip itself stores nothing and writes nothing. It is a navigation
 * surface, not a record. PO-ORTHO-010 boundary is preserved by routing
 * everything through the typed modals (no inline AI inference here).
 */
export function OrthodonticQuickTagStrip({ onTagClick }: Props) {
  return (
    <div
      role="group"
      aria-label="快速记录"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '12px 14px',
        borderRadius: 14,
        background: 'rgba(255,255,255,0.55)',
        border: '1px solid var(--nimi-border-subtle)',
      }}
    >
      {GROUPS.map((g) => {
        const items = TAGS.filter((t) => t.group === g.group);
        return (
          <div
            key={g.group}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              flexWrap: 'wrap',
            }}
          >
            <span
              title={g.hint}
              style={{
                fontSize: 11,
                color: 'var(--nimi-text-muted)',
                letterSpacing: '0.04em',
                fontWeight: 500,
                whiteSpace: 'nowrap',
                minWidth: 56,
              }}
            >
              {g.label}
            </span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: 1 }}>
              {items.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onTagClick(t.id)}
                  className="orthodontic-quick-tag"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '5px 12px',
                    borderRadius: 999,
                    border: '1px solid transparent',
                    background: 'rgba(15,23,42,0.045)',
                    cursor: 'pointer',
                    fontSize: 12,
                    fontWeight: 500,
                    color: 'var(--nimi-text-secondary)',
                    fontFamily: 'inherit',
                    whiteSpace: 'nowrap',
                    transition: 'all 160ms',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#ffffff';
                    e.currentTarget.style.borderColor = S.accent;
                    e.currentTarget.style.color = 'var(--nimi-text-primary)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(15,23,42,0.045)';
                    e.currentTarget.style.borderColor = 'transparent';
                    e.currentTarget.style.color = 'var(--nimi-text-secondary)';
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Friendly label for a tag id, used by callers when they need to display
 * the same string they showed in the strip (e.g. modal prefilled notes).
 */
export function quickTagLabel(id: OrthodonticQuickTagId): string {
  return TAGS.find((t) => t.id === id)?.label ?? id;
}

/**
 * Maps a quick-tag id to the deterministic notes prefill string for the
 * `OrthoClinicalEventModal`. Device-class tags read as "装置X"; symptom-
 * class tags read as "症状: X"; `note` is a free-form entry with no prefill.
 *
 * Returns `null` when the tag is `miss` (漏戴) — that one routes to the
 * un-wear backfill form, NOT the clinical event modal.
 */
export function quickTagClinicalEventPrefill(id: OrthodonticQuickTagId): string | null {
  switch (id) {
    case 'fall':
      return '装置脱落';
    case 'break':
      return '装置断裂';
    case 'pain':
      return '症状: 疼痛';
    case 'swell':
      return '症状: 肿胀';
    case 'note':
      return '';
    case 'miss':
      return null;
  }
}
