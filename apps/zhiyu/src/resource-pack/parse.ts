import { unzip } from 'fflate';
import postcss, { type Declaration, type Root } from 'postcss';

import {
  type ParsedZhiyuResourcePack,
  type ZhiyuResourcePackFailureCategory,
  type ZhiyuResourcePackManifest,
  type ZhiyuResourcePackResource,
  type ZhiyuResourcePackZone,
  ZHIYU_RESOURCE_PACK_LIMITS,
  ZHIYU_RESOURCE_PACK_MANIFEST_PATH,
  ZHIYU_RESOURCE_PACK_SCHEMA_VERSION,
  ZHIYU_RESOURCE_PACK_TARGET_ID,
  ZHIYU_RESOURCE_PACK_TARGET_VERSION,
  ZHIYU_RESOURCE_PACK_ZONES,
  ZhiyuResourcePackError,
} from './contract.js';

const textDecoder = new TextDecoder('utf-8', { fatal: true });
const zoneSet = new Set<string>(ZHIYU_RESOURCE_PACK_ZONES);
const layoutProperties = new Set([
  'align-content',
  'align-items',
  'align-self',
  'column-gap',
  'display',
  'flex-direction',
  'flex-wrap',
  'gap',
  'grid-auto-flow',
  'grid-template-columns',
  'grid-template-rows',
  'justify-content',
  'justify-items',
  'justify-self',
  'max-width',
  'min-width',
  'padding',
  'padding-block',
  'padding-bottom',
  'padding-inline',
  'padding-left',
  'padding-right',
  'padding-top',
  'row-gap',
  'width',
]);
const visualProperties = new Set([
  'background-color',
  'background-image',
  'background-position',
  'background-repeat',
  'background-size',
  'border',
  'border-bottom',
  'border-color',
  'border-left',
  'border-radius',
  'border-right',
  'border-style',
  'border-top',
  'border-width',
  'box-shadow',
  'color',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'letter-spacing',
  'line-height',
  'text-align',
]);
const alignmentValues = new Set([
  'baseline',
  'center',
  'end',
  'flex-end',
  'flex-start',
  'space-around',
  'space-between',
  'space-evenly',
  'start',
  'stretch',
]);
const forbiddenValueFragments = [
  'attr(',
  'behavior:',
  'expression(',
  'javascript:',
  'var(',
  'vh',
  'vmax',
  'vmin',
  'vw',
];

// @nimi-authority: rule.nimi.zhiyu.local-partner-surface.r018
export async function parseZhiyuResourcePack(
  inputBytes: Uint8Array,
): Promise<ParsedZhiyuResourcePack> {
  if (!(inputBytes instanceof Uint8Array) || inputBytes.byteLength === 0) {
    fail('archive', 'resource-pack.nimipack', 'The selected file is empty.', 'Choose a non-empty .nimipack file.');
  }
  if (inputBytes.byteLength > ZHIYU_RESOURCE_PACK_LIMITS.archiveBytes) {
    fail('archive', 'resource-pack.nimipack', 'The archive exceeds the W1 compressed-size limit.', 'Reduce packaged image size and remove unused files.');
  }

  const archiveBytes = inputBytes.slice();
  const entries = await readBoundedArchive(archiveBytes);
  const manifestBytes = requiredEntry(entries, ZHIYU_RESOURCE_PACK_MANIFEST_PATH, 'manifest');
  if (manifestBytes.byteLength > ZHIYU_RESOURCE_PACK_LIMITS.manifestBytes) {
    fail('manifest', ZHIYU_RESOURCE_PACK_MANIFEST_PATH, 'The manifest is too large.', 'Keep only the required W1 manifest fields.');
  }
  const manifest = parseManifest(decodeText(manifestBytes, ZHIYU_RESOURCE_PACK_MANIFEST_PATH));
  const styleBytes = requiredEntry(entries, manifest.styleEntry, 'style');
  if (styleBytes.byteLength > ZHIYU_RESOURCE_PACK_LIMITS.styleBytes) {
    fail('style', manifest.styleEntry, 'The stylesheet is too large.', 'Remove unused declarations and repeated rules.');
  }

  const expectedFiles = new Set([
    ZHIYU_RESOURCE_PACK_MANIFEST_PATH,
    manifest.styleEntry,
    ...manifest.resources,
  ]);
  for (const path of entries.keys()) {
    if (!expectedFiles.has(path)) {
      fail('archive', path, 'The archive contains an undeclared entry.', 'Declare the packaged resource or remove the entry.');
    }
  }
  if (entries.size !== expectedFiles.size) {
    const missing = [...expectedFiles].find((path) => !entries.has(path)) ?? 'unknown';
    fail('archive', missing, 'A declared entry is missing from the archive.', 'Add the declared file or remove it from the manifest.');
  }

  const resources = new Map<string, ZhiyuResourcePackResource>();
  for (const path of manifest.resources) {
    const bytes = requiredEntry(entries, path, 'resource');
    if (bytes.byteLength > ZHIYU_RESOURCE_PACK_LIMITS.resourceBytes) {
      fail('resource', path, 'The resource exceeds the W1 per-file size limit.', 'Resize or recompress the image.');
    }
    resources.set(path, Object.freeze({
      path,
      mimeType: sniffImageMimeType(path, bytes),
      bytes: bytes.slice(),
    }));
  }

  const cssText = decodeText(styleBytes, manifest.styleEntry);
  const validated = validateAndScopeStyle(cssText, manifest.styleEntry, resources);
  const referencedResources = [...validated.referencedResources].sort();
  const unused = manifest.resources.find((path) => !validated.referencedResources.has(path));
  if (unused) {
    fail('manifest', unused, 'The declared resource is not referenced by style.css.', 'Remove the resource or reference it from an allowed background-image declaration.');
  }

  return Object.freeze({
    manifest,
    archiveBytes,
    cssText,
    scopedCssText: validated.root.toString(),
    resources,
    referencedResources,
  });
}

