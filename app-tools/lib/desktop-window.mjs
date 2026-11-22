import { parseDocument as parseYamlDocument, isMap, isScalar } from 'yaml';

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-014a

export const DESKTOP_WINDOW_DEFAULTS = Object.freeze({
  width: 1280,
  height: 840,
  min_width: 480,
  min_height: 420,
  title_bar_style: 'native',
});

const DESKTOP_WINDOW_BOUNDS = Object.freeze({
  width: Object.freeze([400, 2560]),
  height: Object.freeze([360, 1600]),
  min_width: Object.freeze([320, 1280]),
  min_height: Object.freeze([320, 960]),
});

const ALLOWED_DESKTOP_KEYS = new Set(['window']);
const ALLOWED_WINDOW_KEYS = new Set(['width', 'height', 'min_width', 'min_height', 'title_bar_style']);
const ALLOWED_TITLE_BAR_STYLES = new Set(['native', 'hidden']);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertDesktopWindowYamlIntegerNodes(yamlText, label) {
  const doc = parseYamlDocument(yamlText, { keepSourceTokens: true });
  if (!isMap(doc.contents)) return;
  const desktopNode = doc.contents.get('desktop', true);
  if (!isMap(desktopNode)) return;
  const windowNode = desktopNode.get('window', true);
  if (!isMap(windowNode)) return;
  for (const pair of windowNode.items) {
    const key = isScalar(pair.key) ? String(pair.key.value) : '';
    if (!['width', 'height', 'min_width', 'min_height'].includes(key)) continue;
    if (!isScalar(pair.value) || typeof pair.value.value !== 'number') {
      throw new Error(`${label}.window.${key} must be a base-10 YAML integer`);
    }
    const rawSource = typeof pair.value.srcToken?.source === 'string'
      ? pair.value.srcToken.source.trim()
      : String(pair.value.value);
    if (!/^[0-9]+$/u.test(rawSource)) {
      throw new Error(`${label}.window.${key} must be a base-10 YAML integer`);
    }
  }
}

/**
 * Validates optional `desktop` declaration (`desktop.window`) with closed keys
 * and exact geometry bounds matching Runtime (`managed_web.go`) and Desktop
 * (`managed-web-snapshot.ts`). Returns `undefined` when omitted, or a clean
 * normalized object preserving only declared keys.
 */
export function validateManifestDesktop(desktop, label = 'nimi.app.yaml desktop', yamlText = null) {
  if (desktop === undefined) return undefined;
  if (typeof yamlText === 'string') {
    assertDesktopWindowYamlIntegerNodes(yamlText, label);
  }
  if (!isPlainObject(desktop)) {
    throw new Error(`${label} must be a mapping`);
  }
  for (const key of Object.keys(desktop)) {
    if (!ALLOWED_DESKTOP_KEYS.has(key)) {
      throw new Error(`${label} contains unsupported field: ${key}`);
    }
  }
  if (desktop.window === undefined) {
    return {};
  }
  const rawWindow = desktop.window;
  if (!isPlainObject(rawWindow)) {
    throw new Error(`${label}.window must be a mapping`);
  }
  const normalizedWindow = {};
  for (const key of Object.keys(rawWindow)) {
    if (!ALLOWED_WINDOW_KEYS.has(key)) {
      throw new Error(`${label}.window contains unsupported field: ${key}`);
    }
    const value = rawWindow[key];
    if (key === 'title_bar_style') {
      if (typeof value !== 'string' || !ALLOWED_TITLE_BAR_STYLES.has(value)) {
        throw new Error(`${label}.window.title_bar_style must be "native" or "hidden"`);
      }
      normalizedWindow.title_bar_style = value;
      continue;
    }
    const [min, max] = DESKTOP_WINDOW_BOUNDS[key];
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
      throw new Error(`${label}.window.${key} must be an integer between ${min} and ${max}`);
    }
    normalizedWindow[key] = value;
  }
  const effectiveWidth = normalizedWindow.width ?? DESKTOP_WINDOW_DEFAULTS.width;
  const effectiveHeight = normalizedWindow.height ?? DESKTOP_WINDOW_DEFAULTS.height;
  const effectiveMinWidth = normalizedWindow.min_width ?? DESKTOP_WINDOW_DEFAULTS.min_width;
  const effectiveMinHeight = normalizedWindow.min_height ?? DESKTOP_WINDOW_DEFAULTS.min_height;
  if (effectiveMinWidth > effectiveWidth) {
    throw new Error(`${label}.window.min_width (${effectiveMinWidth}) must not exceed width (${effectiveWidth})`);
  }
  if (effectiveMinHeight > effectiveHeight) {
    throw new Error(`${label}.window.min_height (${effectiveMinHeight}) must not exceed height (${effectiveHeight})`);
  }
  return { window: normalizedWindow };
}
