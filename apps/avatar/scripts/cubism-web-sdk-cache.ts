import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const avatarRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CUBISM_WEB_SDK_VERSION = '5-r.5';
const CUBISM_WEB_SDK_URL = `https://cubism.live2d.com/sdk-web/bin/CubismSdkForWeb-${CUBISM_WEB_SDK_VERSION}.zip`;

export const CUBISM_WEB_SDK_CACHE_ROOT = path.join(
  avatarRoot,
  '.cache',
  'assets',
  'js',
  `CubismSdkForWeb-${CUBISM_WEB_SDK_VERSION}`,
);

export const CUBISM_WEB_FRAMEWORK_CACHE_ROOT = path.join(
  CUBISM_WEB_SDK_CACHE_ROOT,
  'Framework',
  'src',
);

const desktopCubismWebSdkCacheRoot = path.resolve(
  avatarRoot,
  '..',
  'desktop',
  '.cache',
  'assets',
  'js',
  `CubismSdkForWeb-${CUBISM_WEB_SDK_VERSION}`,
);

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

function extractZipArchive(zipPath: string, destinationDir: string): void {
  if (process.platform === 'win32') {
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '& { param($ZipPath, $DestinationPath) Expand-Archive -LiteralPath $ZipPath -DestinationPath $DestinationPath -Force }',
        zipPath,
        destinationDir,
      ],
      { stdio: 'ignore' },
    );
    return;
  }
  execFileSync('unzip', ['-o', zipPath, '-d', destinationDir], { stdio: 'ignore' });
}

export async function ensureCubismFrameworkCache(): Promise<void> {
  const cacheZipPath = path.join(
    CUBISM_WEB_SDK_CACHE_ROOT,
    `CubismSdkForWeb-${CUBISM_WEB_SDK_VERSION}.zip`,
  );
  const desktopCacheZipPath = path.join(
    desktopCubismWebSdkCacheRoot,
    `CubismSdkForWeb-${CUBISM_WEB_SDK_VERSION}.zip`,
  );
  const frameworkIndexPath = path.join(CUBISM_WEB_FRAMEWORK_CACHE_ROOT, 'live2dcubismframework.ts');
  if (await pathExists(frameworkIndexPath)) {
    return;
  }

  await mkdir(CUBISM_WEB_SDK_CACHE_ROOT, { recursive: true });
  if (!await pathExists(cacheZipPath)) {
    if (await pathExists(desktopCacheZipPath)) {
      await copyFile(desktopCacheZipPath, cacheZipPath);
    } else {
      const response = await fetch(CUBISM_WEB_SDK_URL);
      if (!response.ok) {
        throw new Error(
          `Failed to download Cubism SDK from ${CUBISM_WEB_SDK_URL}: ${response.status} ${response.statusText}`,
        );
      }
      await writeFile(cacheZipPath, Buffer.from(await response.arrayBuffer()));
    }
  }
  extractZipArchive(cacheZipPath, path.dirname(CUBISM_WEB_SDK_CACHE_ROOT));

  const sourceCore = path.join(CUBISM_WEB_SDK_CACHE_ROOT, 'Core', 'live2dcubismcore.min.js');
  const publicCore = path.join(
    avatarRoot,
    'src',
    'shell',
    'renderer',
    'public',
    'assets',
    'js',
    'live2d-cubism-core',
    'Core',
    'live2dcubismcore.min.js',
  );
  if (await pathExists(sourceCore) && await pathExists(publicCore)) {
    const [source, current] = await Promise.all([readFile(sourceCore), readFile(publicCore)]);
    if (!source.equals(current)) {
      await copyFile(sourceCore, publicCore);
    }
  }
}
