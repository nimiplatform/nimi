import { lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';

export const MACOS_LOCAL_APP_HOST_EXECUTABLE = '/Applications/Nimi.app/Contents/Frameworks/Nimi Local App Host.app/Contents/MacOS/Nimi Local App Host';

export function resolveMacOSLocalAppHostLaunch(input) {
  const argv = Array.isArray(input?.argv) ? input.argv.map(exactText) : fail();
  if (argv.length !== 4) fail();
  const executable = canonicalFile(exactAbsolute(input?.executable));
  const expectedExecutable = input?.contractTestExpectedExecutable === undefined
    ? MACOS_LOCAL_APP_HOST_EXECUTABLE
    : canonicalFile(exactAbsolute(input.contractTestExpectedExecutable));
  if (executable !== expectedExecutable || argv[0] !== executable) fail();
  const workingDirectory = canonicalDirectory(exactAbsolute(input?.workingDirectory));
  const homeDirectory = canonicalDirectory(exactAbsolute(input?.homeDirectory));
  const userDataArgument = exactArgument(argv, '--user-data-dir');
  const mainArgument = exactArgument(argv, '--nimi-local-app-main');
  const rendererArgument = exactArgument(argv, '--nimi-dev-renderer-url');
  if (argv.some(isForbiddenChromiumArgument)) fail();

  const userDataDirectory = canonicalPrivateUserDataDirectory(userDataArgument, homeDirectory, input?.uid);
  const expectedMain = path.join(workingDirectory, 'dist-electron', 'main.js');
  const mainEntry = canonicalFile(exactAbsolute(mainArgument));
  if (mainEntry !== expectedMain) fail();
  const rendererOrigin = exactLoopbackOrigin(rendererArgument);
  return Object.freeze({
    mainEntry,
    rendererOrigin,
    userDataDirectory,
    workingDirectory,
  });
}

function canonicalPrivateUserDataDirectory(candidate, homeDirectory, rawUID) {
  const uid = rawUID ?? process.getuid?.();
  if (!Number.isSafeInteger(uid) || Number(uid) < 0) fail();
  const canonical = canonicalDirectory(exactAbsolute(candidate));
  const expectedRoot = path.join(homeDirectory, 'Library', 'Application Support', 'Nimi', 'Local App Hosts', 'v1');
  const relative = path.relative(expectedRoot, canonical);
  if (!/^[a-f0-9]{64}$/u.test(relative) || path.isAbsolute(relative)) fail();
  const homeMetadata = lstatSync(homeDirectory);
  if (homeMetadata.uid !== Number(uid) || (homeMetadata.mode & 0o022) !== 0) fail();
  let current = homeDirectory;
  for (const component of ['Library', 'Application Support', 'Nimi', 'Local App Hosts', 'v1', relative]) {
    current = path.join(current, component);
    const metadata = lstatSync(current);
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== Number(uid)
      || (metadata.mode & 0o077) !== 0 || realpathSync(current) !== current) fail();
  }
  return canonical;
}

function exactArgument(argv, name) {
  const prefix = `${name}=`;
  const matches = argv.filter((argument) => argument.startsWith(prefix));
  if (matches.length !== 1) fail();
  return exactText(matches[0].slice(prefix.length));
}

function exactLoopbackOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail();
  }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || !url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash
    || url.origin !== value) fail();
  return url.origin;
}

function isForbiddenChromiumArgument(value) {
  return [
    '--disable-sandbox',
    '--disable-setuid-sandbox',
    '--disable-site-isolation-trials',
    '--disable-web-security',
    '--inspect',
    '--js-flags',
    '--no-sandbox',
    '--remote-allow-origins',
    '--remote-debugging',
  ].some((prefix) => value === prefix || value.startsWith(`${prefix}=`));
}

function canonicalDirectory(value) {
  const canonical = realpathSync(value);
  const metadata = lstatSync(canonical);
  if (canonical !== value || !metadata.isDirectory() || metadata.isSymbolicLink()) fail();
  return canonical;
}

function canonicalFile(value) {
  const canonical = realpathSync(value);
  const metadata = lstatSync(canonical);
  if (canonical !== value || !metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) fail();
  return canonical;
}

function exactAbsolute(value) {
  const text = exactText(value);
  if (!path.isAbsolute(text) || path.normalize(text) !== text) fail();
  return text;
}

function exactText(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 8192
    || value.trim() !== value || value.includes('\0')) fail();
  return value;
}

function fail() {
  throw new Error('local-app-host-launch-untrusted');
}
