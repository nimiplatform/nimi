import {
  validateHabitatSpecV1,
  type HabitatDaypart,
  type HabitatSceneryKind,
  type HabitatSpecV1,
} from '@nimiplatform/sdk/app';

// @nimi-authority: rule.nimi.platform.app-ecosystem.utopia-operations
// @nimi-authority: rule.nimi.runtime.agent-life.utopia-settings

export const MAX_UTOPIA_ARCHIVE_BYTES = 12 * 1024 * 1024;
export const MAX_UTOPIA_UNCOMPRESSED_BYTES = 24 * 1024 * 1024;
export const MAX_UTOPIA_ARCHIVE_ENTRIES = 48;
export const MAX_UTOPIA_JSON_BYTES = 64 * 1024;
export const MAX_UTOPIA_AUDIO_BYTES = 8 * 1024 * 1024;
export const MAX_UTOPIA_IMAGE_DIMENSION = 4096;

export type UtopiaBundleManifestV1 = Readonly<{
  readonly bundleFormatVersion: '1.0';
  readonly bundleId: string;
  readonly version: string;
  readonly title: string;
  readonly subtitle: string;
  readonly author: string;
  readonly previewAsset: string;
  readonly habitatFile: 'habitat.json';
  readonly stageFile: 'stage.json';
}>;

export type StageVisibilityCondition = Readonly<{
  readonly dayparts?: readonly HabitatDaypart[];
  readonly parameters?: Readonly<Record<string, readonly string[]>>;
  readonly sceneryKinds?: readonly HabitatSceneryKind[];
}>;

export type UtopiaStageAmbientEffectKind =
  | 'snowfall'
  | 'raindrops'
  | 'sea-breeze'
  | 'spirit-mist'
  | 'falling-petals'
  | 'aurora-glow'
  | 'starlight';

export type UtopiaStageBadgeStyle = 'lantern' | 'cabin-window' | 'wooden-sign' | 'minimal-pin';

export type UtopiaDeclarativeStageV1 = Readonly<{
  readonly schemaVersion: '1.0';
  readonly layout: 'horizontal-scroll' | 'panoramic-split' | 'courtyard-grid';
  readonly aspectRatio: '16:9' | '21:9' | '4:3';
  readonly palette: Readonly<{
    readonly stageCanvasBg: string;
    readonly badgeBg: string;
    readonly badgeText: string;
    readonly accent: string;
    readonly frameMotif: 'clean' | 'ink-scroll' | 'industrial-cutaway' | 'coastal-wood';
  }>;
  readonly layers: readonly Readonly<{
    readonly id: string;
    readonly assetPath: string;
    readonly zIndex: number;
    readonly parallaxFactor?: number;
    readonly visibleWhen?: StageVisibilityCondition;
  }>[];
  readonly ambientEffects: readonly Readonly<{
    readonly effect: UtopiaStageAmbientEffectKind;
    readonly intensity: 'subtle' | 'moderate';
    readonly visibleWhen?: StageVisibilityCondition;
  }>[];
  readonly ambientAudio: readonly Readonly<{
    readonly id: string;
    readonly assetPath: string;
    readonly gain: number;
    readonly activeWhen?: StageVisibilityCondition;
  }>[];
  readonly anchors: readonly Readonly<{
    readonly targetId: string;
    readonly xPercent: number;
    readonly yPercent: number;
    readonly badgeStyle: UtopiaStageBadgeStyle;
    readonly maxVisibleAvatars: number;
  }>[];
}>;

export type ValidatedUtopiaAsset = Readonly<{
  readonly relativePath: string;
  readonly bytes: Uint8Array;
  readonly mediaType: string;
  readonly sha256: string;
  readonly width?: number;
  readonly height?: number;
}>;

export type ValidatedUtopiaBundle = Readonly<{
  readonly manifest: UtopiaBundleManifestV1;
  readonly habitat: HabitatSpecV1;
  readonly stage: UtopiaDeclarativeStageV1;
  readonly contentDigest: string;
  readonly assets: ReadonlyMap<string, ValidatedUtopiaAsset>;
}>;

export class UtopiaBundleValidationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'UtopiaBundleValidationError';
    this.code = code;
  }
}

const SAFE_CSS_COLOR_RE = /^(?:#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\))$/u;
const NAMESPACED_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/u;
const LOCAL_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
const SHORT_NOUN_FORBIDDEN_RE = /[\u0000-\u001f\u007f.!?。！？;；:：\r\n\t<>[\]{}]/u;
const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]/u;

const VALID_DAYPARTS = new Set<HabitatDaypart>(['morning', 'day', 'dusk', 'night']);
const VALID_SCENERY_KINDS = new Set<HabitatSceneryKind>([
  'clear-sky', 'rain', 'snowfall', 'mist', 'aurora', 'meteor-shower',
  'blossom', 'wildlife-visit', 'tide-pooling', 'harvest', 'hearth-lit', 'radio-signal',
]);
const VALID_LAYOUTS = new Set<UtopiaDeclarativeStageV1['layout']>([
  'horizontal-scroll', 'panoramic-split', 'courtyard-grid',
]);
const VALID_ASPECT_RATIOS = new Set<UtopiaDeclarativeStageV1['aspectRatio']>(['16:9', '21:9', '4:3']);
const VALID_FRAME_MOTIFS = new Set<UtopiaDeclarativeStageV1['palette']['frameMotif']>([
  'clean', 'ink-scroll', 'industrial-cutaway', 'coastal-wood',
]);
const VALID_EFFECTS = new Set<UtopiaStageAmbientEffectKind>([
  'snowfall', 'raindrops', 'sea-breeze', 'spirit-mist', 'falling-petals', 'aurora-glow', 'starlight',
]);
const VALID_BADGE_STYLES = new Set<UtopiaStageBadgeStyle>([
  'lantern', 'cabin-window', 'wooden-sign', 'minimal-pin',
]);

