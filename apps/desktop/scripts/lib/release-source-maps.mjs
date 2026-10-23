import { constants } from 'node:fs';
import { copyFile, cp, mkdir, rename, stat } from 'node:fs/promises';
import path from 'node:path';

// Restrict this to compiler source maps; an unrelated runtime data file named
// *.map is not a source map and must remain in the product.
export function isCompilerSourceMap(file) {
  return /\.(?:[cm]?[jt]s|css)\.map$/iu.test(file);
}

export async function stageReleaseTree(source, destination, debugDestination, { dereference = false } = {}) {
  await cp(source, destination, {
    recursive: true,
    force: false,
    dereference,
    filter: async (candidate) => {
      if (!isCompilerSourceMap(candidate) || !(await stat(candidate)).isFile()) return true;
      const debugFile = path.join(debugDestination, path.relative(source, candidate));
      await mkdir(path.dirname(debugFile), { recursive: true });
      await copyFile(candidate, debugFile, constants.COPYFILE_EXCL);
      return false;
    },
  });
}

export function assertNoCompilerSourceMaps(entries) {
  const unexpected = entries.filter(isCompilerSourceMap);
  if (unexpected.length) throw new Error(`Terminal payload contains compiler source maps: ${unexpected.join(', ')}`);
}

export function assertReleaseDebugSeparation(outputRoot, debugRoot) {
  // Use a conservative case-insensitive comparison on these desktop targets.
  const output = path.resolve(outputRoot).toLowerCase();
  const debug = path.resolve(debugRoot).toLowerCase();
  const inside = (parent, child) => {
    const relative = path.relative(parent, child);
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
  };
  if (inside(output, debug) || inside(debug, output)) {
    throw new Error('Release output and private source-map directories must be disjoint');
  }
}

// This directory is outside every staged app and published release output.
// The transaction suffix separates dirty/local builds of the same Git revision.
export async function preserveReleaseSourceMaps({ transactionRoot, localRoot, sourceRevision, target }) {
  if (!/^[a-f0-9]{40,64}$/u.test(sourceRevision) || !/^[a-z0-9-]+$/u.test(target)) {
    throw new Error('Source-map build identity is invalid');
  }
  const source = path.join(transactionRoot, 'source-maps');
  await mkdir(source, { recursive: true });
  const parent = path.join(localRoot, 'debug-symbols');
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const destination = path.join(parent, `${target}-${sourceRevision}-${path.basename(transactionRoot)}`);
  await rename(source, destination);
  return destination;
}
