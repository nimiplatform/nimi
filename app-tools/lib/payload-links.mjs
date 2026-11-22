// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-014a
import { isUtf8 } from 'node:buffer';
import path from 'node:path';

export const SYMBOLIC_LINK_MODE = 0o120777;
export const MAX_SYMLINK_HOPS = 32;
export const MAX_SYMLINK_TARGET_BYTES = 4096;

const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

function decodeStrictUtf8Target(bytes, entryName) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > MAX_SYMLINK_TARGET_BYTES || !isUtf8(bytes)) {
    throw new Error(`Invalid payload symbolic link: ${entryName}`);
  }
  try {
    return UTF8_DECODER.decode(bytes);
  } catch {
    throw new Error(`Invalid payload symbolic link: ${entryName}`);
  }
}

// Electron frameworks contain relative links such as Versions/Current -> A.
// Resolve component-by-component against the archive tree (matching XNU
// MAXSYMLINKS = 32), never collapsing `..` before expanding intermediate links.
export function validatePayloadLinks(entries, os) {
  const directories = new Set();
  for (const name of entries.keys()) {
    for (let parent = path.posix.dirname(name); parent !== '.'; parent = path.posix.dirname(parent)) {
      directories.add(parent);
    }
  }
  for (const name of directories) {
    if (entries.has(name)) throw new Error(`nimiapp file/directory collision: ${name}`);
  }

  const resolveComponents = (base, rawTarget, entryName, state, active) => {
    if (!rawTarget || rawTarget.startsWith('/') || rawTarget.includes('\\') || rawTarget.includes('\0')) {
      throw new Error(`Invalid payload symbolic link: ${entryName}`);
    }
    let cur = [...base];
    let trailingDir = rawTarget.endsWith('/');
    const parts = rawTarget.split('/');
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      if (part === '') {
        if (!directories.has(cur.join('/'))) {
          throw new Error(`Payload symbolic link traverses non-directory: ${entryName}`);
        }
        continue;
      }
      if (part === '.') {
        if (!directories.has(cur.join('/'))) {
          throw new Error(`Payload symbolic link traverses non-directory: ${entryName}`);
        }
        if (isLast) trailingDir = true;
        continue;
      }
      if (part === '..') {
        if (!directories.has(cur.join('/'))) {
          throw new Error(`Payload symbolic link traverses non-directory: ${entryName}`);
        }
        if (cur.length <= 1) {
          throw new Error(`Payload symbolic link escapes its root: ${entryName}`);
        }
        cur.pop();
        if (isLast) trailingDir = true;
        continue;
      }
      if (!directories.has(cur.join('/'))) {
        throw new Error(`Payload symbolic link traverses non-directory: ${entryName}`);
      }
      cur.push(part);
      const joined = cur.join('/');
      const nextEntry = entries.get(joined);
      if (nextEntry?.mode === SYMBOLIC_LINK_MODE) {
        if (active.has(joined)) {
          throw new Error(`Cyclic payload symbolic link: ${joined}`);
        }
        state.hops += 1;
        if (state.hops > MAX_SYMLINK_HOPS) {
          throw new Error(`Excessive payload symbolic link hops: ${joined}`);
        }
        active.add(joined);
        const target = decodeStrictUtf8Target(nextEntry.bytes, joined);
        const expanded = resolveComponents(cur.slice(0, -1), target, joined, state, active);
        active.delete(joined);
        cur = expanded.resolved;
        if (isLast && expanded.trailingDir) {
          trailingDir = true;
        }
      }
    }
    return { resolved: cur, trailingDir };
  };

  for (const [name, entry] of entries) {
    if (entry.mode !== SYMBOLIC_LINK_MODE) continue;
    if (os !== 'macos' || !name.startsWith('payload/')) {
      throw new Error(`Symbolic link is not admitted for this target: ${name}`);
    }
    const target = decodeStrictUtf8Target(entry.bytes, name);
    const parentParts = path.posix.dirname(name).split('/');
    const state = { hops: 1 };
    const active = new Set([name]);
    const { resolved, trailingDir } = resolveComponents(parentParts, target, name, state, active);
    if (resolved.length < 2 || resolved[0] !== 'payload') {
      throw new Error(`Payload symbolic link escapes its root: ${name}`);
    }
    const finalPath = resolved.join('/');
    if (trailingDir) {
      if (!directories.has(finalPath)) {
        throw new Error(`Missing payload symbolic link destination: ${finalPath}`);
      }
    } else if (!entries.has(finalPath) && !directories.has(finalPath)) {
      throw new Error(`Missing payload symbolic link destination: ${finalPath}`);
    }
  }
}