const IMAGE_MEDIA_TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

const AUDIO_MEDIA_TYPES: Readonly<Record<string, string>> = {
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
};

const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
const utf8Encoder = new TextEncoder();

// CRC32 for ZIP integrity check
const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function computeCrc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = crcTable[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function fail(code: string, message: string): never {
  throw new UtopiaBundleValidationError(code, message);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function codePointCount(text: string): number {
  return Array.from(text).length;
}

function checkExactKeys(obj: unknown, allowed: readonly string[], label: string): Record<string, unknown> {
  if (!isPlainRecord(obj)) {
    fail('INVALID_SCHEMA', `导入未通过：${label} 必须是 JSON 对象。`);
  }
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      fail('UNKNOWN_FIELD', `导入未通过：${label} 包含未定义字段「${key}」。`);
    }
  }
  return obj;
}

function checkSafeCssColor(value: unknown, field: string): string {
  if (typeof value !== 'string' || !SAFE_CSS_COLOR_RE.test(value)) {
    fail('UNSAFE_COLOR', `导入未通过：${field} 必须是安全 Hex 或 rgb/rgba 颜色值。`);
  }
  if (value.startsWith('rgb')) {
    const channels = value.match(/\d+/gu)?.slice(0, 3).map(Number) ?? [];
    if (channels.some((n) => n < 0 || n > 255)) {
      fail('UNSAFE_COLOR', `导入未通过：${field} 的 RGB 通道超出 0..255。`);
    }
  }
  return value;
}

function canonicalizeJcs(value: unknown): string {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('INVALID_JSON', 'JCS 不支持非有限数值。');
    return Object.is(value, -0) ? '0' : JSON.stringify(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeJcs(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const rec = value as Record<string, unknown>;
    const keys = Object.keys(rec)
      .filter((k) => rec[k] !== undefined)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalizeJcs(rec[k])}`).join(',')}}`;
  }
  return fail('INVALID_JSON', 'JCS 遇到不受支持的数据类型。');
}

export async function sha256Prefixed(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', copy);
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  return `sha256:${hex}`;
}

export async function computeHabitatContentDigest(habitat: HabitatSpecV1): Promise<string> {
  const canonical = canonicalizeJcs(habitat);
  return sha256Prefixed(utf8Encoder.encode(canonical));
}

function extOf(relPath: string): string {
  const dot = relPath.lastIndexOf('.');
  return dot >= 0 ? relPath.slice(dot).toLowerCase() : '';
}

export function inspectImageDimensions(bytes: Uint8Array, relPath: string): { width: number; height: number } {
  const ext = extOf(relPath);
  let width = 0;
  let height = 0;

  if (ext === '.png') {
    if (
      bytes.byteLength < 24
      || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47
      || bytes[4] !== 0x0d || bytes[5] !== 0x0a || bytes[6] !== 0x1a || bytes[7] !== 0x0a
      || bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52
    ) {
      fail('INVALID_IMAGE_HEADER', `导入未通过：图像「${relPath}」不是合法的 PNG 文件头。`);
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    width = view.getUint32(16, false);
    height = view.getUint32(20, false);
  } else if (ext === '.jpg' || ext === '.jpeg') {
    if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
      fail('INVALID_IMAGE_HEADER', `导入未通过：图像「${relPath}」不是合法的 JPEG 文件头。`);
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 2;
    let foundSof = false;
    while (offset + 4 <= bytes.byteLength) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      while (offset < bytes.byteLength && bytes[offset] === 0xff) offset += 1;
      if (offset >= bytes.byteLength) break;
      const marker = bytes[offset]!;
      offset += 1;
      if (marker === 0xd9 || marker === 0xda) break; // EOI or SOS
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.byteLength) break;
      const segLen = view.getUint16(offset, false);
      if (segLen < 2 || offset + segLen > bytes.byteLength) {
        fail('INVALID_IMAGE_HEADER', `导入未通过：JPEG 图像「${relPath}」段长度损坏。`);
      }
      const isSof = (marker >= 0xc0 && marker <= 0xcf) && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) {
        if (segLen < 7) fail('INVALID_IMAGE_HEADER', `导入未通过：JPEG 图像「${relPath}」SOF 段损坏。`);
        height = view.getUint16(offset + 3, false);
        width = view.getUint16(offset + 5, false);
        foundSof = true;
        break;
      }
      offset += segLen;
    }
    if (!foundSof) {
      fail('INVALID_IMAGE_HEADER', `导入未通过：无法从 JPEG 图像「${relPath}」读取尺寸头。`);
    }
  } else if (ext === '.webp') {
    if (
      bytes.byteLength < 30
      || bytes[0] !== 0x52 || bytes[1] !== 0x49 || bytes[2] !== 0x46 || bytes[3] !== 0x46
      || bytes[8] !== 0x57 || bytes[9] !== 0x45 || bytes[10] !== 0x42 || bytes[11] !== 0x50
    ) {
      fail('INVALID_IMAGE_HEADER', `导入未通过：图像「${relPath}」不是合法的 WebP 文件头。`);
    }
    const chunkTag = String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (chunkTag === 'VP8 ') {
      if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) {
        fail('INVALID_IMAGE_HEADER', `导入未通过：WebP VP8 图像「${relPath}」帧头无效。`);
      }
      width = view.getUint16(26, true) & 0x3fff;
      height = view.getUint16(28, true) & 0x3fff;
    } else if (chunkTag === 'VP8L') {
      if (bytes[20] !== 0x2f) {
        fail('INVALID_IMAGE_HEADER', `导入未通过：WebP VP8L 图像「${relPath}」签名无效。`);
      }
      const bits = view.getUint32(21, true);
      width = (bits & 0x3fff) + 1;
      height = ((bits >>> 14) & 0x3fff) + 1;
    } else if (chunkTag === 'VP8X') {
      width = 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16));
      height = 1 + (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16));
    } else {
      fail('INVALID_IMAGE_HEADER', `导入未通过：WebP 图像「${relPath}」使用了未知块类型。`);
    }
  } else {
    fail('FORBIDDEN_FILE_TYPE', `导入未通过：不支持的图像扩展名「${relPath}」。`);
  }

  if (width <= 0 || height <= 0 || width > MAX_UTOPIA_IMAGE_DIMENSION || height > MAX_UTOPIA_IMAGE_DIMENSION) {
    fail(
      'IMAGE_DIMENSIONS_EXCEEDED',
      `导入未通过：图像「${relPath}」尺寸为 ${width}×${height}，超出单张 4096×4096 安全上限。`,
    );
  }
  return { width, height };
}

