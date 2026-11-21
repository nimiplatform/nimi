// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-042a
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-043a
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-042d
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { readAppIcon, validateAppIcon } from './app-icons.mjs';
export { validateAppIcon } from './app-icons.mjs';
import { parse as parseYaml } from 'yaml';
import { normalizeAppAccessItems } from './app-access-declaration.mjs';
import { CANONICAL_CAPABILITY_IDS } from './canonical-capability-ids.generated.mjs';
import { SAFETY_PROFILE_FIELD, normalizeSafetyProfile } from './app-safety-profile.mjs';
import {
  STOREFRONT_CATEGORIES,
  STOREFRONT_COVER_BOUNDS,
  STOREFRONT_GALLERY_BOUNDS,
  STOREFRONT_GALLERY_ID_PATTERN,
  STOREFRONT_IMAGE_MAX_BYTES,
  STOREFRONT_LOCALE_PATTERN,
  STOREFRONT_SHA256_PATTERN,
  inspectStaticStorefrontImage,
  storefrontMediaExtension,
} from './storefront-media.mjs';

export const APP_INFO_MAX_BYTES = 1024 * 1024;
export const APP_INTRODUCTION_FILE = 'NIMI_APP.md';
export const APP_INFO_FIELDS = Object.freeze([
  'format', 'app_id', 'version', 'target_id', 'display_name', 'summary', 'icon', 'readme_markdown', 'release_notes_markdown',
  'license', 'app_access', 'capability_contract_refs', 'required_standardized_feature_refs', 'storage_policy', 'author',
  'homepage_url', 'support_url', SAFETY_PROFILE_FIELD, 'storefront',
]);
// Declaration fields that App Tools projects from nimi.app.yaml into the
// archive declaration and that Registry compares against the candidate.
export const APP_INFO_DECLARATION_FIELDS = Object.freeze(['app_id', 'display_name', 'version', 'app_access', 'capability_contract_refs', 'required_standardized_feature_refs', 'storage_policy', SAFETY_PROFILE_FIELD]);

function text(value, label, max, multiline = false) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')
    || (!multiline && (value !== value.trim() || /[\r\n]/u.test(value)))
    || (multiline ? Buffer.byteLength(value) : [...value].length) > max) {
    throw new Error(`App info ${label} must be nonempty and at most ${max} ${multiline ? 'bytes' : 'characters'}`);
  }
  return value;
}

function refs(value, label) {
  if (!Array.isArray(value) || new Set(value).size !== value.length) {
    throw new Error(`App info ${label} must be an explicit unique list (empty is allowed)`);
  }
  const entries = value.map((item) => text(item, label, 200));
  if (label === 'capability_contract_refs') {
    for (const entry of entries) {
      if (!CANONICAL_CAPABILITY_IDS.includes(entry)) throw new Error(`App info ${label} contains unknown CapabilityContract: ${entry}`);
    }
  }
  return entries;
}

function storage(value) {
  if (!value || !['nimi-mediated-default', 'app-owned-os-storage'].includes(value.kind)) {
    throw new Error('App info storage_policy must declare its storage kind');
  }
  const disclosure = value.os_storage_disclosure;
  if (value.kind === 'nimi-mediated-default') {
    if (disclosure !== undefined && disclosure !== null) throw new Error('Mediated storage must not declare OS storage');
    return { kind: value.kind, os_storage_disclosure: null };
  }
  if (!Array.isArray(disclosure) || disclosure.length === 0 || disclosure.length > 40) throw new Error('App-owned OS storage needs its path/purpose/size disclosure');
  return { kind: value.kind, os_storage_disclosure: disclosure.map((item) => ({
    path_pattern: text(item.path_pattern, 'storage path', 500),
    purpose: text(item.purpose, 'storage purpose', 500),
    expected_size_band: text(item.expected_size_band, 'storage size', 500),
  })) };
}

function https(value, field) {
  if (value === undefined || value === '') return '';
  text(value, field, 2048);
  let url;
  try { url = new URL(value); } catch { throw new Error(`App info ${field} must be a valid HTTPS URL without credentials`); }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) throw new Error(`App info ${field} must be HTTPS without credentials`);
  return value;
}

// A declared safety_profile must already be canonical (tool-serialized); an
// absent field means undeclared and is never filled in.
function safetyProfile(value, label) {
  if (value === undefined) return undefined;
  const normalized = normalizeSafetyProfile(value);
  if (JSON.stringify(normalized) !== JSON.stringify(value)) throw new Error(`${label} safety_profile is not canonical; run nimi-app sync to project the declaration`);
  return normalized;
}