export function materializeZhiyuResourcePackStyle(
  pack: ParsedZhiyuResourcePack,
  resourceUrl: (resource: ZhiyuResourcePackResource) => string,
): string {
  const root = postcss.parse(pack.scopedCssText, { from: pack.manifest.styleEntry });
  root.walkDecls((declaration) => {
    declaration.value = replaceResourceUrls(declaration.value, (path) => {
      const resource = pack.resources.get(path);
      if (!resource) {
        fail('resource', path, 'The stylesheet references a resource that is not available.', 'Re-import a complete .nimipack file.');
      }
      return resourceUrl(resource);
    });
  });
  return root.toString();
}

async function readBoundedArchive(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const seen = new Set<string>();
  let entryCount = 0;
  let expandedBytes = 0;
  let filterFailure: unknown = null;

  return new Promise((resolve, reject) => {
    try {
      unzip(bytes, {
        filter(info) {
          try {
            entryCount += 1;
            if (entryCount > ZHIYU_RESOURCE_PACK_LIMITS.entryCount) {
              fail('archive', info.name, 'The archive contains too many entries.', 'Remove unused files.');
            }
            const path = normalizeEntryPath(info.name);
            if (seen.has(path)) {
              fail('archive', path, 'The archive contains a duplicate entry.', 'Keep exactly one file for each declared path.');
            }
            seen.add(path);
            if (info.compression !== 0 && info.compression !== 8) {
              fail('archive', path, 'The entry uses an unsupported ZIP compression method.', 'Use stored or deflate ZIP compression.');
            }
            expandedBytes += info.originalSize;
            if (expandedBytes > ZHIYU_RESOURCE_PACK_LIMITS.expandedBytes) {
              fail('archive', path, 'The expanded archive exceeds the W1 limit.', 'Reduce packaged resources and rebuild the Pack.');
            }
            return !path.endsWith('/');
          } catch (error) {
            filterFailure = error;
            return false;
          }
        },
      }, (error, result) => {
        if (filterFailure) {
          reject(filterFailure);
          return;
        }
        if (error) {
          reject(resourcePackError('archive', 'resource-pack.nimipack', 'The file is not a readable ZIP archive.', 'Rebuild the .nimipack as a standard ZIP archive.'));
          return;
        }
        const entries = new Map<string, Uint8Array>();
        for (const [rawPath, data] of Object.entries(result)) {
          const path = normalizeEntryPath(rawPath);
          if (!path.endsWith('/')) entries.set(path, data.slice());
        }
        resolve(entries);
      });
    } catch (error) {
      reject(error instanceof ZhiyuResourcePackError
        ? error
        : resourcePackError('archive', 'resource-pack.nimipack', 'The file is not a readable ZIP archive.', 'Rebuild the .nimipack as a standard ZIP archive.'));
    }
  });
}

