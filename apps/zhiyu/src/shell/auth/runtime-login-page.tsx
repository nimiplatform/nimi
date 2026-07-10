import { Button, InlineAlert, StatusBadge, Surface } from '@nimiplatform/kit/ui';
import { appTitle } from './runtime-platform';

type RuntimeLoginPageProps = {
  readonly errorMessage?: string;
  readonly onRetry: () => void;
};

export function RuntimeLoginPage({ errorMessage, onRetry }: RuntimeLoginPageProps) {
  return (
    <main className="runtime-login-screen" data-testid="zhiyu-runtime-login-required">
      <Surface className="runtime-account-required-panel" material="glass-thick" tone="panel" elevation="floating">
        <div className="runtime-unavailable-heading">
          <StatusBadge tone="warning" shape="dot">需要账户操作</StatusBadge>
          <h1>{appTitle}</h1>
        </div>
        <InlineAlert tone="warning">
          <div className="runtime-alert-copy">
            <strong>需要 Runtime 账户</strong>
            <span>{errorMessage || '当前没有可用的 Runtime 共享账户投影。'}</span>
          </div>
        </InlineAlert>
        <p className="runtime-account-owner-copy">
          账户操作仅由 Nimi Desktop 提供。请在 Desktop 中登录、退出或切换账户，然后返回织羽重试。
        </p>
        <p className="runtime-account-owner-copy">
          织羽只消费 Runtime 授权结果，不接收、不刷新、也不保存账户令牌。
        </p>
        <Button type="button" tone="primary" onClick={onRetry}>重新检查账户状态</Button>
      </Surface>
    </main>
  );
}
