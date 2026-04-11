import { describeError, logRendererEvent, type ParentosRendererLogLevel } from './renderer-log.js';

/**
 * Returns a catch handler that logs the error via logRendererEvent.
 * Usage: `.catch(catchLog('profile', 'action:load-measurements-failed'))`
 */
export function catchLog(area: string, message: string, level: ParentosRendererLogLevel = 'error') {
  return (error: unknown): void => {
    logRendererEvent({ level, area, message, details: describeError(error) });
  };
}

/**
 * Returns a catch handler that logs the error AND runs a fallback.
 * Usage: `.catch(catchLogThen('timeline', 'action:load-overrides-failed', () => setX(new Map())))`
 */
export function catchLogThen(
  area: string,
  message: string,
  fallback: () => void,
  level: ParentosRendererLogLevel = 'warn',
) {
  return (error: unknown): void => {
    logRendererEvent({ level, area, message, details: describeError(error) });
    fallback();
  };
}