function parseManifest(text: string): ZhiyuResourcePackManifest {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    fail('manifest', ZHIYU_RESOURCE_PACK_MANIFEST_PATH, 'The manifest is not valid JSON.', 'Fix the JSON syntax and rebuild the Pack.');
  }
  if (!isPlainRecord(value)) {
    fail('manifest', ZHIYU_RESOURCE_PACK_MANIFEST_PATH, 'The manifest root must be an object.', 'Use the W1 manifest object shape.');
  }
  assertExactKeys(value, ['resources', 'schemaVersion', 'styleEntry', 'target'], ZHIYU_RESOURCE_PACK_MANIFEST_PATH);
  if (value.schemaVersion !== ZHIYU_RESOURCE_PACK_SCHEMA_VERSION) {
    fail('manifest', 'schemaVersion', 'The Pack schema version is not supported.', `Set schemaVersion to ${ZHIYU_RESOURCE_PACK_SCHEMA_VERSION}.`);
  }
  if (!isPlainRecord(value.target)) {
    fail('manifest', 'target', 'The target must be an object.', 'Provide the exact Zhiyu Experience target id and version.');
  }
  assertExactKeys(value.target, ['id', 'version'], 'target');
  if (value.target.id !== ZHIYU_RESOURCE_PACK_TARGET_ID || value.target.version !== ZHIYU_RESOURCE_PACK_TARGET_VERSION) {
    fail('manifest', 'target', 'The Pack targets a different experience surface.', `Use ${ZHIYU_RESOURCE_PACK_TARGET_ID} version ${ZHIYU_RESOURCE_PACK_TARGET_VERSION}.`);
  }
  const styleEntry = requiredManifestPath(value.styleEntry, 'styleEntry');
  if (!styleEntry.toLowerCase().endsWith('.css')) {
    fail('manifest', 'styleEntry', 'The W1 style entry must be a CSS file.', 'Use a relative .css file as styleEntry.');
  }
  if (!Array.isArray(value.resources) || value.resources.length > ZHIYU_RESOURCE_PACK_LIMITS.resourceCount) {
    fail('manifest', 'resources', 'resources must be a bounded array of packaged paths.', `Declare at most ${ZHIYU_RESOURCE_PACK_LIMITS.resourceCount} resources.`);
  }
  const resources = value.resources.map((resource, index) => requiredManifestPath(resource, `resources[${index}]`));
  const uniqueResources = new Set(resources);
  if (uniqueResources.size !== resources.length) {
    fail('manifest', 'resources', 'The same resource path is declared more than once.', 'Keep one declaration per packaged resource.');
  }
  if (uniqueResources.has(styleEntry) || uniqueResources.has(ZHIYU_RESOURCE_PACK_MANIFEST_PATH)) {
    fail('manifest', 'resources', 'Manifest and stylesheet entries cannot also be resources.', 'Declare only packaged image paths in resources.');
  }
  return Object.freeze({
    schemaVersion: ZHIYU_RESOURCE_PACK_SCHEMA_VERSION,
    target: Object.freeze({
      id: ZHIYU_RESOURCE_PACK_TARGET_ID,
      version: ZHIYU_RESOURCE_PACK_TARGET_VERSION,
    }),
    styleEntry,
    resources: Object.freeze(resources),
  });
}

