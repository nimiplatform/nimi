import { completeRuntimeClientLogin, prepareRuntimeClientLogin } from '@nimiplatform/sdk/realm/runtime-client';
import { connectRemoteRuntime } from '@nimiplatform/sdk/runtime/remote';
import { createNimiRemoteAppSession, type NimiRemoteAppSessionSnapshot } from '@nimiplatform/kit/core/remote-app-session';
import { appId } from '../shell/auth/app-identity.js';
import { t } from '../shell/i18n/index.js';

export type LabWebConfig = Readonly<{ clientId: string; realmEnvironmentId: string; officialWebBaseUrl: string; realmBaseUrl: string; redirectUri: string }>;
export type LabWebSnapshot = NimiRemoteAppSessionSnapshot;

// @nimi-authority: rule.nimi.platform.app-ecosystem.lab-web-carrier
export function createLabWebConnection(config: LabWebConfig, platform: Omit<Parameters<typeof createNimiRemoteAppSession>[1], 'prepare' | 'complete' | 'connect'> & {
  prepare?: typeof prepareRuntimeClientLogin; complete?: typeof completeRuntimeClientLogin; connect?: typeof connectRemoteRuntime;
}) {
  return createNimiRemoteAppSession({ ...config, appId }, {
    ...platform, prepare: platform.prepare ?? prepareRuntimeClientLogin,
    complete: platform.complete ?? completeRuntimeClientLogin, connect: platform.connect ?? connectRemoteRuntime,
    messages: { loginExpired: t('Auth.web.errors.loginExpired'), appSourceRequired: t('Auth.web.errors.appSource') },
  });
}
export type LabWebConnection = ReturnType<typeof createLabWebConnection>;
