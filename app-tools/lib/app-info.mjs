// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-042a
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { parse as parseYaml } from 'yaml';
import { normalizeAppAccessItems } from './app-access-declaration.mjs';

export const APP_INFO_MAX_BYTES = 1024 * 1024;
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');

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
  return value.map((item) => text(item, label, 200));
}

export function validateAppIcon(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > 512 * 1024 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('App icon must be a PNG of at most 512 KiB');
  }
  let offset = 8;
  let ended = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (offset + length + 12 > bytes.length || type === 'acTL') throw new Error('App icon must be a complete static PNG');
    if (offset === 8 && (type !== 'IHDR' || length !== 13)) throw new Error('App icon PNG header is invalid');
    if (type === 'IHDR') {
      const width = bytes.readUInt32BE(offset + 8);
      const height = bytes.readUInt32BE(offset + 12);
      if (width < 128 || width > 1024 || width !== height) throw new Error('App icon must be square, 128–1024 pixels');
    }
    offset += length + 12;
    if (type === 'IEND') { ended = length === 0 && offset === bytes.length; break; }
  }
  if (!ended) throw new Error('App icon PNG is truncated or has trailing content');
  const decoded = PNG.sync.read(bytes, { checkCRC: true });
  for (let index = 3; index < decoded.data.length; index += 4) {
    if (decoded.data[index] !== 0) return bytes;
  }
  throw new Error('App icon is fully transparent; supply actual App artwork');
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

export function validateAppInfo(info) {
  if (!info || info.format !== 'nimi.app-info/v1') throw new Error('Unsupported App info format');
  for (const key of ['app_id', 'version', 'target_id']) text(info[key], key, 200);
  text(info.display_name, 'display_name', 120);
  text(info.summary, 'summary', 280);
  if (info.icon?.media_type !== 'image/png' || typeof info.icon.data_base64 !== 'string') throw new Error('App info icon must declare PNG bytes');
  const icon = Buffer.from(info.icon.data_base64, 'base64');
  if (icon.toString('base64') !== info.icon.data_base64) throw new Error('App icon base64 is not canonical');
  validateAppIcon(icon);
  if (info.readme_markdown !== undefined && info.readme_markdown !== '') text(info.readme_markdown, 'readme', 96 * 1024, true);
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
  if (Buffer.byteLength(JSON.stringify(info)) > APP_INFO_MAX_BYTES) throw new Error('App info exceeds 1 MiB');
  return info;
}

function resource(root, relative, label, maxBytes) {
  if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.includes('\\')
    || relative.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error(`metadata.${label} must name an App-relative resource`);
  const file = path.join(root, relative);
  const field = label === 'license' ? 'App license' : `metadata.${label}`;
  try {
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0 || stat.size > maxBytes) throw new Error(`must be a nonempty regular file of at most ${maxBytes} bytes`);
    return readFileSync(file);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') throw new Error(`${field} resource is missing: ${relative}`);
    throw new Error(`${field} resource ${relative}: ${error.message}`, { cause: error });
  }
}

export function readAppInfo(root, targetId) {
  const manifest = parseYaml(readFileSync(path.join(root, 'nimi.app.yaml'), 'utf8'));
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (manifest.version !== pkg.version) throw new Error('package.json and nimi.app.yaml versions must be exact and lockstep before distribution');
  const metadata = manifest.metadata;
  if (!metadata || typeof metadata !== 'object') throw new Error('nimi.app.yaml metadata is required for distribution (summary, icon)');
  const readText = (relative, label, max) => new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(resource(root, relative, label, max));
  const info = validateAppInfo({
    format: 'nimi.app-info/v1', app_id: manifest.app_id, version: manifest.version, target_id: targetId,
    display_name: manifest.display_name, summary: metadata.summary,
    icon: { media_type: 'image/png', data_base64: validateAppIcon(resource(root, metadata.icon, 'icon', 512 * 1024)).toString('base64') },
    readme_markdown: metadata.readme === undefined ? '' : readText(metadata.readme, 'readme', 96 * 1024),
    release_notes_markdown: metadata.release_notes === undefined ? '' : readText(metadata.release_notes, 'release_notes', 32 * 1024),
    license: { identifier: pkg.license, text: readText('LICENSE', 'license', 128 * 1024) },
    app_access: refs(manifest.app_access, 'app_access'),
    capability_contract_refs: refs(manifest.capability_contract_refs, 'capability_contract_refs'),
    required_standardized_feature_refs: refs(manifest.required_standardized_feature_refs, 'required_standardized_feature_refs'),
    storage_policy: storage(manifest.storage_policy),
    author: metadata.author || '', homepage_url: https(metadata.homepage_url, 'homepage_url'), support_url: https(metadata.support_url, 'support_url'),
  });
  const submissionPath = path.join(root, '.nimi/admission/submission.yaml');
  if (existsSync(submissionPath)) {
    const submission = parseYaml(readFileSync(submissionPath, 'utf8'));
    for (const field of ['app_id', 'version', 'display_name', 'capability_contract_refs', 'required_standardized_feature_refs']) {
      if (JSON.stringify(info[field]) !== JSON.stringify(submission[field])) throw new Error(`App info differs from submission ${field}; run nimi-app sync to project the declaration`);
    }
    if (JSON.stringify(storage(submission.storage_policy)) !== JSON.stringify(info.storage_policy)) throw new Error('App info differs from submission storage_policy; run nimi-app sync to project the declaration');
  }
  return info;
}
