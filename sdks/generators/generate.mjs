#!/usr/bin/env node

import { checkMode, languages, realmOnly, writeJson } from './lib/context.mjs';
import {
  writeGoClients,
  writePythonClients,
  writeRustClients,
  writeTypescriptClients,
  writeTypescriptPublicRuntimeDescriptors,
} from './lib/descriptor-clients.mjs';
import { writeConformanceFixtures } from './lib/conformance.mjs';
import { extractErrorCodes, buildExportManifest, languageGeneratedDir, writeSharedArtifacts } from './lib/manifests.mjs';
import { extractRealmCore } from './lib/realm-openapi.mjs';
import {
  extractRuntimeProto,
  projectRuntimeForNonHostPublicSdks,
} from './lib/runtime-proto.mjs';
import { writeTypescriptRuntimeProtobuf } from './lib/runtime-protobuf-ts.mjs';
import { writeTypedClients } from './lib/typed-clients.mjs';
import { writeTypescriptRuntimeAuthPostureProjection } from './lib/runtime-auth-posture.mjs';
import { projectRealmForPublicSdks, writeRuntimeRealmCarrier } from './lib/runtime-realm-carrier.mjs';

function assertRealmOpenApiLoaded(realm) {
  if (realm.source_state === 'openapi_loaded' || realm.source_state === 'projection_loaded') {
    return;
  }
  throw new Error([
    'Realm source projection is required for generated Realm clients.',
    'Configured source is unavailable: ' + realm.source_label,
    'Fix config/realm-openapi-source.json or the admitted tracked Realm projection path.',
  ].join(' '));
}

function writeLanguageArtifacts(typescriptRuntime, nonHostRuntime, realm, errorCodes, exportsManifest) {
  for (const language of languages) {
    const dir = languageGeneratedDir(language);
    const runtime = language === 'typescript' ? typescriptRuntime : nonHostRuntime;
    writeJson(dir + '/runtime-core.manifest.json', {
      ...runtime,
      language,
      generated_projection: 'language-core-generated',
    });
    writeJson(dir + '/realm-core.manifest.json', {
      ...realm,
      language,
      generated_projection: 'language-core-generated',
    });
    writeJson(dir + '/error-codes.manifest.json', {
      ...errorCodes,
      language,
      generated_projection: 'language-core-generated',
    });
    writeJson(dir + '/export-manifest.json', {
      ...exportsManifest,
      language,
      generated_projection: 'language-core-generated',
    });
  }
  writeTypescriptClients(typescriptRuntime, realm);
  writeTypescriptPublicRuntimeDescriptors(nonHostRuntime);
  writePythonClients(nonHostRuntime, realm);
  writeGoClients(nonHostRuntime, realm);
  writeRustClients(nonHostRuntime, realm);
  writeTypedClients(typescriptRuntime, nonHostRuntime, realm);
}

function main() {
  const runtime = extractRuntimeProto();
  const nonHostRuntime = projectRuntimeForNonHostPublicSdks(runtime);
  const realm = extractRealmCore();
  assertRealmOpenApiLoaded(realm);
  const publicSdkRealm = projectRealmForPublicSdks(realm);
  const errorCodes = extractErrorCodes();
  const exportsManifest = buildExportManifest(nonHostRuntime, publicSdkRealm, errorCodes);

  if (!realmOnly) {
    writeTypescriptRuntimeProtobuf();
    writeTypescriptRuntimeAuthPostureProjection(runtime, nonHostRuntime);
  }
  writeSharedArtifacts(nonHostRuntime, realm, errorCodes, exportsManifest);
  writeRuntimeRealmCarrier(realm);
  writeLanguageArtifacts(runtime, nonHostRuntime, publicSdkRealm, errorCodes, exportsManifest);
  writeConformanceFixtures(nonHostRuntime, publicSdkRealm);

  const action = checkMode ? 'checked' : 'generated';
  process.stdout.write(action + ' sdks core manifests: mode=' + (realmOnly ? 'realm-only' : 'full') + ', runtime=' + runtime.method_ids.length + ' methods, non_host_public_runtime=' + nonHostRuntime.method_ids.length + ' methods, realm=' + realm.operations.length + ' operations, public_realm=' + publicSdkRealm.operations.length + ' operations (' + realm.source_state + ')\n');
}

try {
  main();
} catch (error) {
  process.stderr.write('[sdks:generation] ' + (error?.stack || error) + '\n');
  process.exitCode = 1;
}
