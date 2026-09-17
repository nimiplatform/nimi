import { useProductPresentation } from './product-presentation.tsx';
import type {
  LedgerFilter,
  PresentationLedgerEntry,
  PresentationLedgerKind,
  PresentationLedgerResult,
} from './product-presentation.tsx';

const FILTERS: { id: LedgerFilter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'grant', label: '授权' },
  { id: 'call', label: '调用' },
  { id: 'system', label: '系统' },
  { id: 'uncommitted', label: '未生效' },
];

const KIND_LABEL: Record<PresentationLedgerKind, string> = {
  delegation: '授权',
  'agent-action': '调用用途',
  flow: '调用用途',
  system: '系统',
};

const KIND_TONE: Record<PresentationLedgerKind, string> = {
  delegation: 'grant',
  'agent-action': 'call',
  flow: 'call',
  system: '',
};

const RESULT_LABEL: Record<PresentationLedgerResult, string> = {
  committed: '已生效',
  pending: '待确认',
  unsupported: '未提交',
  denied: '已拒绝',
  info: '信息',
};

const RESULT_TONE: Record<PresentationLedgerResult, string> = {
  committed: 'success',
  pending: 'warning',
  unsupported: 'warning',
  denied: 'danger',
  info: '',
};

function matchesFilter(e: PresentationLedgerEntry, filter: LedgerFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'grant':
      return e.kind === 'delegation';
    case 'call':
      return e.kind === 'agent-action' || e.kind === 'flow';
    case 'system':
      return e.kind === 'system';
    case 'uncommitted':
      return e.result === 'denied' || e.result === 'unsupported';
  }
}

function ChevronRight({ className }: { className?: string }) {
  return (
    <svg className={className} width="9" height="14" viewBox="0 0 9 14" fill="none" aria-hidden="true">
      <path d="M1.5 1.5 7 7l-5.5 5.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function KindGlyph({ kind }: { kind: PresentationLedgerKind }) {
  if (kind === 'delegation') {
    return (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M4 8v4M8 5v10M12 7v6M16 9v2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === 'system') {
    return (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M2 10.5h3.6l1.9-4.8 3.1 9 1.9-4.2H18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M8.6 5.6H17M8.6 10.4H17M8.6 15.2H17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M3 5.1 4.2 6.3 6.4 3.9M3 14.1l1.2 1.2 2.2-2.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StatusIcon({ result }: { result: PresentationLedgerResult }) {
  if (result === 'committed') {
    return (
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <circle cx="6" cy="6" r="5.1" stroke="currentColor" strokeWidth="1.2" />
        <path d="M3.8 6.2 5.4 7.7 8.4 4.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (result === 'pending') {
    return (
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <circle cx="6" cy="6" r="5.1" stroke="currentColor" strokeWidth="1.2" />
        <path d="M6 3.4V6l1.8 1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return null;
}

function LedgerEntryCard({ entry }: { entry: PresentationLedgerEntry }) {
  const chips = entry.tags ?? entry.actors;
  return (
    <article className="ledger-entry">
      <div className="ledger-entry-top">
        <span className="ledger-time t-mono">{entry.at}</span>
        <span className="chip" data-tone={KIND_TONE[entry.kind]}>
          {KIND_LABEL[entry.kind]}
        </span>
        {entry.actors.length === 2 ? (
          <span className="ledger-flow">
            {entry.actors[0]} <i aria-hidden="true">→</i> {entry.actors[1]}
          </span>
        ) : null}
        <span className="chip ledger-status" data-tone={RESULT_TONE[entry.result]}>
          <StatusIcon result={entry.result} />
          {RESULT_LABEL[entry.result]}
          <ChevronRight />
        </span>
      </div>
      <div className="ledger-entry-main">
        <span className="ledger-glyph" data-tone={KIND_TONE[entry.kind] || 'system'}>
          <KindGlyph kind={entry.kind} />
        </span>
        <div className="ledger-entry-body">
          <b className="ledger-entry-title">{entry.title}</b>
          <p>{entry.detail}</p>
          <div className="ledger-tags">
            {chips.map((c) => (
              <span key={c} className="chip">
                {c}
              </span>
            ))}
          </div>
        </div>
        <ChevronRight className="ledger-entry-chevron" />
      </div>
    </article>
  );
}

/** The interaction ledger — who did what, on whose behalf, with what result.
 * Every entry is a simulated projection, never product truth. */
export function LedgerDrawer() {
  const { ledger, ledgerOpen, ledgerFilter, setLedgerFilter, toggleLedger } = useProductPresentation();

  if (!ledgerOpen) return null;

  const visible = [...ledger].reverse().filter((e) => matchesFilter(e, ledgerFilter));
  const today = visible.filter((e) => !e.history);
  const yesterday = visible.filter((e) => e.history);
  const groups = [
    { label: '今天', entries: today },
    { label: '昨天', entries: yesterday },
  ].filter((g) => g.entries.length > 0);

  return (
    <aside
      id="interaction-ledger-drawer"
      className="ledger-drawer"
      data-nimi-material="glass-thick"
      data-nimi-tone="overlay"
      aria-label="交互账本"
    >
      <div className="ledger-head">
        <h2 className="ledger-title">交互账本</h2>
        <button type="button" className="sys-btn small ledger-collapse" onClick={toggleLedger}>
          收起
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
            <path d="M1.5 6.5 5 3l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      <div className="ledger-tabs" role="tablist" aria-label="账本筛选">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={ledgerFilter === f.id}
            className="ledger-tab"
            onClick={() => setLedgerFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="ledger-list">
        {groups.length === 0 ? (
          <p className="ledger-empty t-caption">该筛选下暂无条目</p>
        ) : (
          groups.map((g) => (
            <section key={g.label} className="ledger-day">
              <h3 className="ledger-day-label">{g.label}</h3>
              <div className="ledger-track">
                {g.entries.map((e) => (
                  <LedgerEntryCard key={e.id} entry={e} />
                ))}
              </div>
            </section>
          ))
        )}
      </div>

      <div className="ledger-foot t-caption">模拟演示 · 条目为演示投影，时间线为演示逻辑时间（T+mm:ss）</div>
    </aside>
  );
}
