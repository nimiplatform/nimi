import { createMobileNimiAppSession } from '@nimiplatform/kit/auth/app/mobile';
import { mountZhiyuRemote } from '../production/remote-entry.js';
import type { NimiRemoteAppConfig } from '@nimiplatform/kit/core/app-session';

declare const __NIMI_APP_MOBILE_CONFIG__: Omit<NimiRemoteAppConfig, 'fetch'>;

// @nimi-authority: rule.nimi.zhiyu.local-partner-surface.android-entry
const dispose = mountZhiyuRemote(createMobileNimiAppSession(__NIMI_APP_MOBILE_CONFIG__), '织羽');
if (import.meta.hot) import.meta.hot.dispose(dispose);