export function validateAppInfo(info) {
  if (!info || typeof info !== 'object' || Array.isArray(info)) throw new Error('Unsupported App info format');
  for (const key of Object.keys(info)) if (!APP_INFO_FIELDS.includes(key)) throw new Error(`App info contains unsupported field: ${key}`);
  if (info.format !== 'nimi.app-info/v1') throw new Error('Unsupported App info format');
  for (const key of ['app_id', 'version', 'target_id']) text(info[key], key, 200);
  text(info.display_name, 'display_name', 120);
  text(info.summary, 'summary', 280);
  if (info.icon?.media_type !== 'image/png' || typeof info.icon.data_base64 !== 'string') throw new Error('App info icon must declare PNG bytes');
  const icon = Buffer.from(info.icon.data_base64, 'base64');
  if (icon.toString('base64') !== info.icon.data_base64) throw new Error('App icon base64 is not canonical');
  validateAppIcon(icon);
  text(info.readme_markdown, 'App introduction', 96 * 1024, true);
  if (info.release_notes_markdown !== undefined && info.release_notes_markdown !== '') text(info.release_notes_markdown, 'release notes', 32 * 1024, true);
  text(info.license?.identifier, 'license identifier', 200);
  text(info.license?.text, 'license text', 128 * 1024, true);
  refs(info.app_access, 'app_access');
  normalizeAppAccessItems(info.app_access);
  refs(info.capability_contract_refs, 'capability_contract_refs');
  refs(info.required_standardized_feature_refs, 'required_standardized_feature_refs');
  storage(info.storage_policy);
  if (info.author) text(info.author, 'author', 200);
  https(info.homepage_url, 'homepage_url');
  https(info.support_url, 'support_url');
  safetyProfile(info[SAFETY_PROFILE_FIELD], 'App info');
  if (info.storefront !== undefined) validateAppInfoStorefront(info.storefront);
  if (Buffer.byteLength(JSON.stringify(info)) > APP_INFO_MAX_BYTES) throw new Error('App info exceeds 1 MiB');
  return info;
}

function validLocale(value, label) {
  if (typeof value !== 'string' || value.length > 16 || !STOREFRONT_LOCALE_PATTERN.test(value)) {
    throw new Error(`${label} must be a valid locale tag (e.g. en, zh)`);
  }
  return value;
}

function validateImageRef(ref, bounds, label) {
  if (!ref || typeof ref !== 'object' || Array.isArray(ref)) throw new Error(`${label} must be an image reference object`);
  for (const key of Object.keys(ref)) {
    if (!['media_type', 'width', 'height', 'size', 'sha256'].includes(key)) throw new Error(`${label} contains unsupported field: ${key}`);
  }
  if (!['image/webp', 'image/png'].includes(ref.media_type)) throw new Error(`${label} media_type must be image/webp or image/png`);
  if (!Number.isInteger(ref.width) || !Number.isInteger(ref.height)
    || ref.width < bounds.minW || ref.width > bounds.maxW || ref.height < bounds.minH || ref.height > bounds.maxH) {
    throw new Error(`${label} dimensions are outside allowed bounds`);
  }
  if (!Number.isInteger(ref.size) || ref.size <= 0 || ref.size > STOREFRONT_IMAGE_MAX_BYTES || !STOREFRONT_SHA256_PATTERN.test(ref.sha256)) {
    throw new Error(`${label} size or sha256 is invalid`);
  }
  return ref;
}

