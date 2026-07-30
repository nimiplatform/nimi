import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const kitRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const copiedAssetExtensions = new Set(['.css', '.html']);

const publishedStyleSourceReplacements = [
  ['./components/**/*.{ts,tsx}', './components/**/*.js'],
  ['./lib/**/*.{ts,tsx}', './lib/**/*.js'],
  ['../../auth/src/**/*.{ts,tsx}', '../auth/**/*.js'],
  ['../../features/agent-center/src/**/*.{ts,tsx}', '../features/agent-center/**/*.js'],
  ['../../features/chat/src/**/*.{ts,tsx}', '../features/chat/**/*.js'],
  ['../../features/commerce/src/**/*.{ts,tsx}', '../features/commerce/**/*.js'],
  ['../../features/generation/src/**/*.{ts,tsx}', '../features/generation/**/*.js'],
  ['../../features/model-config/src/**/*.{ts,tsx}', '../features/model-config/**/*.js'],
  ['../../features/model-picker/src/**/*.{ts,tsx}', '../features/model-picker/**/*.js'],
];

function copyDistAsset(source, target, normalizedRelativePath) {
  if (normalizedRelativePath !== 'ui/src/styles.css') {
    copyFileSync(source, target);
    return;
  }

  let contents = readFileSync(source, 'utf8');
  for (const [sourcePath, publishedPath] of publishedStyleSourceReplacements) {
    const sourceDirective = `@source "${sourcePath}";`;
    if (!contents.includes(sourceDirective)) {
      throw new Error(`Missing expected Kit style source directive: ${sourceDirective}`);
    }
    contents = contents.replace(sourceDirective, `@source "${publishedPath}";`);
  }

  const unpublishedSourceDirectives = (
    contents.match(/@source\b[^;]*;/g) ?? []
  ).filter(
    (directive) =>
      directive.includes('src/') || directive.includes('{ts,tsx}'),
  );
  if (unpublishedSourceDirectives.length > 0) {
    throw new Error(
      `Unrewritten Kit style source directive(s): ${unpublishedSourceDirectives.join(', ')}`,
    );
  }

  writeFileSync(target, contents);
}

function collectDistAssetFiles(relativeDir, files = []) {
  const absoluteDir = path.join(kitRoot, relativeDir);
  for (const entry of readdirSync(absoluteDir, { withFileTypes: true })) {
    const relativePath = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      collectDistAssetFiles(relativePath, files);
    } else if (entry.isFile() && copiedAssetExtensions.has(path.extname(entry.name))) {
      files.push(relativePath);
    }
  }
  return files;
}

for (const relativePath of [
  ...collectDistAssetFiles('auth/src'),
  ...collectDistAssetFiles('ui/src'),
]) {
  const source = path.join(kitRoot, relativePath);
  // Strip the `/src/` segment to match normalize-dist-layout's flattening and the
  // package `exports` map (e.g. ./dist/ui/styles.css). Separator-agnostic: on
  // Windows path.join yields backslashes, so a literal '/src/' replace would no-op
  // and leak assets to dist/ui/src/.
  const normalizedRelativePath = relativePath.split(path.sep).join('/');
  const flattened = normalizedRelativePath.replace('/src/', '/');
  const target = path.join(kitRoot, 'dist', flattened);
  mkdirSync(path.dirname(target), { recursive: true });
  copyDistAsset(source, target, normalizedRelativePath);
}
