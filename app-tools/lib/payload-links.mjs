// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-014a
import path from 'node:path';

export const SYMBOLIC_LINK_MODE = 0o120777;

// Electron frameworks contain relative links such as Versions/Current -> A.
// Resolve against the archive tree, never against the publisher's filesystem.
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
  const resolve = (name, visited = new Set()) => {
    const parts = name.split('/');
    for (let length = 1; length <= parts.length; length += 1) {
      const prefix = parts.slice(0, length).join('/');
      const entry = entries.get(prefix);
      if (entry?.mode !== SYMBOLIC_LINK_MODE) continue;
      if (visited.has(prefix)) throw new Error(`Cyclic payload symbolic link: ${prefix}`);
      const target = entry.bytes.toString('utf8');
      if (!target || target.includes('\\') || target.includes('\0') || path.posix.isAbsolute(target)) {
        throw new Error(`Invalid payload symbolic link: ${prefix}`);
      }
      const destination = path.posix.normalize(path.posix.join(path.posix.dirname(prefix), target, ...parts.slice(length)));
      if (!destination.startsWith('payload/')) throw new Error(`Payload symbolic link escapes its root: ${prefix}`);
      return resolve(destination, new Set([...visited, prefix]));
    }
    if (!entries.has(name) && !directories.has(name)) throw new Error(`Missing payload symbolic link destination: ${name}`);
    return name;
  };
  for (const [name, entry] of entries) {
    if (entry.mode !== SYMBOLIC_LINK_MODE) continue;
    if (os !== 'macos' || !name.startsWith('payload/')) throw new Error(`Symbolic link is not admitted for this target: ${name}`);
    resolve(name);
  }
}
