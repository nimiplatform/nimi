import { Button, InlineAlert, StatusBadge, Surface } from '@nimiplatform/kit/ui';
import { appTitle } from './runtime-platform.js';

type RuntimeLoginPageProps = {
  errorMessage?: string;
  layout?: 'screen' | 'panel';
  onRetry: () => void;
};

export function RuntimeLoginPage({ errorMessage, layout = 'screen', onRetry }: RuntimeLoginPageProps) {
  return (
    <main
      className={`runtime-login-screen runtime-login-screen--${layout}`}
      data-testid="nimi-app-runtime-login-required"
    >
      <Surface className="runtime-account-required-panel" material="glass-thick" tone="panel" elevation="floating">
        <div className="runtime-unavailable-heading">
          <StatusBadge tone="warning" shape="dot">account action required</StatusBadge>
          <h1>{appTitle}</h1>
        </div>
        <InlineAlert tone="warning">
          <div className="runtime-alert-copy">
            <strong>Runtime account required</strong>
            <span>{errorMessage || 'This app has no active shared Runtime account projection.'}</span>
          </div>
        </InlineAlert>
        <p className="runtime-account-owner-copy">
          Open Nimi Desktop to sign in, sign out, or switch accounts. Nimi Lab never receives or stores account tokens.
        </p>
        <p className="runtime-account-owner-copy" lang="zh-CN">
          请在 Nimi Desktop 中登录、退出或切换账户；Nimi Lab 不接收也不保存账户令牌。
        </p>
        <Button type="button" tone="primary" onClick={onRetry}>Retry account status</Button>
      </Surface>
    </main>
  );
}