function normalizeSafeArchivePath(rawNameBytes: Uint8Array): string {
  let decoded: string;
  try {
    decoded = utf8Decoder.decode(rawNameBytes);
  } catch {
    fail('INVALID_ARCHIVE_PATH', '导入未通过：压缩包内存在非 UTF-8 文件名。');
  }
  if (
    !decoded
    || decoded.startsWith('/')
    || decoded.includes('\\')
    || decoded.includes('\0')
    || CONTROL_CHAR_RE.test(decoded)
  ) {
    fail('PATH_TRAVERSAL', `导入未通过：检测到非法归档路径「${decoded}」。`);
  }
  const trimmed = decoded.endsWith('/') ? decoded.slice(0, -1) : decoded;
  const segments = trimmed.split('/');
  for (const seg of segments) {
    if (!seg || seg === '.' || seg === '..' || seg.trim() !== seg) {
      fail('PATH_TRAVERSAL', `导入未通过：归档路径「${decoded}」包含路径穿越或空白段。`);
    }
  }
  if (segments[0]?.toLowerCase() === 'hook' || segments.some((s) => s.toLowerCase() === 'hook')) {
    fail('FORBIDDEN_HOOK_DIR', `导入未通过：纯声明式洞天包严禁包含可执行 hook 目录（「${decoded}」）。`);
  }
  return decoded;
}

export function validateBundleManifestV1(raw: unknown): UtopiaBundleManifestV1 {
  const obj = checkExactKeys(
    raw,
    ['bundleFormatVersion', 'bundleId', 'version', 'title', 'subtitle', 'author', 'previewAsset', 'habitatFile', 'stageFile'],
    'manifest.json',
  );
  if (obj.bundleFormatVersion !== '1.0') {
    fail('INVALID_MANIFEST', '导入未通过：manifest.json 的 bundleFormatVersion 必须为 "1.0"。');
  }
  if (typeof obj.bundleId !== 'string' || obj.bundleId.length < 3 || obj.bundleId.length > 64 || !NAMESPACED_ID_RE.test(obj.bundleId)) {
    fail('INVALID_MANIFEST', '导入未通过：manifest.json 的 bundleId 必须为合法命名空间标识（如 creator.theme.name）。');
  }
  if (typeof obj.version !== 'string' || !SEMVER_RE.test(obj.version)) {
    fail('INVALID_MANIFEST', '导入未通过：manifest.json 的 version 必须符合 SemVer（如 1.0.0）。');
  }
  if (
    typeof obj.title !== 'string'
    || obj.title.trim() !== obj.title
    || codePointCount(obj.title) < 1
    || codePointCount(obj.title) > 16
    || SHORT_NOUN_FORBIDDEN_RE.test(obj.title)
  ) {
    fail('INVALID_MANIFEST', '导入未通过：manifest.json 的 title 必须为 1 至 16 字的短名词，且不含句号或感叹号。');
  }
  if (
    typeof obj.subtitle !== 'string'
    || obj.subtitle.trim() !== obj.subtitle
    || codePointCount(obj.subtitle) < 1
    || codePointCount(obj.subtitle) > 60
    || CONTROL_CHAR_RE.test(obj.subtitle)
  ) {
    fail('INVALID_MANIFEST', '导入未通过：manifest.json 的 subtitle 长度须为 1 至 60 字。');
  }
  if (
    typeof obj.author !== 'string'
    || obj.author.trim() !== obj.author
    || codePointCount(obj.author) < 1
    || codePointCount(obj.author) > 32
    || CONTROL_CHAR_RE.test(obj.author)
  ) {
    fail('INVALID_MANIFEST', '导入未通过：manifest.json 的 author 长度须为 1 至 32 字。');
  }
  if (typeof obj.previewAsset !== 'string' || !obj.previewAsset.startsWith('assets/')) {
    fail('INVALID_MANIFEST', '导入未通过：manifest.json 的 previewAsset 必须指向 assets/ 下的光栅封面图。');
  }
  if (obj.habitatFile !== 'habitat.json' || obj.stageFile !== 'stage.json') {
    fail('INVALID_MANIFEST', '导入未通过：manifest.json 的 habitatFile 与 stageFile 必须固定为 habitat.json 与 stage.json。');
  }
  return Object.freeze({
    bundleFormatVersion: '1.0',
    bundleId: obj.bundleId,
    version: obj.version,
    title: obj.title,
    subtitle: obj.subtitle,
    author: obj.author,
    previewAsset: obj.previewAsset,
    habitatFile: 'habitat.json',
    stageFile: 'stage.json',
  });
}

