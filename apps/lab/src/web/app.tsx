import { lazy, Suspense } from 'react';
import { LoadingSkeleton, InlineAlert } from '@nimiplatform/kit/ui';
import { NimiAppSessionProvider, NimiAccountControl, NimiAppAccessGate, type NimiAppSession } from '@nimiplatform/kit/auth/app';
import type { NimiRendererHostBindingV1, NimiRendererHostMethodMap } from '@nimiplatform/kit/shell/renderer/host';
import { useTranslation } from '../shell/i18n/index.js';
const Lab = lazy(async () => ({ default: (await import('../shell/App.js')).App }));
export function LabWebApp({ connection, rendererHost, configurationErrors }: {
  connection: NimiAppSession; rendererHost: NimiRendererHostBindingV1<NimiRendererHostMethodMap>; configurationErrors: readonly string[];
}) {
  const { t, i18n } = useTranslation(); const language = i18n.language.startsWith('zh') ? 'zh' : 'en';
  if (configurationErrors.length) return <InlineAlert tone="warning">{t('Auth.web.configure')} {configurationErrors.join(', ')}</InlineAlert>;
  return <NimiAppSessionProvider session={connection}><div className="lab-web-shell">
    <header className="lab-web-connection-bar"><strong>{t('Auth.web.title')}</strong><NimiAccountControl hideSignedOut language={language} /></header>
    <NimiAppAccessGate title={t('Auth.web.title')} language={language} externalAccountControl>{() => <div className="lab-web-workbench"><Suspense fallback={<LoadingSkeleton lines={4} />}><Lab rendererHost={rendererHost} webCarrier /></Suspense></div>}</NimiAppAccessGate>
  </div></NimiAppSessionProvider>;
}