function validateAndScopeStyle(
  cssText: string,
  source: string,
  resources: ReadonlyMap<string, ZhiyuResourcePackResource>,
): { root: Root; referencedResources: Set<string> } {
  if (cssText.includes('\\')) {
    fail('style', source, 'CSS escapes are not supported in W1.', 'Use literal W1 property and function names.');
  }
  let root: Root;
  try {
    root = postcss.parse(cssText, { from: source });
  } catch {
    fail('style', source, 'The stylesheet is not valid CSS.', 'Fix the CSS syntax and rebuild the Pack.');
  }
  const referencedResources = new Set<string>();
  root.walkAtRules((atRule) => {
    if (atRule.name.toLowerCase() !== 'container' || !isAllowedContainerQuery(atRule.params)) {
      fail('style', source, `@${atRule.name} is not allowed in W1.`, 'Use only a bounded inline-size @container query.');
    }
  });
  root.walkRules((rule) => {
    const selectors = rule.selectors.map((selector) => selector.trim());
    if (selectors.length === 0) {
      fail('style', source, 'A style rule has no semantic selector.', 'Target one declared W1 semantic zone.');
    }
    rule.selectors = selectors.map((selector) => scopeSelector(selector, source));
  });
  root.walkDecls((declaration) => {
    validateDeclaration(declaration, source);
    replaceResourceUrls(declaration.value, (path) => {
      const normalizedPath = normalizeEntryPath(path);
      if (!resources.has(normalizedPath)) {
        fail('style', source, `The stylesheet references undeclared resource ${path}.`, 'Declare and package the image, or remove the URL.');
      }
      referencedResources.add(normalizedPath);
      return normalizedPath;
    });
  });
  return { root, referencedResources };
}

