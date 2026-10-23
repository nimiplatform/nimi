import type {
  DesktopBrowserAuthRuntimeBroker,
} from '@nimiplatform/kit/auth/shell';
import type { ShellOAuthCodeBridge } from '@nimiplatform/kit/core/oauth';

export interface DesktopRendererAuthPort {
  readonly oauthBridge: ShellOAuthCodeBridge;
  readonly runtimeAccountBroker: DesktopBrowserAuthRuntimeBroker;
}