export function validateAppInfoStorefront(storefront) {
  if (!storefront || typeof storefront !== 'object' || Array.isArray(storefront)) throw new Error('App info storefront must be an object');
  for (const key of Object.keys(storefront)) {
    if (!['category', 'default_locale', 'locales', 'media'].includes(key)) throw new Error(`App info storefront contains unsupported field: ${key}`);
  }
  if (!STOREFRONT_CATEGORIES.includes(storefront.category)) throw new Error(`App info storefront category is unsupported: ${storefront.category}`);
  const defaultLocale = validLocale(storefront.default_locale, 'storefront.default_locale');
  if (storefront.locales !== undefined) {
    if (!storefront.locales || typeof storefront.locales !== 'object' || Array.isArray(storefront.locales)) throw new Error('App info storefront.locales must be an object');
    const entries = Object.entries(storefront.locales);
    if (entries.length > 16) throw new Error('App info storefront.locales exceeds 16 locales');
    for (const [locale, entry] of entries) {
      validLocale(locale, 'storefront.locales key');
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`storefront.locales.${locale} must be an object`);
      for (const key of Object.keys(entry)) {
        if (!['display_name', 'summary', 'tags', 'highlights', 'introduction_markdown'].includes(key)) {
          throw new Error(`storefront.locales.${locale} contains unsupported field: ${key}`);
        }
      }
      if (locale === defaultLocale) {
        if (entry.display_name !== undefined || entry.summary !== undefined || entry.introduction_markdown !== undefined) {
          throw new Error(`storefront.locales.${locale} must not duplicate top-level display_name, summary or NIMI_APP.md`);
        }
      } else {
        if (entry.display_name !== undefined) text(entry.display_name, `storefront.locales.${locale}.display_name`, 120);
        if (entry.summary !== undefined) text(entry.summary, `storefront.locales.${locale}.summary`, 280);
        if (entry.introduction_markdown !== undefined) text(entry.introduction_markdown, `storefront.locales.${locale}.introduction_markdown`, 96 * 1024, true);
      }
      if (entry.tags !== undefined) {
        if (!Array.isArray(entry.tags) || entry.tags.length > 5 || new Set(entry.tags).size !== entry.tags.length) {
          throw new Error(`storefront.locales.${locale}.tags must contain at most 5 unique tags`);
        }
        for (const tag of entry.tags) text(tag, `storefront.locales.${locale}.tags`, 32);
      }
      if (entry.highlights !== undefined) {
        if (!Array.isArray(entry.highlights) || entry.highlights.length > 4) {
          throw new Error(`storefront.locales.${locale}.highlights must contain at most 4 items`);
        }
        for (const item of entry.highlights) {
          if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`storefront.locales.${locale}.highlights item must be an object`);
          for (const key of Object.keys(item)) {
            if (!['title', 'description'].includes(key)) throw new Error(`storefront highlight contains unsupported field: ${key}`);
          }
          text(item.title, `storefront.locales.${locale}.highlights.title`, 60);
          text(item.description, `storefront.locales.${locale}.highlights.description`, 200);
        }
      }
    }
  }
  if (storefront.media !== undefined) {
    const media = storefront.media;
    if (!media || typeof media !== 'object' || Array.isArray(media)) throw new Error('App info storefront.media must be an object');
    for (const key of Object.keys(media)) {
      if (!['cover', 'gallery'].includes(key)) throw new Error(`App info storefront.media contains unsupported field: ${key}`);
    }
    if (media.cover === undefined && (!Array.isArray(media.gallery) || media.gallery.length === 0)) {
      throw new Error('App info storefront.media must declare cover or gallery');
    }
    if (media.cover !== undefined) {
      if (!media.cover || typeof media.cover !== 'object' || Array.isArray(media.cover)) throw new Error('storefront.media.cover must be an object');
      for (const key of Object.keys(media.cover)) {
        if (!['default', 'locales'].includes(key)) throw new Error(`storefront.media.cover contains unsupported field: ${key}`);
      }
      validateImageRef(media.cover.default, STOREFRONT_COVER_BOUNDS, 'storefront.media.cover.default');
      if (media.cover.locales !== undefined) {
        if (!media.cover.locales || typeof media.cover.locales !== 'object' || Array.isArray(media.cover.locales)) {
          throw new Error('storefront.media.cover.locales must be an object');
        }
        const entries = Object.entries(media.cover.locales);
        if (entries.length > 15) throw new Error('storefront.media.cover.locales exceeds 15 locales');
        for (const [locale, ref] of entries) {
          validLocale(locale, 'storefront.media.cover.locales key');
          if (locale === defaultLocale) throw new Error('storefront.media.cover.locales must not duplicate default_locale');
          validateImageRef(ref, STOREFRONT_COVER_BOUNDS, `storefront.media.cover.locales.${locale}`);
        }
      }
    }
    if (media.gallery !== undefined) {
      if (!Array.isArray(media.gallery) || media.gallery.length > 6) throw new Error('storefront.media.gallery must contain at most 6 items');
      const seenIds = new Set();
      for (const item of media.gallery) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('storefront.media.gallery item must be an object');
        for (const key of Object.keys(item)) {
          if (!['id', 'kind', 'default', 'locales', 'caption'].includes(key)) throw new Error(`storefront gallery item contains unsupported field: ${key}`);
        }
        if (typeof item.id !== 'string' || !STOREFRONT_GALLERY_ID_PATTERN.test(item.id) || seenIds.has(item.id)) {
          throw new Error(`storefront gallery id is invalid or duplicated: ${item.id}`);
        }
        seenIds.add(item.id);
        if (item.kind !== 'image') throw new Error(`storefront gallery item ${item.id} kind must be image`);
        validateImageRef(item.default, STOREFRONT_GALLERY_BOUNDS, `storefront.media.gallery.${item.id}.default`);
        if (item.locales !== undefined) {
          if (!item.locales || typeof item.locales !== 'object' || Array.isArray(item.locales)) {
            throw new Error(`storefront.media.gallery.${item.id}.locales must be an object`);
          }
          const entries = Object.entries(item.locales);
          if (entries.length > 15) throw new Error(`storefront.media.gallery.${item.id}.locales exceeds 15 locales`);
          for (const [locale, ref] of entries) {
            validLocale(locale, `storefront.media.gallery.${item.id}.locales key`);
            if (locale === defaultLocale) throw new Error(`storefront.media.gallery.${item.id}.locales must not duplicate default_locale`);
            validateImageRef(ref, STOREFRONT_GALLERY_BOUNDS, `storefront.media.gallery.${item.id}.locales.${locale}`);
          }
        }
        if (item.caption !== undefined) {
          if (!item.caption || typeof item.caption !== 'object' || Array.isArray(item.caption)) {
            throw new Error(`storefront.media.gallery.${item.id}.caption must be an object`);
          }
          const entries = Object.entries(item.caption);
          if (entries.length > 16) throw new Error(`storefront.media.gallery.${item.id}.caption exceeds 16 locales`);
          for (const [locale, captionText] of entries) {
            validLocale(locale, `storefront.media.gallery.${item.id}.caption key`);
            text(captionText, `storefront.media.gallery.${item.id}.caption.${locale}`, 200);
          }
        }
      }
    }
  }
  return storefront;
}

