import { lstat, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { MAX_ZIP32_ENTRIES, writeNimiAppArchive } from './app-pack.mjs';
import { hostedWebIdentity } from './app-identifiers.mjs';
import { resolveDevelopmentRealm } from './development-environment.mjs';

const HOSTED_WEB_MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
const HOSTED_WEB_MAX_UNCOMPRESSED_BYTES = 256 * 1024 * 1024;

const versionPattern =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

// @nimi-authority: rule.nimi.platform.app-ecosystem.hosted-web-publication
export function hostedWebViteConfig(manifest, env) {
  const identity = hostedWebIdentity(manifest.app_id, manifest.public_slug, env.NIMI_WEB_CLIENT_ID);
  const official = resolveDevelopmentRealm('official');
  const version = env.NIMI_WEB_VERSION ?? manifest.version;
  if (typeof version !== 'string' || version.length > 120 || !versionPattern.test(version))
    throw new Error('Invalid Web release version.');
  const config = {
    appId: identity.appId,
    clientId: identity.clientId,
    realmEnvironmentId: official.environmentId,
    officialWebBaseUrl: official.webOrigin,
    realmBaseUrl: identity.origin,
    redirectUri: identity.redirectUri,
  };
  for (const [key, expected] of Object.entries({
    NIMI_WEB_ORIGIN: identity.origin,
    NIMI_WEB_CLIENT_ID: config.clientId,
    NIMI_WEB_REDIRECT_URI: config.redirectUri,
    NIMI_WEB_REALM_ENVIRONMENT_ID: config.realmEnvironmentId,
    NIMI_WEB_OFFICIAL_WEB_URL: config.officialWebBaseUrl,
  })) {
    if (env[key] !== undefined && env[key] !== expected)
      throw new Error(key + ' conflicts with hosted Web identity.');
  }
  const info = {
    format: 'nimi.web-bundle/v1',
    app_id: identity.appId,
    slug: identity.slug,
    version,
    client_id: config.clientId,
    origin: identity.origin,
    redirect_uri: config.redirectUri,
    official_web_url: config.officialWebBaseUrl,
    realm_environment_id: config.realmEnvironmentId,
    entry: 'index.html',
    app_access: manifest.app_access,
    capability_contract_refs: manifest.capability_contract_refs ?? [],
  };
  return {
    base: '/',
    define: { __NIMI_APP_WEB_CONFIG__: JSON.stringify(config) },
    build: { assetsDir: '_releases/' + version + '/assets' },
    plugins: [
      {
        name: 'nimi-hosted-web-release',
        async writeBundle(options) {
          if (env.NIMI_WEB_ARCHIVE) {
            if (!options.dir) throw new Error('Hosted Web packaging requires one static output directory.');
            await packHostedWeb(options.dir, env.NIMI_WEB_ARCHIVE);
          }
        },
        generateBundle() {
          this.emitFile({
            type: 'asset',
            fileName: 'nimi-web-bundle.json',
            source: JSON.stringify(info, null, 2) + '\n',
          });
        },
      },
    ],
  };
}

export async function packHostedWeb(directory, outputFile) {
  const root = path.resolve(directory);
  if (path.resolve(outputFile).startsWith(root + path.sep))
    throw new Error('Write the archive outside the static directory.');
  const entries = [];
  let totalUncompressed = 0;
  async function collect(relative) {
    for (const item of await readdir(path.join(root, relative), { withFileTypes: true })) {
      const name = relative ? relative + '/' + item.name : item.name;
      if (/^(?:_headers|_redirects|_routes\.json|_worker\.js|wrangler\.[^/]+|functions)(?:\/|$)/iu.test(name))
        continue;
      if (/^(?:\.git|\.env(?:\..*)?)(?:\/|$)/u.test(name))
        throw new Error('Private working files cannot be hosted: ' + name);
      if (item.isDirectory()) await collect(name);
      else if (item.isFile()) {
        const fullPath = path.join(root, name);
        const st = await lstat(fullPath);
        if (!st.isFile() || st.isSymbolicLink()) {
          throw new Error('Unsupported file in hosted Web bundle: ' + name);
        }
        if (entries.length >= MAX_ZIP32_ENTRIES) {
          throw new Error(`Hosted Web bundle exceeds ${MAX_ZIP32_ENTRIES} entries.`);
        }
        totalUncompressed += st.size;
        if (totalUncompressed > HOSTED_WEB_MAX_UNCOMPRESSED_BYTES) {
          throw new Error(`Hosted Web bundle exceeds ${HOSTED_WEB_MAX_UNCOMPRESSED_BYTES} bytes uncompressed.`);
        }
        const bytes = await readFile(fullPath);
        if (bytes.length !== st.size) {
          throw new Error('Hosted Web bundle file changed during packaging: ' + name);
        }
        entries.push({ name, bytes });
      } else throw new Error('Unsupported file in hosted Web bundle: ' + name);
    }
  }
  await collect('');
  if (
    !entries.some((e) => e.name === 'index.html') ||
    !entries.some((e) => e.name === 'nimi-web-bundle.json')
  )
    throw new Error('Missing hosted Web entry or release manifest.');
  const archive = writeNimiAppArchive(entries, {
    compress: true,
    maxArchiveBytes: HOSTED_WEB_MAX_ARCHIVE_BYTES,
    maxTotalUncompressedBytes: HOSTED_WEB_MAX_UNCOMPRESSED_BYTES,
  });
  await writeFile(outputFile, archive, { flag: 'wx' });
}