function scopeSelector(selector: string, source: string): string {
  const match = /^\[data-nimi-pack-zone=(?:"|')([a-z-]+)(?:"|')\]$/u.exec(selector);
  const zone = match?.[1];
  if (!zone || !zoneSet.has(zone)) {
    fail('style', source, `Selector ${selector} is outside the W1 semantic zones.`, `Use one exact [data-nimi-pack-zone="${ZHIYU_RESOURCE_PACK_ZONES.join('"] or [data-nimi-pack-zone="')}"] selector without descendants or pseudo-elements.`);
  }
  return `:where([data-zhiyu-resource-pack-surface="true"]) ${selector}`;
}

function validateDeclaration(declaration: Declaration, source: string): void {
  const property = declaration.prop.trim().toLowerCase();
  const value = declaration.value.trim();
  if ((!layoutProperties.has(property) && !visualProperties.has(property)) || property.startsWith('--')) {
    fail('style', source, `Property ${property} is not allowed in W1.`, 'Use bounded layout or visual properties on a semantic zone.');
  }
  if (!value) {
    fail('style', source, `Property ${property} has an empty value.`, 'Provide one bounded W1 value or remove the declaration.');
  }
  if (declaration.important) {
    fail('style', source, '!important is not allowed.', 'Remove !important so the guarded Host boundary remains authoritative.');
  }
  const lowerValue = value.toLowerCase();
  const forbidden = forbiddenValueFragments.find((fragment) => lowerValue.includes(fragment));
  if (forbidden) {
    fail('style', source, `Value fragment ${forbidden} is not allowed.`, 'Use Pack-local bounded CSS values.');
  }
  if (property === 'display' && !['block', 'flex', 'grid'].includes(lowerValue)) {
    fail('style', source, `display:${value} is not allowed.`, 'Use block, flex, or grid; canonical zones cannot be concealed.');
  }
  if (property === 'flex-direction' && !['column', 'column-reverse', 'row', 'row-reverse'].includes(lowerValue)) {
    fail('style', source, `flex-direction:${value} is not supported.`, 'Use a standard row or column direction.');
  }
  if (property === 'flex-wrap' && !['nowrap', 'wrap'].includes(lowerValue)) {
    fail('style', source, `flex-wrap:${value} is not supported.`, 'Use nowrap or wrap.');
  }
  if (property === 'grid-auto-flow' && !['column', 'row'].includes(lowerValue)) {
    fail('style', source, `grid-auto-flow:${value} is not supported.`, 'Use row or column without dense reordering.');
  }
  if ((property.startsWith('align-') || property.startsWith('justify-')) && !alignmentValues.has(lowerValue)) {
    fail('style', source, `${property}:${value} is not supported.`, 'Use a bounded start, center, end, stretch, baseline, or space alignment.');
  }
  if (layoutProperties.has(property) && !['display', 'flex-direction', 'flex-wrap', 'grid-auto-flow'].includes(property)
    && !(property.startsWith('align-') || property.startsWith('justify-'))) {
    validateLayoutValue(property, value, source);
  }
  if (property === 'background-image') validateBackgroundImage(value, source);
  if (lowerValue.includes('url(') && property !== 'background-image') {
    fail('style', source, `url() is not allowed in ${property}.`, 'Use a declared packaged image only in background-image.');
  }
  if (value.length > 512) {
    fail('style', source, `The ${property} value is too long.`, 'Simplify the declaration.');
  }
}

function validateLayoutValue(property: string, value: string, source: string): void {
  const lower = value.toLowerCase();
  if (!/^[a-z0-9.,%()\s+-]+$/u.test(lower) || lower.includes('calc(')) {
    fail('style', source, `${property} uses an unsupported layout expression.`, 'Use bounded px, rem, em, %, fr, auto, repeat(), or minmax() values.');
  }
  if (/\brepeat\(\s*(?:auto-fill|auto-fit)/u.test(lower)) {
    fail('style', source, 'Automatic unbounded grid repetition is not allowed.', 'Use repeat() with a count from 1 to 4.');
  }
  for (const match of lower.matchAll(/(-?\d*\.?\d+)\s*(px|rem|em|%|fr)?/gu)) {
    const amount = Number(match[1]);
    const unit = match[2] ?? '';
    if (!Number.isFinite(amount) || amount < 0) {
      fail('style', source, `${property} contains a negative or invalid size.`, 'Use non-negative bounded sizes.');
    }
    const maximum = unit === 'px' ? (property.includes('padding') || property.includes('gap') ? 96 : 1600)
      : unit === 'rem' || unit === 'em' ? (property.includes('padding') || property.includes('gap') ? 6 : 64)
        : unit === '%' ? 100
          : unit === 'fr' ? 12
            : 12;
    if (amount > maximum) {
      fail('style', source, `${property} exceeds the provisional W1 bound.`, 'Use a smaller value within the ResourcePackSurface.');
    }
  }
  for (const match of lower.matchAll(/\brepeat\(\s*(\d+)/gu)) {
    if (Number(match[1]) > 4 || Number(match[1]) < 1) {
      fail('style', source, 'Grid repetition must be between 1 and 4.', 'Use a smaller fixed repeat() count.');
    }
  }
}

function validateBackgroundImage(value: string, source: string): void {
  const lower = value.toLowerCase();
  if (lower === 'none') return;
  if (lower.includes('image-set(') || lower.includes('cross-fade(') || lower.includes('element(')) {
    fail('style', source, 'The background image function is not supported.', 'Use a gradient or one declared packaged image.');
  }
  const withoutUrls = replaceResourceUrls(value, () => 'pack-resource');
  const functions = [...withoutUrls.matchAll(/([a-z-]+)\(/giu)].map((match) => match[1]?.toLowerCase());
  const unsupported = functions.find((name) => name && name !== 'linear-gradient' && name !== 'radial-gradient' && name !== 'url');
  if (unsupported) {
    fail('style', source, `Background function ${unsupported}() is not supported.`, 'Use linear-gradient(), radial-gradient(), or one declared packaged image.');
  }
}

function replaceResourceUrls(value: string, replace: (path: string) => string): string {
  if (!value.toLowerCase().includes('url(')) return value;
  let found = false;
  const replaced = value.replace(/url\(\s*(["'])([^"']+)\1\s*\)/giu, (_match, _quote: string, rawPath: string) => {
    found = true;
    return `url("${escapeCssUrl(replace(rawPath.trim()))}")`;
  });
  if (!found || replaced.toLowerCase().includes('url(') && /url\(\s*(?!["'])/iu.test(replaced)) {
    fail('style', 'style.css', 'Every Pack URL must be a quoted declared relative resource path.', 'Use url("assets/example.png") with a manifest declaration.');
  }
  return replaced;
}

function isAllowedContainerQuery(params: string): boolean {
  const normalized = params.trim().toLowerCase();
  if (!/^\((?:min|max)-width:\s*\d+(?:\.\d+)?(?:px|rem|em)\)$/u.test(normalized)) return false;
  const match = /(\d+(?:\.\d+)?)(px|rem|em)/u.exec(normalized);
  if (!match) return false;
  const amount = Number(match[1]);
  return match[2] === 'px' ? amount <= 1600 : amount <= 100;
}

function sniffImageMimeType(path: string, bytes: Uint8Array): ZhiyuResourcePackResource['mimeType'] {
  const lowerPath = path.toLowerCase();
  if (lowerPath.endsWith('.png') && hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    && !hasPngChunk(bytes, 'acTL')) return 'image/png';
  if ((lowerPath.endsWith('.jpg') || lowerPath.endsWith('.jpeg')) && hasPrefix(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (lowerPath.endsWith('.webp') && hasPrefix(bytes, [0x52, 0x49, 0x46, 0x46])
    && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
    && !hasWebpAnimation(bytes)) return 'image/webp';
  fail('resource', path, 'W1 accepts only signature-matched PNG, JPEG, or WebP images.', 'Convert the resource to a supported image format.');
}

function hasPngChunk(bytes: Uint8Array, expectedType: string): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  while (offset + 12 <= bytes.byteLength) {
    const length = view.getUint32(offset, false);
    const end = offset + 12 + length;
    if (end > bytes.byteLength) return false;
    const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
    if (type === expectedType) return true;
    offset = end;
  }
  return false;
}

function hasWebpAnimation(bytes: Uint8Array): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const type = String.fromCharCode(...bytes.slice(offset, offset + 4));
    const length = view.getUint32(offset + 4, true);
    const dataStart = offset + 8;
    const end = dataStart + length;
    if (end > bytes.byteLength) return false;
    if (type === 'ANIM' || type === 'ANMF') return true;
    if (type === 'VP8X' && length >= 1 && Boolean((bytes[dataStart] ?? 0) & 0x02)) return true;
    offset = end + (length % 2);
  }
  return false;
}

function requiredEntry(
  entries: ReadonlyMap<string, Uint8Array>,
  path: string,
  category: ZhiyuResourcePackFailureCategory,
): Uint8Array {
  const entry = entries.get(path);
  if (!entry) fail(category, path, 'The required entry is missing.', 'Add the file and rebuild the Pack.');
  return entry;
}

function requiredManifestPath(value: unknown, source: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    fail('manifest', source, 'The entry path must be a non-empty string.', 'Provide a relative packaged file path.');
  }
  return normalizeEntryPath(value);
}

function normalizeEntryPath(rawPath: string): string {
  const path = rawPath.trim();
  if (!path || path.length > 200 || path.startsWith('/') || path.includes('\\') || path.includes('\0') || /^[a-z]:/iu.test(path)) {
    fail('archive', rawPath || '(empty)', 'The entry path is not a bounded relative Pack path.', 'Use a short forward-slash relative path.');
  }
  const segments = path.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    if (path.endsWith('/') && segments.at(-1) === '' && segments.slice(0, -1).every((segment) => segment && segment !== '.' && segment !== '..')) {
      return path;
    }
    fail('archive', path, 'The entry path contains an empty or traversal segment.', 'Remove duplicate separators and dot segments.');
  }
  return path;
}

function decodeText(bytes: Uint8Array, source: string): string {
  try {
    return textDecoder.decode(bytes);
  } catch {
    fail(source === ZHIYU_RESOURCE_PACK_MANIFEST_PATH ? 'manifest' : 'style', source, 'The text entry is not valid UTF-8.', 'Save the file as UTF-8.');
  }
}

function assertExactKeys(record: Record<string, unknown>, expected: readonly string[], source: string): void {
  const keys = Object.keys(record).sort();
  const exact = [...expected].sort();
  if (keys.length !== exact.length || keys.some((key, index) => key !== exact[index])) {
    fail('manifest', source, 'The manifest contains missing or unsupported fields.', `Use only: ${exact.join(', ')}.`);
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasPrefix(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return bytes.byteLength >= prefix.length && prefix.every((value, index) => bytes[index] === value);
}

function escapeCssUrl(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function fail(
  category: ZhiyuResourcePackFailureCategory,
  source: string,
  reason: string,
  repair: string,
): never {
  throw resourcePackError(category, source, reason, repair);
}

function resourcePackError(
  category: ZhiyuResourcePackFailureCategory,
  source: string,
  reason: string,
  repair: string,
): ZhiyuResourcePackError {
  return new ZhiyuResourcePackError({ category, source, reason, repair });
}
