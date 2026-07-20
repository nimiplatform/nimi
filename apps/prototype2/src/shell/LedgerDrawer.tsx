import { useSim } from '../engine/SimContext';
import type { LedgerKind, LedgerResult } from '../scenario/types';

const KIND_LABEL: Record<LedgerKind, string> = {
  delegation: '委托',
  'agent-action': 'agent 行动',
  flow: '跨应用流',
  system: '系统',
};

const KIND_TONE: Record<LedgerKind, string> = {
  delegation: 'agent',
  'agent-action': 'agent',
  flow: 'primary',
  system: '',
};

const RESULT_LABEL: Record<LedgerResult, string> = {
  committed: '已提交',
  unsupported: '不支持',
  denied: '已拒绝',
  info: '信息',
};

const RESULT_TONE: Record<LedgerResult, string> = {
  committed: 'success',
  unsupported: 'warning',
  denied: 'danger',
  info: '',
};

/** The interaction ledger — who did what, on whose behalf, with what result.
 * Every entry is a simulated projection, never product truth. */
export function LedgerDrawer() {
  const { state, toggleLedger } = useSim();
  if (!state.ledgerOpen) return null;
  const entries = [...state.ledger].reverse();
  return (
    <aside
      id="interaction-ledger-drawer"
      className="ledger-drawer nimi-material-glass-thick bg-[var(--nimi-material-glass-thick-bg)] border border-[var(--nimi-material-glass-thick-border)] backdrop-blur-[var(--nimi-backdrop-blur-strong)] backdrop-saturate-[var(--nimi-backdrop-saturate)]"
      data-nimi-material="glass-thick"
      data-nimi-tone="overlay"
      aria-label="交互账本"
    >
      <div className="ledger-head">
        <div>
          <span className="t-overline">交互账本 · ledger</span>
          <p className="t-caption">委托与流的可审计记录（模拟投影）</p>
        </div>
        <button type="button" className="sys-btn small" onClick={toggleLedger}>
          收起
        </button>
      </div>
      <div className="ledger-list">
        {entries.map((e) => (
          <article key={e.id} className="ledger-entry" data-history={e.history}>
            <div className="ledger-meta">
              <span className="t-mono">{e.id}</span>
              <span className="t-mono">{e.at}</span>
              {e.history ? <span className="chip">历史</span> : null}
            </div>
            <div className="ledger-title-row">
              <span className="chip" data-tone={KIND_TONE[e.kind]}>
                {KIND_LABEL[e.kind]}
              </span>
              <b>{e.title}</b>
            </div>
            <p>{e.detail}</p>
            <div className="ledger-foot">
              <span className="ledger-actors">
                {e.actors.map((a) => (
                  <span key={a} className="chip">
                    {a}
                  </span>
                ))}
              </span>
              <span className="chip" data-tone={RESULT_TONE[e.result]}>
                {RESULT_LABEL[e.result]}
              </span>
            </div>
          </article>
        ))}
      </div>
      <footer className="ledger-foot-note t-caption">
        epoch {state.epoch} · 条目均为模拟证据，不构成产品事实
      </footer>
    </aside>
  );
}