function validateStageVisibilityCondition(
  raw: unknown,
  habitat: HabitatSpecV1,
  label: string,
): StageVisibilityCondition {
  const obj = checkExactKeys(raw, ['dayparts', 'parameters', 'sceneryKinds'], label);
  const paramMap = new Map<string, Set<string>>(
    habitat.parameters.map((p) => [p.key, new Set(p.options.map((o) => o.value))]),
  );

  let dayparts: readonly HabitatDaypart[] | undefined;
  if (obj.dayparts !== undefined) {
    if (!Array.isArray(obj.dayparts) || obj.dayparts.length === 0 || obj.dayparts.length > 4) {
      fail('INVALID_STAGE', `导入未通过：${label}.dayparts 必须是非空时段数组。`);
    }
    const seen = new Set<HabitatDaypart>();
    dayparts = Object.freeze(obj.dayparts.map((d) => {
      if (typeof d !== 'string' || !VALID_DAYPARTS.has(d as HabitatDaypart) || seen.has(d as HabitatDaypart)) {
        fail('INVALID_STAGE', `导入未通过：${label}.dayparts 含无效或重复时段「${String(d)}」。`);
      }
      seen.add(d as HabitatDaypart);
      return d as HabitatDaypart;
    }));
  }

  let parameters: Readonly<Record<string, readonly string[]>> | undefined;
  if (obj.parameters !== undefined) {
    if (!isPlainRecord(obj.parameters)) {
      fail('INVALID_STAGE', `导入未通过：${label}.parameters 必须是对象。`);
    }
    const out: Record<string, readonly string[]> = {};
    for (const [key, vals] of Object.entries(obj.parameters)) {
      const allowed = paramMap.get(key);
      if (!allowed) {
        fail('INVALID_STAGE', `导入未通过：${label}.parameters 引用了未声明参数「${key}」。`);
      }
      if (!Array.isArray(vals) || vals.length === 0 || vals.length > 5) {
        fail('INVALID_STAGE', `导入未通过：${label}.parameters.${key} 必须是非空选项数组。`);
      }
      out[key] = Object.freeze(vals.map((v) => {
        if (typeof v !== 'string' || !allowed.has(v)) {
          fail('INVALID_STAGE', `导入未通过：${label}.parameters.${key} 含未定义选项「${String(v)}」。`);
        }
        return v;
      }));
    }
    parameters = Object.freeze(out);
  }

  let sceneryKinds: readonly HabitatSceneryKind[] | undefined;
  if (obj.sceneryKinds !== undefined) {
    if (!Array.isArray(obj.sceneryKinds) || obj.sceneryKinds.length === 0 || obj.sceneryKinds.length > 12) {
      fail('INVALID_STAGE', `导入未通过：${label}.sceneryKinds 必须是非空风物类别数组。`);
    }
    sceneryKinds = Object.freeze(obj.sceneryKinds.map((s) => {
      if (typeof s !== 'string' || !VALID_SCENERY_KINDS.has(s as HabitatSceneryKind)) {
        fail('INVALID_STAGE', `导入未通过：${label}.sceneryKinds 含无效风物类别「${String(s)}」。`);
      }
      return s as HabitatSceneryKind;
    }));
  }

  return Object.freeze({
    ...(dayparts ? { dayparts } : {}),
    ...(parameters ? { parameters } : {}),
    ...(sceneryKinds ? { sceneryKinds } : {}),
  });
}

