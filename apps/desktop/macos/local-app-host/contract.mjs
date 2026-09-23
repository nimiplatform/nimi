import { lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';

export const MACOS_LOCAL_APP_HOST_EXECUTABLE = '/Applications/Nimi.app/Contents/Frameworks/Nimi Local App Host.app/Contents/MacOS/Nimi Local App Host';

export function resolveMacOSLocalAppHostLaunch(input) {
  const argv = Array.isArray(input?.argv) ? input.argv.map(exactText) : fail();
  const cdpPort = optionalCdpPort(argv);
  if (argv.length !== (cdpPort === undefined ? 4 : 6)) fail();
  const executable = canonicalFile(exactAbsolute(input?.executable));
  const expectedExecutable = input?.contractTestExpectedExecutable === undefined
    ? MACOS_LOCAL_APP_HOST_EXECUTABLE
    : canonicalFile(exactAbsolute(input.contractTestExpectedExecutable));
  if (executable !== expectedExecutable || argv[0] !== executable) fail();
  const workingDirectory = canonicalDirectory(exactAbsolute(input?.workingDirectory));
  const hostProfileDirectory = exactAbsolute(input?.hostProfileDirectory);
  const userDataArgument = exactArgument(argv, '--user-data-dir');
  const mainArgument = exactArgument(argv, '--nimi-local-app-main');
  const rendererArgument = exactArgument(argv, '--nimi-dev-renderer-url');
  if (argv.some(isForbiddenChromiumArgument)) fail();

  const userDataDirectory = canonicalHostProfileUserDataDirectory(userDataArgument, hostProfileDirectory, input?.uid);
  const expectedMain = path.join(workingDirectory, 'dist-electron', 'main.js');
  const mainEntry = canonicalFile(exactAbsolute(mainArgument));
  if (mainEntry !== expectedMain) fail();
  const rendererOrigin = exactLoopbackOrigin(rendererArgument);
  return Object.freeze({
    mainEntry,
    rendererOrigin,
    userDataDirectory,
    workingDirectory,
    ...(cdpPort === undefined ? {} : { cdpPort }),
  });
}

function optionalCdpPort(argv) {
  const addressArguments = argv.filter((argument) => argument.startsWith('--remote-debugging-address='));
  const portArguments = argv.filter((argument) => argument.startsWith('--remote-debugging-port='));
  if (addressArguments.length === 0 && portArguments.length === 0) return undefined;
  if (addressArguments.length !== 1 || addressArguments[0] !== '--remote-debugging-address=127.0.0.1'
    || portArguments.length !== 1) fail();
  const value = portArguments[0].slice('--remote-debugging-port='.length);
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) fail();
  const port = Number(value);
  if (!Number.isSafeInteger(port) || (port !== 0 && (port < 1024 || port > 65535))) fail();
  return port;
}

// The Host profile is the Runtime-derived `<data root>/app-hosts/<scope>/apps/
// <subject>` prepared by the native carrier and passed only to this child as
// NIMI_APP_HOST_PROFILE_DIR; the user data argument must be its user-data.
function canonicalHostProfileUserDataDirectory(candidate, hostProfileDirectory, rawUID) {
  const uid = rawUID ?? process.getuid?.();
  if (!Number.isSafeInteger(uid) || Number(uid) < 0) fail();
  const expected = path.join(hostProfileDirectory, 'user-data');
  if (exactAbsolute(candidate) !== expected) fail();
  const [subject, apps, scope, appHosts] = hostProfileDirectory.split(path.sep).reverse();
  if (appHosts !== 'app-hosts' || apps !== 'apps'
    || !/^[a-f0-9]{32}$/u.test(scope ?? '') || !/^[a-f0-9]{32}$/u.test(subject ?? '')) fail();
  const appHostsDirectory = path.dirname(path.dirname(path.dirname(hostProfileDirectory)));
  const appHostsMetadata = lstatSync(appHostsDirectory);
  if (!appHostsMetadata.isDirectory() || appHostsMetadata.isSymbolicLink()
    || realpathSync(appHostsDirectory) !== appHostsDirectory) fail();
  let current = appHostsDirectory;
  for (const component of [scope, apps, subject, 'user-data']) {
    current = path.join(current, component);
    const metadata = lstatSync(current);
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== Number(uid)
      || (metadata.mode & 0o077) !== 0 || realpathSync(current) !== current) fail();
  }
  return expected;
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
