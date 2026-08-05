import type { OfflineTier } from '@nimiplatform/kit/core/offline-coordinator';
import { Button, InlineAlert, StatusBadge, Surface } from '@nimiplatform/kit/ui';
import { appTitle, type RuntimePlatformUnavailableProjection } from './runtime-platform';

type RuntimeUnavailablePageProps = {
  readonly projection?: RuntimePlatformUnavailableProjection;
  readonly message?: string;
  readonly offlineTier?: OfflineTier;
  readonly onRetry: () => void;
};

export function RuntimeUnavailablePage({
  projection,
  message,
  offlineTier,
  onRetry,
}: RuntimeUnavailablePageProps) {
  const diagnosticMessage = message || projection?.message || 'Runtime session projection is not ready.';
  const reasonCode = projection?.reasonCode ?? 'runtime-unavailable';
  const actionHint = projection?.actionHint ?? 'start_external_runtime_daemon';
  return (
    <main
      className="runtime-unavailable-screen"
      data-zhiyu-runtime-unavailable-reason={reasonCode}
      data-zhiyu-runtime-unavailable-action={actionHint}
    >
      <Surface className="runtime-unavailable-panel" material="glass-thick" tone="panel" elevation="floating">
        <div className="runtime-unavailable-heading">
          <StatusBadge tone="warning" shape="dot">需要本地服务</StatusBadge>
          <h1>{appTitle}</h1>
          <p>{runtimeUnavailablePrimaryCopy(reasonCode)}</p>
        </div>
        <InlineAlert tone="warning">
          <div className="runtime-alert-copy">
            <strong>本地运行服务暂未连接</strong>
            <span>请先启动 Nimi 本地运行服务，然后重新检查连接状态。</span>
          </div>
        </InlineAlert>
        <div className="runtime-unavailable-actions">
          <Button type="button" tone="primary" onClick={onRetry}>重新检查本地服务</Button>
          {offlineTier ? (
            <span data-zhiyu-runtime-offline-tier={offlineTier}>连接可恢复</span>
          ) : null}
        </div>
        <details className="runtime-unavailable-diagnostic-detail">
          <summary>查看技术诊断</summary>
          <dl>
            <div>
              <dt>reason</dt>
              <dd>{reasonCode}</dd>
            </div>
            <div>
              <dt>action</dt>
              <dd>{actionHint}</dd>
            </div>
            <div>
              <dt>detail</dt>
              <dd>{diagnosticMessage}</dd>
            </div>
          </dl>
        </details>
      </Surface>
    </main>
  );
}

function runtimeUnavailablePrimaryCopy(reasonCode: string): string {
  if (/permission|forbidden|scope/i.test(reasonCode)) {
    return '当前应用还没有获得本地会话权限，请在诊断中确认授权状态。';
  }
  return '织羽需要本地运行服务提供账户和伙伴投影；连接恢复后会自动回到工作区。';
}