export function validateDeclarativeStageV1(
  raw: unknown,
  habitat: HabitatSpecV1,
  availableAssetTypes: ReadonlyMap<string, 'image' | 'audio'>,
): UtopiaDeclarativeStageV1 {
  const obj = checkExactKeys(
    raw,
    ['schemaVersion', 'layout', 'aspectRatio', 'palette', 'layers', 'ambientEffects', 'ambientAudio', 'anchors'],
    'stage.json',
  );
  if (obj.schemaVersion !== '1.0') {
    fail('INVALID_STAGE', '导入未通过：stage.json 的 schemaVersion 必须为 "1.0"。');
  }
  if (typeof obj.layout !== 'string' || !VALID_LAYOUTS.has(obj.layout as UtopiaDeclarativeStageV1['layout'])) {
    fail('INVALID_STAGE', `导入未通过：stage.json 的 layout「${String(obj.layout)}」不在受支持枚举内。`);
  }
  if (typeof obj.aspectRatio !== 'string' || !VALID_ASPECT_RATIOS.has(obj.aspectRatio as UtopiaDeclarativeStageV1['aspectRatio'])) {
    fail('INVALID_STAGE', '导入未通过：stage.json 的 aspectRatio 必须为 16:9、21:9 或 4:3。');
  }

  const palObj = checkExactKeys(
    obj.palette,
    ['stageCanvasBg', 'badgeBg', 'badgeText', 'accent', 'frameMotif'],
    'stage.json palette',
  );
  if (typeof palObj.frameMotif !== 'string' || !VALID_FRAME_MOTIFS.has(palObj.frameMotif as UtopiaDeclarativeStageV1['palette']['frameMotif'])) {
    fail('INVALID_STAGE', '导入未通过：palette.frameMotif 不合法。');
  }
  const palette = Object.freeze({
    stageCanvasBg: checkSafeCssColor(palObj.stageCanvasBg, 'palette.stageCanvasBg'),
    badgeBg: checkSafeCssColor(palObj.badgeBg, 'palette.badgeBg'),
    badgeText: checkSafeCssColor(palObj.badgeText, 'palette.badgeText'),
    accent: checkSafeCssColor(palObj.accent, 'palette.accent'),
    frameMotif: palObj.frameMotif as UtopiaDeclarativeStageV1['palette']['frameMotif'],
  });

  if (!Array.isArray(obj.layers) || obj.layers.length < 1 || obj.layers.length > 16) {
    fail('INVALID_STAGE', '导入未通过：stage.json 的 layers 须包含 1 至 16 个图层。');
  }
  const seenLayerIds = new Set<string>();
  const layers = Object.freeze(obj.layers.map((item, idx) => {
    const l = checkExactKeys(item, ['id', 'assetPath', 'zIndex', 'parallaxFactor', 'visibleWhen'], `layers[${idx}]`);
    if (typeof l.id !== 'string' || !LOCAL_SLUG_RE.test(l.id) || seenLayerIds.has(l.id)) {
      fail('INVALID_STAGE', `导入未通过：图层 id「${String(l.id)}」非法或重复。`);
    }
    seenLayerIds.add(l.id);
    if (typeof l.assetPath !== 'string' || availableAssetTypes.get(l.assetPath) !== 'image') {
      fail('MISSING_ASSET', `导入未通过：图层「${l.id}」引用的图像资源「${String(l.assetPath)}」不存在于 assets/。`);
    }
    if (typeof l.zIndex !== 'number' || !Number.isInteger(l.zIndex) || l.zIndex < 0 || l.zIndex > 100) {
      fail('INVALID_STAGE', `导入未通过：图层「${l.id}」的 zIndex 必须是 0..100 整数。`);
    }
    let parallaxFactor: number | undefined;
    if (l.parallaxFactor !== undefined) {
      if (typeof l.parallaxFactor !== 'number' || !Number.isFinite(l.parallaxFactor) || l.parallaxFactor < 0 || l.parallaxFactor > 0.4) {
        fail('INVALID_STAGE', `导入未通过：图层「${l.id}」的 parallaxFactor 必须在 0..0.4 之间。`);
      }
      parallaxFactor = l.parallaxFactor;
    }
    const visibleWhen = l.visibleWhen !== undefined
      ? validateStageVisibilityCondition(l.visibleWhen, habitat, `layers[${idx}].visibleWhen`)
      : undefined;
    return Object.freeze({
      id: l.id,
      assetPath: l.assetPath,
      zIndex: l.zIndex,
      ...(parallaxFactor !== undefined ? { parallaxFactor } : {}),
      ...(visibleWhen !== undefined ? { visibleWhen } : {}),
    });
  }));

  if (!Array.isArray(obj.ambientEffects) || obj.ambientEffects.length > 4) {
    fail('INVALID_STAGE', '导入未通过：stage.json 的 ambientEffects 最多声明 4 项。');
  }
  const ambientEffects = Object.freeze(obj.ambientEffects.map((item, idx) => {
    const e = checkExactKeys(item, ['effect', 'intensity', 'visibleWhen'], `ambientEffects[${idx}]`);
    if (typeof e.effect !== 'string' || !VALID_EFFECTS.has(e.effect as UtopiaStageAmbientEffectKind)) {
      fail('INVALID_STAGE', `导入未通过：ambientEffects[${idx}] 的 effect「${String(e.effect)}」不支持。`);
    }
    if (e.intensity !== 'subtle' && e.intensity !== 'moderate') {
      fail('INVALID_STAGE', `导入未通过：ambientEffects[${idx}] 的 intensity 必须为 subtle 或 moderate。`);
    }
    const visibleWhen = e.visibleWhen !== undefined
      ? validateStageVisibilityCondition(e.visibleWhen, habitat, `ambientEffects[${idx}].visibleWhen`)
      : undefined;
    return Object.freeze({
      effect: e.effect as UtopiaStageAmbientEffectKind,
      intensity: e.intensity as 'subtle' | 'moderate',
      ...(visibleWhen !== undefined ? { visibleWhen } : {}),
    });
  }));

  if (!Array.isArray(obj.ambientAudio) || obj.ambientAudio.length > 6) {
    fail('INVALID_STAGE', '导入未通过：stage.json 的 ambientAudio 最多声明 6 项。');
  }
  const seenAudioIds = new Set<string>();
  const ambientAudio = Object.freeze(obj.ambientAudio.map((item, idx) => {
    const a = checkExactKeys(item, ['id', 'assetPath', 'gain', 'activeWhen'], `ambientAudio[${idx}]`);
    if (typeof a.id !== 'string' || !LOCAL_SLUG_RE.test(a.id) || seenAudioIds.has(a.id)) {
      fail('INVALID_STAGE', `导入未通过：环境音频 id「${String(a.id)}」非法或重复。`);
    }
    seenAudioIds.add(a.id);
    if (typeof a.assetPath !== 'string' || availableAssetTypes.get(a.assetPath) !== 'audio') {
      fail('MISSING_ASSET', `导入未通过：环境音频「${a.id}」引用的音频资源「${String(a.assetPath)}」不存在于 assets/。`);
    }
    if (typeof a.gain !== 'number' || !Number.isFinite(a.gain) || a.gain < 0.05 || a.gain > 0.6) {
      fail('INVALID_STAGE', `导入未通过：环境音频「${a.id}」的 gain 必须在 0.05..0.6 之间。`);
    }
    const activeWhen = a.activeWhen !== undefined
      ? validateStageVisibilityCondition(a.activeWhen, habitat, `ambientAudio[${idx}].activeWhen`)
      : undefined;
    return Object.freeze({
      id: a.id,
      assetPath: a.assetPath,
      gain: a.gain,
      ...(activeWhen !== undefined ? { activeWhen } : {}),
    });
  }));

  const requiredAnchorTargets = new Map<string, string>([
    ['personal-quarter', habitat.personalQuarter.name],
    ...habitat.places.map((p): [string, string] => [p.id, p.name]),
  ]);
  if (!Array.isArray(obj.anchors)) {
    fail('INVALID_STAGE', '导入未通过：stage.json 的 anchors 必须是数组。');
  }
  const seenAnchorTargets = new Set<string>();
  const anchors = Object.freeze(obj.anchors.map((item, idx) => {
    const anchor = checkExactKeys(
      item,
      ['targetId', 'xPercent', 'yPercent', 'badgeStyle', 'maxVisibleAvatars'],
      `anchors[${idx}]`,
    );
    if (typeof anchor.targetId !== 'string' || !requiredAnchorTargets.has(anchor.targetId)) {
      fail('INVALID_ANCHOR', `导入未通过：stage.json 存在未在 habitat.json 声明的场所锚点「${String(anchor.targetId)}」。`);
    }
    if (seenAnchorTargets.has(anchor.targetId)) {
      fail('INVALID_ANCHOR', `导入未通过：场所锚点「${anchor.targetId}」在 stage.json 中重复声明。`);
    }
    seenAnchorTargets.add(anchor.targetId);
    if (typeof anchor.xPercent !== 'number' || !Number.isFinite(anchor.xPercent) || anchor.xPercent < 6 || anchor.xPercent > 94) {
      fail('INVALID_ANCHOR', `导入未通过：锚点「${anchor.targetId}」的 xPercent 须在 6..94 安全边距内。`);
    }
    if (typeof anchor.yPercent !== 'number' || !Number.isFinite(anchor.yPercent) || anchor.yPercent < 10 || anchor.yPercent > 90) {
      fail('INVALID_ANCHOR', `导入未通过：锚点「${anchor.targetId}」的 yPercent 须在 10..90 安全边距内。`);
    }
    if (typeof anchor.badgeStyle !== 'string' || !VALID_BADGE_STYLES.has(anchor.badgeStyle as UtopiaStageBadgeStyle)) {
      fail('INVALID_ANCHOR', `导入未通过：锚点「${anchor.targetId}」的 badgeStyle 不合法。`);
    }
    if (
      typeof anchor.maxVisibleAvatars !== 'number'
      || !Number.isInteger(anchor.maxVisibleAvatars)
      || anchor.maxVisibleAvatars < 2
      || anchor.maxVisibleAvatars > 6
    ) {
      fail('INVALID_ANCHOR', `导入未通过：锚点「${anchor.targetId}」的 maxVisibleAvatars 须为 2..6 整数。`);
    }
    return Object.freeze({
      targetId: anchor.targetId,
      xPercent: anchor.xPercent,
      yPercent: anchor.yPercent,
      badgeStyle: anchor.badgeStyle as UtopiaStageBadgeStyle,
      maxVisibleAvatars: anchor.maxVisibleAvatars,
    });
  }));

  for (const [targetId, placeName] of requiredAnchorTargets.entries()) {
    if (!seenAnchorTargets.has(targetId)) {
      fail('MISSING_ANCHOR', `导入未通过：场所「${placeName} (${targetId})」在 stage.json 中缺少坐标锚点。`);
    }
  }

  return Object.freeze({
    schemaVersion: '1.0',
    layout: obj.layout as UtopiaDeclarativeStageV1['layout'],
    aspectRatio: obj.aspectRatio as UtopiaDeclarativeStageV1['aspectRatio'],
    palette,
    layers,
    ambientEffects,
    ambientAudio,
    anchors,
  });
}

