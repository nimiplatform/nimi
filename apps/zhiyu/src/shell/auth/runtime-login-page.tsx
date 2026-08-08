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
            <strong>需要登录 Nimi 账户</strong>
            <span>{errorMessage || '当前没有可用的账户会话。'}</span>
          </div>
        </InlineAlert>
        <p className="runtime-account-owner-copy">
          请在 Nimi Desktop 中登录、退出或切换账户，然后返回织羽重试。
        </p>
        <p className="runtime-account-owner-copy">
          织羽只读取登录结果，不会接收、刷新或保存账户令牌。
        </p>
        <Button type="button" tone="primary" onClick={onRetry}>重新检查账户状态</Button>
      </Surface>
    </main>
  );
}
