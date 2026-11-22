import { lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';

export const MACOS_LOCAL_APP_HOST_EXECUTABLE = '/Applications/Nimi.app/Contents/Frameworks/Nimi Local App Host.app/Contents/MacOS/Nimi Local App Host';
const SHA256_REF_PATTERN = /^sha256:[0-9a-f]{64}$/u;

export function describeMacOSLocalAppHostFailure(error, stage, argumentCount, ready) {
  const knownCodes = new Set([
    'ERR_MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED', 'ERR_DLOPEN_FAILED',
    'ERR_REQUIRE_ESM', 'ERR_UNSUPPORTED_ESM_URL_SCHEME',
    'electron-app-host-profile-after-ready', 'electron-app-host-profile-missing',
    'electron-app-host-profile-unavailable',
  ]);
  const candidate = error?.reasonCode ?? error?.code;
  const code = knownCodes.has(candidate) ? candidate : 'unclassified';
  const phase = stage === 'app-import' || stage === 'managed-web-carrier' ? stage : 'launch-contract';
  const count = Number.isSafeInteger(argumentCount) && argumentCount >= 0 && argumentCount <= 16 ? argumentCount : 'invalid';
  const names = new Set(['Error', 'TypeError', 'SyntaxError', 'ReferenceError', 'NimiElectronShellHostError']);
  const name = names.has(error?.name) ? error.name : 'Error';
  const boundary = error?.message === 'protected-carrier-required' ? 'protected-carrier-required' : 'unclassified';
  const frame = typeof error?.stack === 'string'
    ? error.stack.split('\n').slice(1).map(line => line.match(/\/([a-zA-Z0-9_.-]+\.[cm]?js):(\d+):(\d+)/u)).find(Boolean)
    : undefined;
  const location = frame ? `${frame[1]}:${frame[2]}:${frame[3]}` : 'unavailable';
  return `local-app-host-launch-untrusted stage=${phase} code=${code} argc=${count} ready=${ready === true} error=${name} boundary=${boundary} location=${location}`;
}

export function resolveMacOSLocalAppHostLaunch(input) {
  const argv = Array.isArray(input?.argv) ? input.argv.map(exactText) : fail();
  if (argv.length < 2) fail();
  if (argv.some(isForbiddenChromiumArgument)) fail();
  const rest = argv.slice(1);
  const hasNativeMain = rest.some((arg) => arg.startsWith('--nimi-local-app-main='));
  const hasManagedDev = rest.includes('--nimi-managed-web-dev');
  const hasManagedInstalled = rest.includes('--nimi-managed-web-app');
  const modeCount = Number(hasNativeMain) + Number(hasManagedDev) + Number(hasManagedInstalled);
  if (modeCount !== 1) fail();

  const cdpPort = optionalCdpPort(argv);
  if (hasManagedInstalled && cdpPort !== undefined) fail();

  const executable = canonicalFile(exactAbsolute(input?.executable));
  const allowLeadingScript = input?.allowLeadingScriptArgument === true;
  if (!allowLeadingScript) {
    const expectedExecutable = input?.contractTestExpectedExecutable === undefined
      ? MACOS_LOCAL_APP_HOST_EXECUTABLE
      : canonicalFile(exactAbsolute(input.contractTestExpectedExecutable));
    if (executable !== expectedExecutable || argv[0] !== executable) fail();
  } else if (argv[0] !== executable) {
    fail();
  }
  const workingDirectory = canonicalDirectory(exactAbsolute(input?.workingDirectory));
  const hostProfileDirectory = exactAbsolute(input?.hostProfileDirectory);

  // Mode C: managed-web installed (never permits dev/CDP/--nimi-local-app-main).
  if (hasManagedInstalled) {
    const args = [...rest];
    if (allowLeadingScript && args.length > 0 && !args[0].startsWith('-')) {
      if (path.basename(args[0]) !== 'main.mjs') fail();
      canonicalFile(exactAbsolute(args[0]));
      args.shift();
    }
    if (args.length !== 2 || args[0] !== '--nimi-managed-web-app' || !args[1].startsWith('--nimi-payload-digest=')) {
      fail();
    }
    const payloadDigest = exactText(args[1].slice('--nimi-payload-digest='.length));
    if (!SHA256_REF_PATTERN.test(payloadDigest)) fail();
    canonicalHostProfileDirectory(hostProfileDirectory, input?.uid);
    return Object.freeze({
      mode: 'managed-web-installed',
      payloadDigest,
      workingDirectory,
    });
  }

  // Mode B: managed-web local development (never permits third-party import).
  if (hasManagedDev) {
    const args = [];
    let sawScript = false;
    for (const arg of rest) {
      if (allowLeadingScript && !sawScript && !arg.startsWith('-') && path.basename(arg) === 'main.mjs') {
        canonicalFile(exactAbsolute(arg));
        sawScript = true;
        continue;
      }
      args.push(arg);
    }
    if (args.length !== (cdpPort === undefined ? 3 : 5)) fail();
    if (args.filter((arg) => arg === '--nimi-managed-web-dev').length !== 1) fail();
    const userDataArgument = exactArgument(args, '--user-data-dir');
    const rendererArgument = exactArgument(args, '--nimi-dev-renderer-url');
    const userDataDirectory = canonicalHostProfileUserDataDirectory(userDataArgument, hostProfileDirectory, input?.uid);
    const rendererOrigin = exactLoopbackOrigin(rendererArgument);
    return Object.freeze({
      mode: 'managed-web-dev',
      rendererOrigin,
      userDataDirectory,
      workingDirectory,
      ...(cdpPort === undefined ? {} : { cdpPort }),
    });
  }

  // Mode A: existing native macOS local development.
  if (argv.length !== (cdpPort === undefined ? 4 : 6)) fail();
  const userDataArgument = exactArgument(argv, '--user-data-dir');
  const mainArgument = exactArgument(argv, '--nimi-local-app-main');
  const rendererArgument = exactArgument(argv, '--nimi-dev-renderer-url');

  const userDataDirectory = canonicalHostProfileUserDataDirectory(userDataArgument, hostProfileDirectory, input?.uid);
  const expectedMain = path.join(workingDirectory, 'dist-electron', 'main.js');
  const mainEntry = canonicalFile(exactAbsolute(mainArgument));
  if (mainEntry !== expectedMain) fail();
  const rendererOrigin = exactLoopbackOrigin(rendererArgument);
  return Object.freeze({
    mode: 'native-dev',
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

function canonicalHostProfileDirectory(hostProfileDirectory, rawUID) {
  const uid = rawUID ?? process.getuid?.();
  if (!Number.isSafeInteger(uid) || Number(uid) < 0) fail();
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
  return path.join(hostProfileDirectory, 'user-data');
}

// The Host profile is the Runtime-derived `<data root>/app-hosts/<scope>/apps/
// <subject>` prepared by the native carrier and passed only to this child as
// NIMI_APP_HOST_PROFILE_DIR; the user data argument must be its user-data.
function canonicalHostProfileUserDataDirectory(candidate, hostProfileDirectory, rawUID) {
  const expected = canonicalHostProfileDirectory(hostProfileDirectory, rawUID);
  if (exactAbsolute(candidate) !== expected) fail();
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
