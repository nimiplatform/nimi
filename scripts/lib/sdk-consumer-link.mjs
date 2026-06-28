import { symlinkSync } from 'node:fs';
import path from 'node:path';

export function workspacePackageLinkType(platform = process.platform) {
  return platform === 'win32' ? 'junction' : 'dir';
}

export function linkWorkspacePackage(sourceRoot, targetPath, options = {}) {
  const platform = options.platform ?? process.platform;
  symlinkSync(path.resolve(sourceRoot), targetPath, workspacePackageLinkType(platform));
}