export function readAppStorefront(root, manifest) {
  const raw = manifest?.metadata?.storefront;
  if (raw === undefined) return { storefront: undefined, mediaEntries: new Map() };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('metadata.storefront must be an object');
  for (const key of Object.keys(raw)) {
    if (!['category', 'default_locale', 'locales', 'media'].includes(key)) {
      throw new Error(`metadata.storefront contains unsupported field: ${key}`);
    }
  }
  const category = raw.category;
  const defaultLocale = validLocale(raw.default_locale, 'metadata.storefront.default_locale');
  const storefront = { category, default_locale: defaultLocale };
  const readUtf8 = (relative, label, max) => new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(resource(root, relative, label, max));

  if (raw.locales !== undefined) {
    if (!raw.locales || typeof raw.locales !== 'object' || Array.isArray(raw.locales)) throw new Error('metadata.storefront.locales must be an object');
    const localesOut = {};
    for (const locale of Object.keys(raw.locales).sort()) {
      validLocale(locale, 'metadata.storefront.locales key');
      const entry = raw.locales[locale];
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`metadata.storefront.locales.${locale} must be an object`);
      for (const key of Object.keys(entry)) {
        if (!['display_name', 'summary', 'tags', 'highlights', 'introduction'].includes(key)) {
          throw new Error(`metadata.storefront.locales.${locale} contains unsupported field: ${key}`);
        }
      }
      const next = {};
      if (locale === defaultLocale) {
        if (entry.display_name !== undefined || entry.summary !== undefined || entry.introduction !== undefined) {
          throw new Error(`metadata.storefront.locales.${locale} must not specify display_name, summary or introduction (use top-level metadata and NIMI_APP.md)`);
        }
      } else {
        if (entry.display_name !== undefined) next.display_name = entry.display_name;
        if (entry.summary !== undefined) next.summary = entry.summary;
        if (entry.introduction !== undefined) {
          next.introduction_markdown = readUtf8(entry.introduction, `storefront.locales.${locale}.introduction`, 96 * 1024);
        }
      }
      if (entry.tags !== undefined) next.tags = entry.tags;
      if (entry.highlights !== undefined) {
        if (!Array.isArray(entry.highlights)) throw new Error(`metadata.storefront.locales.${locale}.highlights must be a list`);
        next.highlights = entry.highlights.map((item) => {
          if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`metadata.storefront.locales.${locale}.highlights item must be an object`);
          for (const key of Object.keys(item)) {
            if (!['title', 'description'].includes(key)) throw new Error(`metadata.storefront highlight contains unsupported field: ${key}`);
          }
          return { title: item.title, description: item.description };
        });
      }
      localesOut[locale] = next;
    }
    if (Object.keys(localesOut).length > 0) storefront.locales = localesOut;
  }

  const mediaEntries = new Map();
  const readImage = (relative, bounds, label) => {
    const bytes = resource(root, relative, label, STOREFRONT_IMAGE_MAX_BYTES);
    const ref = inspectStaticStorefrontImage(bytes, bounds, label);
    const archiveName = `${ref.sha256}.${storefrontMediaExtension(ref.media_type)}`;
    if (!mediaEntries.has(archiveName)) mediaEntries.set(archiveName, bytes);
    return ref;
  };

  if (raw.media !== undefined) {
    const rawMedia = raw.media;
    if (!rawMedia || typeof rawMedia !== 'object' || Array.isArray(rawMedia)) throw new Error('metadata.storefront.media must be an object');
    for (const key of Object.keys(rawMedia)) {
      if (!['cover', 'gallery'].includes(key)) throw new Error(`metadata.storefront.media contains unsupported field: ${key}`);
    }
    const mediaOut = {};
    if (rawMedia.cover !== undefined) {
      const rawCover = rawMedia.cover;
      if (!rawCover || typeof rawCover !== 'object' || Array.isArray(rawCover)) throw new Error('metadata.storefront.media.cover must be an object');
      for (const key of Object.keys(rawCover)) {
        if (!['path', 'locales'].includes(key)) throw new Error(`metadata.storefront.media.cover contains unsupported field: ${key}`);
      }
      const coverOut = { default: readImage(rawCover.path, STOREFRONT_COVER_BOUNDS, 'storefront.media.cover.path') };
      if (rawCover.locales !== undefined) {
        if (!rawCover.locales || typeof rawCover.locales !== 'object' || Array.isArray(rawCover.locales)) {
          throw new Error('metadata.storefront.media.cover.locales must be an object');
        }
        const coverLocales = {};
        for (const locale of Object.keys(rawCover.locales).sort()) {
          validLocale(locale, 'metadata.storefront.media.cover.locales key');
          if (locale === defaultLocale) throw new Error('metadata.storefront.media.cover.locales must not duplicate default_locale');
          coverLocales[locale] = readImage(rawCover.locales[locale], STOREFRONT_COVER_BOUNDS, `storefront.media.cover.locales.${locale}`);
        }
        if (Object.keys(coverLocales).length > 0) coverOut.locales = coverLocales;
      }
      mediaOut.cover = coverOut;
    }
    if (rawMedia.gallery !== undefined) {
      if (!Array.isArray(rawMedia.gallery)) throw new Error('metadata.storefront.media.gallery must be a list');
      mediaOut.gallery = rawMedia.gallery.map((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('metadata.storefront.media.gallery item must be an object');
        for (const key of Object.keys(item)) {
          if (!['id', 'kind', 'path', 'locales', 'caption'].includes(key)) throw new Error(`metadata.storefront gallery item contains unsupported field: ${key}`);
        }
        if (item.kind !== 'image') throw new Error(`metadata.storefront gallery item ${item.id} kind must be image`);
        const galleryItem = {
          id: item.id,
          kind: 'image',
          default: readImage(item.path, STOREFRONT_GALLERY_BOUNDS, `storefront.media.gallery.${item.id}.path`),
        };
        if (item.locales !== undefined) {
          if (!item.locales || typeof item.locales !== 'object' || Array.isArray(item.locales)) {
            throw new Error(`metadata.storefront.media.gallery.${item.id}.locales must be an object`);
          }
          const itemLocales = {};
          for (const locale of Object.keys(item.locales).sort()) {
            validLocale(locale, `metadata.storefront.media.gallery.${item.id}.locales key`);
            if (locale === defaultLocale) throw new Error(`metadata.storefront.media.gallery.${item.id}.locales must not duplicate default_locale`);
            itemLocales[locale] = readImage(item.locales[locale], STOREFRONT_GALLERY_BOUNDS, `storefront.media.gallery.${item.id}.locales.${locale}`);
          }
          if (Object.keys(itemLocales).length > 0) galleryItem.locales = itemLocales;
        }
        if (item.caption !== undefined) {
          if (!item.caption || typeof item.caption !== 'object' || Array.isArray(item.caption)) {
            throw new Error(`metadata.storefront.media.gallery.${item.id}.caption must be an object`);
          }
          const captions = {};
          for (const locale of Object.keys(item.caption).sort()) captions[locale] = item.caption[locale];
          if (Object.keys(captions).length > 0) galleryItem.caption = captions;
        }
        return galleryItem;
      });
    }
    storefront.media = mediaOut;
  }

  validateAppInfoStorefront(storefront);
  return { storefront, mediaEntries };
}

