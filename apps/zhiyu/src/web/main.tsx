import { createWebNimiAppSession, type NimiRemoteAppConfig } from '@nimiplatform/kit/auth/app/web';
import { mountZhiyuRemote } from '../production/remote-entry.js';

declare const __NIMI_APP_WEB_CONFIG__: NimiRemoteAppConfig;
const dispose = mountZhiyuRemote(createWebNimiAppSession(__NIMI_APP_WEB_CONFIG__), '织羽网页版');
if (import.meta.hot) import.meta.hot.dispose(dispose);