async function inflateDeflateRawBounded(
  compressed: Uint8Array,
  expectedLength: number,
  budget: { totalUncompressed: number },
  relPath: string,
): Promise<Uint8Array> {
  if (typeof globalThis.DecompressionStream !== 'function') {
    fail('DECOMPRESSION_UNAVAILABLE', '当前运行环境不支持 DecompressionStream 流式解压。');
  }
  const ds = new globalThis.DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  const reader = ds.readable.getReader();

  const copy = new Uint8Array(compressed.byteLength);
  copy.set(compressed);
  let writeErr: unknown = null;
  const writePromise = writer
    .write(copy)
    .then(() => writer.close())
    .catch((err: unknown) => {
      writeErr = err;
    });

  const chunks: Uint8Array[] = [];
  let entryBytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      entryBytes += value.byteLength;
      budget.totalUncompressed += value.byteLength;
      if (budget.totalUncompressed > MAX_UTOPIA_UNCOMPRESSED_BYTES) {
        await reader.cancel('zip-bomb-limit').catch(() => undefined);
        await writePromise;
        fail('UNCOMPRESSED_SIZE_EXCEEDED', '导入未通过：洞天包流式解压总体积超出 24 MiB 安全上限。');
      }
      if (entryBytes > expectedLength) {
        await reader.cancel('entry-size-mismatch').catch(() => undefined);
        await writePromise;
        fail('ARCHIVE_CORRUPT', `导入未通过：文件「${relPath}」实际解压字节超出归档声明长度。`);
      }
      chunks.push(value);
    }
    await writePromise;
    if (writeErr) throw writeErr;
  } catch (err) {
    if (err instanceof UtopiaBundleValidationError) throw err;
    fail('ARCHIVE_CORRUPT', `导入未通过：文件「${relPath}」Deflate 数据损坏。`);
  }

  if (entryBytes !== expectedLength) {
    fail('ARCHIVE_CORRUPT', `导入未通过：文件「${relPath}」解压后长度与归档头不一致。`);
  }
  const out = new Uint8Array(entryBytes);
  let pos = 0;
  for (const chunk of chunks) {
    out.set(chunk, pos);
    pos += chunk.byteLength;
  }
  return out;
}

