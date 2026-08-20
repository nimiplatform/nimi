import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@nimiplatform/kit/ui';
import { useSim } from '../engine/SimContext';

/** Grant party icon accents, keyed by the scenario's from/to display names. */
export const GRANT_PARTY_TONES: Record<string, string> = {
  Desktop: 'desktop',
  Zhiyu: 'zhiyu',
  Lab: 'lab',
};

interface GrantReceiptProps {
  grantId: string;
  onClose: () => void;
}

/** 授权回单 — receipt dialog for one grant, opened from the 授权 pane.
 * Same solid authority material as the consent card: it speaks for the OS. */
export function GrantReceiptDialog({ grantId, onClose }: GrantReceiptProps) {
  const { state, toggleGrant } = useSim();
  const grant = state.grants.find((g) => g.id === grantId);
  if (!grant) return null;
  const active = grant.status === 'active';
  const r = grant.receipt;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        onClose={onClose}
        overlayClassName="receipt-backdrop"
        className="receipt-card nimi-material-solid border-[var(--nimi-border-strong)]"
      >
        <div className="receipt-head">
          <DialogTitle asChild>
            <h2>授权回单</h2>
          </DialogTitle>
          <button type="button" className="receipt-close" aria-label="关闭授权回单" onClick={onClose} autoFocus>
            ×
          </button>
        </div>
        <DialogDescription className="sr-only">
          查看并调整“{grant.title}”的模拟授权状态。
        </DialogDescription>

        <div className="receipt-parties">
          <span className="grant-party" data-tone={GRANT_PARTY_TONES[grant.from] ?? 'eco'}>
            <span className="grant-party-icon" aria-hidden />
            <span className="grant-party-main">
              <b>{grant.from}</b>
              <em>发起方</em>
            </span>
          </span>
          <span className="grant-arrow" aria-hidden>
            →
          </span>
          <span className="grant-party" data-tone={GRANT_PARTY_TONES[grant.to] ?? 'eco'}>
            <span className="grant-party-icon" aria-hidden />
            <span className="grant-party-main">
              <b>{grant.to}</b>
              <em>接收方</em>
            </span>
          </span>
        </div>

        <dl className="receipt-rows">
          <div className="receipt-row">
            <dt>授权内容</dt>
            <dd>{grant.title}</dd>
          </div>
          <div className="receipt-row">
            <dt>权限类型</dt>
            <dd>{r.access}</dd>
          </div>
          <div className="receipt-row">
            <dt>作用范围</dt>
            <dd>{r.range}</dd>
          </div>
          <div className="receipt-row">
            <dt>有效期</dt>
            <dd>
              {r.validity}
              {r.expiry ? <span className="receipt-sub">{r.expiry}</span> : null}
            </dd>
          </div>
          <div className="receipt-row">
            <dt>限制</dt>
            <dd>{r.restriction}</dd>
          </div>
          <div className="receipt-row">
            <dt>当前状态</dt>
            <dd>
              <span className="receipt-state" data-active={active}>
                <i aria-hidden />
                {active ? '生效中' : '已撤销'}
              </span>
            </dd>
          </div>
          <div className="receipt-row">
            <dt>最近使用</dt>
            <dd>{r.lastUsed}</dd>
          </div>
        </dl>

        <div className="receipt-actions">
          <button type="button" className="sys-btn" disabled title="演示版暂未开放范围调整">
            调整范围
          </button>
          <button
            type="button"
            className={active ? 'sys-btn danger' : 'sys-btn primary'}
            onClick={() => toggleGrant(grant.id)}
          >
            {active ? '撤销授权' : '重新授权'}
          </button>
        </div>

        <p className="consent-note t-caption">模拟环境 · 授权仅为演示，不产生任何真实效果。</p>
      </DialogContent>
    </Dialog>
  );
}
