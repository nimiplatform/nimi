import {
  Suspense,
  lazy,
  useRef,
  useState,
  type MouseEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { dataSync } from '@runtime/data-sync';
import { desktopBridge } from '@renderer/bridge';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { queryClient } from '@renderer/infra/query-client/query-client';
import type { WebAuthMenuMode } from './auth-helpers.js';
import {
  DESKTOP_CALLBACK_TIMEOUT_MS,
  buildDesktopWebAuthLaunchUrl,
  createDesktopCallbackRedirectUri,
  createDesktopCallbackState,
  toDesktopBrowserAuthErrorMessage,
} from './auth-helpers.js';
import { AuthMenu } from './auth-menu.js';

export type { WebAuthMenuMode } from './auth-helpers.js';

const ParticleBackgroundLight = lazy(async () => {
  const mod = await import('./particle-background-light');
  return { default: mod.ParticleBackgroundLight };
});

export function WebAuthMenu(props: { mode?: WebAuthMenuMode }) {
  const { t } = useTranslation();
  const mode = props.mode || 'embedded';
  const [isLogoHovered, setIsLogoHovered] = useState(false);
  const [desktopAuthPending, setDesktopAuthPending] = useState(false);
  const [desktopAuthError, setDesktopAuthError] = useState<string | null>(null);
  const desktopAttemptRef = useRef(0);
  const setAuthSession = useAppStore((state) => state.setAuthSession);
  const setStatusBanner = useAppStore((state) => state.setStatusBanner);

  const desktopLogoHintText = desktopAuthError
    ? t('Auth.desktopAuthFailed')
    : undefined;

  const handleDesktopLogoClick = () => {
    const myAttempt = ++desktopAttemptRef.current;

    void (async () => {
      setDesktopAuthPending(true);
      setDesktopAuthError(null);
      let listenTask: ReturnType<typeof desktopBridge.oauthListenForCode> | null = null;

      try {
        if (!desktopBridge.hasTauriInvoke()) {
          throw new Error('当前环境不支持浏览器授权回调，请在桌面客户端中运行。');
        }

        const callbackUrl = createDesktopCallbackRedirectUri();
        const callbackState = createDesktopCallbackState();
        const launchUrl = buildDesktopWebAuthLaunchUrl({
          callbackUrl,
          state: callbackState,
        });

        listenTask = desktopBridge.oauthListenForCode({
          redirectUri: callbackUrl,
          timeoutMs: DESKTOP_CALLBACK_TIMEOUT_MS,
        });

        const launchResult = await desktopBridge.openExternalUrl(launchUrl);
        if (!launchResult.opened) {
          throw new Error('无法打开系统浏览器，请检查系统默认浏览器设置。');
        }

        setStatusBanner({
          kind: 'info',
          message: '已打开浏览器，请在网页完成授权登录。',
        });

        if (!listenTask) {
          throw new Error('网页登录回调监听初始化失败。');
        }

        const callback = await listenTask;
        void desktopBridge.focusMainWindow().catch(() => undefined);
        if (callback.error) {
          throw new Error(`网页授权失败：${callback.error}`);
        }

        const callbackStateFromWeb = String(callback.state || '').trim();
        if (!callbackStateFromWeb || callbackStateFromWeb !== callbackState) {
          throw new Error('网页登录回调 state 校验失败，请重试。');
        }

        const accessToken = String(callback.code || '').trim();
        if (!accessToken) {
          throw new Error('网页登录回调缺少 access token。');
        }

        dataSync.setToken(accessToken);
        const user = await dataSync.loadCurrentUser();
        setAuthSession(
          (user && typeof user === 'object' ? (user as Record<string, unknown>) : null),
          accessToken,
        );

        await Promise.allSettled([
          dataSync.loadChats(),
          dataSync.loadContacts(),
          queryClient.invalidateQueries({ queryKey: ['chats'] }),
          queryClient.invalidateQueries({ queryKey: ['contacts'] }),
        ]);

        setStatusBanner({
          kind: 'success',
          message: '网页登录授权成功，已登录。',
        });
      } catch (error) {
        if (myAttempt !== desktopAttemptRef.current) return;
        const message = toDesktopBrowserAuthErrorMessage(error);
        setDesktopAuthError(message);
        setStatusBanner({
          kind: 'error',
          message,
        });
      } finally {
        if (listenTask) {
          void listenTask.catch(() => undefined);
        }
        if (myAttempt === desktopAttemptRef.current) {
          setDesktopAuthPending(false);
        }
      }
    })();
  };

  const handleRootMouseDown = (event: MouseEvent<HTMLElement>) => {
    if (mode !== 'desktop-browser') {
      return;
    }
    if (event.button !== 0) {
      return;
    }

    const target = event.target as HTMLElement | null;
    if (!target) {
      return;
    }
    if (
      target.closest(
        'button, input, textarea, select, option, a, label, summary, [role="button"], [role="link"], [contenteditable="true"], [data-no-drag]',
      )
    ) {
      return;
    }

    void desktopBridge.startWindowDrag().catch(() => {
      // no-op
    });
  };

  return (
    <main
      className="relative min-h-screen overflow-hidden bg-[#f3f1ee] text-[#3b352c]"
      onMouseDown={handleRootMouseDown}
    >
      <Suspense fallback={null}>
        <ParticleBackgroundLight
          isLogoHovered={isLogoHovered}
          profile={mode === 'embedded' ? 'web' : 'desktop'}
        />
      </Suspense>
      <AuthMenu
        onLogoHoverChange={setIsLogoHovered}
        onLogoClick={mode === 'desktop-browser' ? handleDesktopLogoClick : undefined}
        logoHintText={mode === 'desktop-browser' ? desktopLogoHintText : undefined}
        logoErrorText={mode === 'desktop-browser' ? desktopAuthError : null}
        logoDisabled={false}
        enableAuthModal={mode !== 'desktop-browser'}
        logoLoading={mode === 'desktop-browser' ? desktopAuthPending : false}
      />
    </main>
  );
}