export async function validateUtopiaBundleParts(input: {
  readonly rawManifest: unknown;
  readonly rawHabitat: unknown;
  readonly rawStage: unknown;
  readonly rawAssets: ReadonlyMap<string, Uint8Array>;
  readonly allowBuiltinNamespace?: boolean;
}): Promise<ValidatedUtopiaBundle> {
  const manifest = validateBundleManifestV1(input.rawManifest);
  if (!input.allowBuiltinNamespace && manifest.bundleId.startsWith('nimi.builtin.')) {
    fail('RESERVED_NAMESPACE', `导入未通过：保留命名空间「${manifest.bundleId}」仅限官方内置洞天使用。`);
  }
  let habitat: HabitatSpecV1;
  try {
    habitat = validateHabitatSpecV1(input.rawHabitat, !input.allowBuiltinNamespace);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    fail('INVALID_HABITAT', `导入未通过：habitat.json 违反 HabitatSpecV1 契约（${detail}）。`);
  }

  if (manifest.bundleId !== habitat.habitatId) {
    fail(
      'ID_MISMATCH',
      `导入未通过：manifest.json 的 bundleId「${manifest.bundleId}」与 habitat.json 的 habitatId「${habitat.habitatId}」不一致。`,
    );
  }

  const assetTypes = new Map<string, 'image' | 'audio'>();
  const validatedAssets = new Map<string, ValidatedUtopiaAsset>();

  for (const [relPath, bytes] of input.rawAssets.entries()) {
    if (!relPath.startsWith('assets/')) {
      fail('FORBIDDEN_FILE_PATH', `导入未通过：非根配置文件必须位于 assets/ 目录下（「${relPath}」）。`);
    }
    const ext = extOf(relPath);
    if (ext in IMAGE_MEDIA_TYPES) {
      const dims = inspectImageDimensions(bytes, relPath);
      const sha256 = await sha256Prefixed(bytes);
      assetTypes.set(relPath, 'image');
      validatedAssets.set(relPath, Object.freeze({
        relativePath: relPath,
        bytes,
        mediaType: IMAGE_MEDIA_TYPES[ext]!,
        sha256,
        width: dims.width,
        height: dims.height,
      }));
    } else if (ext in AUDIO_MEDIA_TYPES) {
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_UTOPIA_AUDIO_BYTES) {
        fail('AUDIO_SIZE_EXCEEDED', `导入未通过：音频文件「${relPath}」为空或超出 8 MiB 单文件上限。`);
      }
      const sha256 = await sha256Prefixed(bytes);
      assetTypes.set(relPath, 'audio');
      validatedAssets.set(relPath, Object.freeze({
        relativePath: relPath,
        bytes,
        mediaType: AUDIO_MEDIA_TYPES[ext]!,
        sha256,
      }));
    } else {
      fail('FORBIDDEN_FILE_TYPE', `导入未通过：禁止包含非白名单资源类型「${relPath}」（严禁 SVG、HTML、脚本与可执行代码）。`);
    }
  }

  if (assetTypes.get(manifest.previewAsset) !== 'image') {
    fail('MISSING_PREVIEW_ASSET', `导入未通过：manifest.json 指定的封面图「${manifest.previewAsset}」不存在或不是光栅图像。`);
  }

  const stage = validateDeclarativeStageV1(input.rawStage, habitat, assetTypes);
  const contentDigest = await computeHabitatContentDigest(habitat);

  return Object.freeze({
    manifest,
    habitat,
    stage,
    contentDigest,
    assets: validatedAssets,
  });
}

export async function inspectUtopiaArchiveFile(
  file: Pick<File, 'size' | 'arrayBuffer'>,
): Promise<ValidatedUtopiaBundle> {
  if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MAX_UTOPIA_ARCHIVE_BYTES) {
    fail('ARCHIVE_SIZE_EXCEEDED', '导入未通过：压缩包不能为空，且不能超过 12 MiB。');
  }
  return parseAndValidateUtopiaZip(new Uint8Array(await file.arrayBuffer()));
}

