import { readMobileConfiguration } from './mobile-config.js';

// @nimi-authority: rule.nimi.zhiyu.local-partner-surface.android-entry
const { config, mobileAccess, mobileRelease } = readMobileConfiguration();
export { mobileAccess, mobileRelease };
export default config;
