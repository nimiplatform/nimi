import { useProductPresentation } from './product-presentation.tsx';

/** System-level consent card. Solid authority material — the only layer
 * allowed to be fully opaque, because it speaks for the OS, not for an app.
 * Presentation-only: every action resolves against the simulated store. */
export function ConsentOverlay() {
  const { consent, grants, flowTitle, resolveConsent, persona, localAgentPresentation } = useProductPresentation();
  if (!consent) return null;
  const title = flowTitle(consent.flowId);
  const grant = grants.find((g) => g.id === consent.grantId);
  if (!title || !grant) return null;

  return (
    <div
      className="consent-backdrop"
      data-nimi-material="glass-thin"
      data-nimi-tone="overlay"
      role="presentation"
    >
      <div
        className="consent-card"
        data-nimi-material="solid"
        data-nimi-tone="overlay"
        role="dialog"
        aria-modal="true"
        aria-label="系统级授权请求"
      >
        <span className="t-overline">系统级授权请求 · consent</span>
        <h2>{title}</h2>

        <div className="consent-parties">
          <div className="consent-party">
            <span className="t-caption">委托方</span>
            <b>{persona?.name ?? '模拟居民'}</b>
            <span className="t-mono">{persona?.id ?? 'sim-persona'} · 用户</span>
          </div>
          <span className="consent-arrow">→</span>
          <div className="consent-party">
            <span className="t-caption">执行方</span>
            <b>{localAgentPresentation.name}</b>
            <span className="t-mono">Runtime LocalAgent</span>
          </div>
          <span className="consent-arrow">→</span>
          <div className="consent-party">
            <span className="t-caption">目标</span>
            <b>织羽 Zhiyu</b>
            <span className="t-mono">应用实例</span>
          </div>
        </div>

        <div className="consent-scope">
          <span className="t-overline">授权范围 · scope</span>
          <p>{grant.scope}</p>
          <ul>
            <li>仅本次会话摘要的只读投影</li>
            <li>不包含任何写权限、账户或凭据</li>
            <li>可随时在基座「授权」面板撤销</li>
          </ul>
        </div>

        <div className="consent-actions">
          <button type="button" className="sys-btn" onClick={() => resolveConsent(false)}>
            拒绝
          </button>
          <button type="button" className="sys-btn primary" onClick={() => resolveConsent(true)} autoFocus>
            授权并继续
          </button>
        </div>

        <p className="consent-note t-caption">模拟环境 · 授权仅为演示，不产生任何真实效果。</p>
      </div>
    </div>
  );
}