export async function parseAndValidateUtopiaZip(archiveBytes: Uint8Array): Promise<ValidatedUtopiaBundle> {
  if (archiveBytes.byteLength < 22) {
    fail('ARCHIVE_TOO_SMALL', '导入未通过：文件不是有效的 .utopia (ZIP) 归档。');
  }
  if (archiveBytes.byteLength > MAX_UTOPIA_ARCHIVE_BYTES) {
    fail('ARCHIVE_TOO_LARGE', '导入未通过：.utopia 压缩包超出 12 MiB 体积上限。');
  }

  const view = new DataView(archiveBytes.buffer, archiveBytes.byteOffset, archiveBytes.byteLength);
  const minEocdOffset = Math.max(0, archiveBytes.byteLength - 65_557);
  let eocdOffset = -1;
  for (let i = archiveBytes.byteLength - 22; i >= minEocdOffset; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      const commentLen = view.getUint16(i + 20, true);
      if (i + 22 + commentLen === archiveBytes.byteLength) {
        eocdOffset = i;
        break;
      }
    }
  }
  if (eocdOffset < 0) {
    fail('ARCHIVE_CORRUPT', '导入未通过：未找到有效的 ZIP 中央目录结尾记录。');
  }

  const diskNum = view.getUint16(eocdOffset + 4, true);
  const cdDisk = view.getUint16(eocdOffset + 6, true);
  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const cdSize = view.getUint32(eocdOffset + 12, true);
  const cdOffset = view.getUint32(eocdOffset + 16, true);

  if (diskNum !== 0 || cdDisk !== 0 || totalEntries === 0xffff || cdOffset === 0xffffffff) {
    fail('ARCHIVE_UNSUPPORTED', '导入未通过：不支持分卷或 ZIP64 归档。');
  }
  if (totalEntries === 0 || totalEntries > MAX_UTOPIA_ARCHIVE_ENTRIES) {
    fail('ENTRY_LIMIT_EXCEEDED', `导入未通过：归档包含 ${totalEntries} 个条目，超出 48 个条目安全上限。`);
  }
  if (cdOffset + cdSize > eocdOffset) {
    fail('ARCHIVE_CORRUPT', '导入未通过：ZIP 中央目录偏移越界。');
  }

  const caseFoldedSeen = new Set<string>();
  const jsonTextFiles = new Map<string, string>();
  const rawAssets = new Map<string, Uint8Array>();
  const budget = { totalUncompressed: 0 };

  let cursor = cdOffset;
  for (let entryIdx = 0; entryIdx < totalEntries; entryIdx++) {
    if (cursor + 46 > eocdOffset || view.getUint32(cursor, true) !== 0x02014b50) {
      fail('ARCHIVE_CORRUPT', '导入未通过：ZIP 中央目录条目头损坏。');
    }
    const gpFlag = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const expectedCrc = view.getUint32(cursor + 16, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLen = view.getUint16(cursor + 28, true);
    const extraLen = view.getUint16(cursor + 30, true);
    const commentLen = view.getUint16(cursor + 32, true);
    const externalAttr = view.getUint32(cursor + 38, true);
    const localHeaderOffset = view.getUint32(cursor + 42, true);

    if ((gpFlag & 0x01) !== 0) {
      fail('ARCHIVE_ENCRYPTED', '导入未通过：不支持加密的 .utopia 归档。');
    }
    const unixMode = (externalAttr >>> 16) & 0o170000;
    if (unixMode === 0o120000) {
      fail('FORBIDDEN_SYMLINK', '导入未通过：压缩包不能包含符号链接条目。');
    }
    if (cursor + 46 + nameLen + extraLen + commentLen > eocdOffset) {
      fail('ARCHIVE_CORRUPT', '导入未通过：ZIP 文件名字段越界。');
    }

    const rawName = archiveBytes.subarray(cursor + 46, cursor + 46 + nameLen);
    cursor += 46 + nameLen + extraLen + commentLen;

    const safePath = normalizeSafeArchivePath(rawName);
    if (safePath.endsWith('/')) {
      if (compressedSize !== 0 || uncompressedSize !== 0) {
        fail('ARCHIVE_CORRUPT', `导入未通过：目录条目「${safePath}」携带了异常载荷。`);
      }
      continue;
    }

    const folded = safePath.toLowerCase();
    if (caseFoldedSeen.has(folded)) {
      fail('DUPLICATE_ENTRY', `导入未通过：归档内存在大小写重名路径「${safePath}」。`);
    }
    caseFoldedSeen.add(folded);

    const isRootJson = safePath === 'manifest.json' || safePath === 'habitat.json' || safePath === 'stage.json';
    if (!isRootJson && !safePath.startsWith('assets/')) {
      fail('FORBIDDEN_FILE_TYPE', `导入未通过：不允许的根目录或脚本文件「${safePath}」。`);
    }
    if (!isRootJson) {
      const ext = extOf(safePath);
      if (!(ext in IMAGE_MEDIA_TYPES) && !(ext in AUDIO_MEDIA_TYPES)) {
        fail('FORBIDDEN_FILE_TYPE', `导入未通过：资源「${safePath}」不在允许的光栅图像／音频白名单内。`);
      }
    }

    if (uncompressedSize > MAX_UTOPIA_UNCOMPRESSED_BYTES) {
      fail('UNCOMPRESSED_SIZE_EXCEEDED', `导入未通过：文件「${safePath}」超出 24 MiB 解压体积上限。`);
    }
    if (isRootJson && uncompressedSize > MAX_UTOPIA_JSON_BYTES) {
      fail('JSON_TOO_LARGE', `导入未通过：配置文件「${safePath}」超出 64 KiB 上限。`);
    }

    if (localHeaderOffset + 30 > cdOffset || view.getUint32(localHeaderOffset, true) !== 0x04034b50) {
      fail('ARCHIVE_CORRUPT', `导入未通过：文件「${safePath}」本地文件头损坏。`);
    }
    const localNameLen = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > cdOffset) {
      fail('ARCHIVE_CORRUPT', `导入未通过：文件「${safePath}」压缩数据越界。`);
    }

    const compressedSlice = archiveBytes.subarray(dataStart, dataEnd);
    let content: Uint8Array;
    if (method === 0) {
      if (compressedSize !== uncompressedSize) {
        fail('ARCHIVE_CORRUPT', `导入未通过：Store 条目「${safePath}」长度不一致。`);
      }
      budget.totalUncompressed += uncompressedSize;
      if (budget.totalUncompressed > MAX_UTOPIA_UNCOMPRESSED_BYTES) {
        fail('UNCOMPRESSED_SIZE_EXCEEDED', '导入未通过：洞天包总解压体积超出 24 MiB 安全上限。');
      }
      content = new Uint8Array(compressedSlice);
    } else if (method === 8) {
      content = await inflateDeflateRawBounded(compressedSlice, uncompressedSize, budget, safePath);
    } else {
      fail('UNSUPPORTED_COMPRESSION', `导入未通过：文件「${safePath}」使用了不受支持的压缩算法 (${method})。`);
    }

    const actualCrc = computeCrc32(content);
    if (actualCrc !== expectedCrc) {
      fail('ARCHIVE_CORRUPT', `导入未通过：文件「${safePath}」CRC32 校验失败。`);
    }

    if (isRootJson) {
      let jsonText: string;
      try {
        jsonText = utf8Decoder.decode(content);
      } catch {
        fail('INVALID_JSON', `导入未通过：配置文件「${safePath}」不是有效 UTF-8。`);
      }
      jsonTextFiles.set(safePath, jsonText);
    } else {
      rawAssets.set(safePath, content);
    }
  }

  for (const reqFile of ['manifest.json', 'habitat.json', 'stage.json'] as const) {
    if (!jsonTextFiles.has(reqFile)) {
      fail('MISSING_CONFIG', `导入未通过：归档缺少必需的根配置文件「${reqFile}」。`);
    }
  }

  const parseConfig = (fileName: string): unknown => {
    try {
      return JSON.parse(jsonTextFiles.get(fileName)!);
    } catch {
      fail('INVALID_JSON', `导入未通过：配置文件「${fileName}」JSON 语法解析失败。`);
    }
  };

  return validateUtopiaBundleParts({
    rawManifest: parseConfig('manifest.json'),
    rawHabitat: parseConfig('habitat.json'),
    rawStage: parseConfig('stage.json'),
    rawAssets,
  });
}
