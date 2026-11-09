import { createMobileNimiAppSession } from '@nimiplatform/kit/auth/app/mobile';
import { mountZhiyuRemote } from '../production/remote-entry.js';
import { mobileAccess } from '../../capacitor.config.js';

const dispose = mountZhiyuRemote(createMobileNimiAppSession(mobileAccess), '织羽');
if (import.meta.hot) import.meta.hot.dispose(dispose);