function resource(root, relative, label, maxBytes) {
  if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.includes('\\')
    || relative.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error(`metadata.${label} must name an App-relative resource`);
  const file = path.join(root, relative);
  const field = label === 'license' ? 'App license' : label === 'introduction' ? APP_INTRODUCTION_FILE : `metadata.${label}`;
  try {
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0 || stat.size > maxBytes) throw new Error(`must be a nonempty regular file of at most ${maxBytes} bytes`);
    return readFileSync(file);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') throw new Error(`${field} resource is missing: ${relative}`);
    throw new Error(`${field} resource ${relative}: ${error.message}`, { cause: error });
  }
}

export function readAppIntroduction(root, manifest) {
  if (manifest?.metadata && Object.hasOwn(manifest.metadata, 'readme')) {
    throw new Error('metadata.readme is not supported; put the user introduction in root NIMI_APP.md and remove metadata.readme');
  }
  let content;
  try {
    content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(resource(root, APP_INTRODUCTION_FILE, 'introduction', 96 * 1024));
  } catch (error) {
    throw new Error(`Invalid ${APP_INTRODUCTION_FILE}: ${error.message}`, { cause: error });
  }
  return text(content, APP_INTRODUCTION_FILE, 96 * 1024, true);
}

export function readAppInfo(root, targetId) {
  const manifest = parseYaml(readFileSync(path.join(root, 'nimi.app.yaml'), 'utf8'));
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (manifest.version !== pkg.version) throw new Error('package.json and nimi.app.yaml versions must be exact and lockstep before distribution');
  const metadata = manifest.metadata;
  if (!metadata || typeof metadata !== 'object') throw new Error('nimi.app.yaml metadata is required for distribution (summary, icon)');
  const readText = (relative, label, max) => new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(resource(root, relative, label, max));
  const { storefront } = readAppStorefront(root, manifest);
  const info = validateAppInfo({
    format: 'nimi.app-info/v1', app_id: manifest.app_id, version: manifest.version, target_id: targetId,
    display_name: manifest.display_name, summary: metadata.summary,
    icon: { media_type: 'image/png', data_base64: readAppIcon(root).toString('base64') },
    readme_markdown: readAppIntroduction(root, manifest),
    release_notes_markdown: metadata.release_notes === undefined ? '' : readText(metadata.release_notes, 'release_notes', 32 * 1024),
    license: { identifier: pkg.license, text: readText('LICENSE', 'license', 128 * 1024) },
    app_access: refs(manifest.app_access, 'app_access'),
    capability_contract_refs: refs(manifest.capability_contract_refs, 'capability_contract_refs'),
    required_standardized_feature_refs: refs(manifest.required_standardized_feature_refs, 'required_standardized_feature_refs'),
    storage_policy: storage(manifest.storage_policy),
    author: metadata.author || '', homepage_url: https(metadata.homepage_url, 'homepage_url'), support_url: https(metadata.support_url, 'support_url'),
    ...(manifest[SAFETY_PROFILE_FIELD] === undefined ? {} : { [SAFETY_PROFILE_FIELD]: normalizeSafetyProfile(manifest[SAFETY_PROFILE_FIELD]) }),
    ...(storefront === undefined ? {} : { storefront }),
  });
  const submissionPath = path.join(root, '.nimi/admission/submission.yaml');
  if (existsSync(submissionPath)) {
    const submission = parseYaml(readFileSync(submissionPath, 'utf8'));
    for (const field of ['app_id', 'version', 'display_name', 'capability_contract_refs', 'required_standardized_feature_refs', SAFETY_PROFILE_FIELD]) {
      if (JSON.stringify(info[field]) !== JSON.stringify(submission[field])) throw new Error(`App info differs from submission ${field}; run nimi-app sync to project the declaration`);
    }
    if (JSON.stringify(storage(submission.storage_policy)) !== JSON.stringify(info.storage_policy)) throw new Error('App info differs from submission storage_policy; run nimi-app sync to project the declaration');
  }
  return info;
}
