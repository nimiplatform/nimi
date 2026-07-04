import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function findLive2dModelEntries(sourcePath: string): Promise<string[]> {
  const entries = await collectLive2dModelEntries(sourcePath, []);
  return entries.sort();
}

async function collectLive2dModelEntries(currentPath: string, entries: string[]): Promise<string[]> {
  let dirEntries: Dirent[];
  try {
    dirEntries = await fs.readdir(currentPath, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return entries;
    }
    throw error;
  }
  for (const entry of dirEntries) {
    const entryPath = path.join(currentPath, entry.name);
    if (entry.isDirectory()) {
      await collectLive2dModelEntries(entryPath, entries);
    } else if (entry.isFile() && entry.name.endsWith('.model3.json')) {
      entries.push(entryPath);
    }
  }
  return entries;
}
