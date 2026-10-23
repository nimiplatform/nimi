import { RuntimeGate } from './runtime-gate.js';
import { useEffect } from 'react';
import { copyFor } from '../nimiday/i18n/index.js';
import { useAppLanguage } from '../nimiday/i18n/language-preference.js';
import { AmbientBackground, NimiToaster } from '@nimiplatform/kit/ui';
import { NimiDayApp } from '../nimiday/app/nimiday-app.js';
import {
  appTitle,
  clearTargetRuntimeGate,
  resolveTargetRuntimeGate,
  targetRuntimeGateError,
} from './workbench-target-adapter.js';

export function App() {
  const language = useAppLanguage();
  useEffect(() => {
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  }, [language]);
  return (
    <>
      <RuntimeGate
        appTitle={appTitle}
        copy={copyFor(language).runtimeGate}
        resolve={resolveTargetRuntimeGate}
        clear={clearTargetRuntimeGate}
        toError={targetRuntimeGateError}
      >
        <AmbientBackground variant="mesh" className="app-shell" data-testid="nimi-app-shell">
          <NimiDayApp />
        </AmbientBackground>
      </RuntimeGate>
      <NimiToaster />
    </>
  );
}
