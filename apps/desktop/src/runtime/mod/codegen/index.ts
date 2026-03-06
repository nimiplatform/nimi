import type { RuntimeModRegistration } from '../types';
import { transformSync } from 'esbuild';
import { preflightCodegenBundle, type CodegenPreflightResult } from './preflight';

export type CodegenGenerateInput = {
  modId: string;
  slug: string;
  prompt: string;
  capabilities: string[];
  template?: string;
  modelUsed?: string;
  routePolicy?: 'local-runtime' | 'token-api';
  nowIso?: () => string;
};

export type CodegenGeneratedArtifacts = {
  manifest: Record<string, unknown>;
  source: string;
  dist: string;
  meta: Record<string, unknown>;
  preflight: CodegenPreflightResult;
};

export type CodegenConsentDecision = {
  grantedCapabilities: string[];
  deniedCapabilities: string[];
};

function normalizeSlug(value: string): string {
  const trimmed = String(value || '').trim().toLowerCase();
  if (!trimmed) return 'user-mod';
  return trimmed
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/--+/g, '-')
    .replace(/^-+|-+$/g, '') || 'user-mod';
}

function buildTemplateSource(input: {
  modId: string;
  prompt: string;
}): string {
  const escapedPrompt = JSON.stringify(String(input.prompt || ''));
  return [
    `const MOD_ID = ${JSON.stringify(input.modId)};`,
    `const ORIGINAL_PROMPT = ${escapedPrompt};`,
    '',
    'export function createRuntimeMod() {',
    '  return {',
    '    modId: MOD_ID,',
    '    capabilities: [',
    '      "runtime.ai.text.generate",',
    '      "runtime.ai.text.stream",',
    '      "ui.register.ui-extension.app.content.routes",',
    '    ],',
    '    setup: async ({ hookRuntime }) => {',
    '      await hookRuntime.registerUIExtensionV2({',
    '        modId: MOD_ID,',
    '        sourceType: "codegen",',
    '        slot: "ui-extension.app.content.routes",',
    '        extension: {',
    '          extensionId: `ui-extension.app.content.routes:${MOD_ID}`,',
    '          strategy: "append",',
    '          title: "Generated Tool",',
    '          route: `/mods/${MOD_ID}`,',
    '        },',
    '      });',
    '      await hookRuntime.publishEvent({',
    '        modId: MOD_ID,',
    '        sourceType: "codegen",',
    '        topic: "mod.codegen.bootstrap",',
    '        payload: { prompt: ORIGINAL_PROMPT },',
    '      });',
    '    },',
    '    teardown: async ({ hookRuntime }) => {',
    '      hookRuntime.unregisterUIExtension({ modId: MOD_ID });',
    '      hookRuntime.unsubscribeEvent({ modId: MOD_ID });',
    '      hookRuntime.unregisterDataProvider({ modId: MOD_ID, capability: `data-api.user-${MOD_ID}.records.list` });',
    '    },',
    '  };',
    '}',
    '',
  ].join('\n');
}

function normalizeCapabilities(capabilities: string[]): string[] {
  return Array.from(
    new Set(
      (capabilities || [])
        .map((item) => String(item || '').trim())
        .filter(Boolean),
    ),
  );
}

function toBuildErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return String(error || 'unknown build error');
}

function buildCodegenDist(sourceCode: string): string {
  const normalized = String(sourceCode || '');
  try {
    const output = transformSync(normalized, {
      loader: 'ts',
      format: 'esm',
      target: 'es2022',
      sourcemap: false,
      minify: false,
      legalComments: 'none',
    });
    const code = String(output.code || '').trim();
    if (!code) {
      throw new Error('empty bundle output');
    }
    return code;
  } catch (error) {
    throw new Error(`CODEGEN_BUILD_FAILED: ${toBuildErrorMessage(error)}`);
  }
}

export function generateCodegenArtifacts(input: CodegenGenerateInput): CodegenGeneratedArtifacts {
  const slug = normalizeSlug(input.slug);
  const modId = String(input.modId || '').trim() || `world.nimi.user-${slug}`;
  const source = buildTemplateSource({
    modId,
    prompt: input.prompt,
  });
  const dist = buildCodegenDist(source);
  const capabilities = normalizeCapabilities(input.capabilities);
  const preflight = preflightCodegenBundle({
    modId,
    sourceCode: dist,
    capabilities,
  });
  if (!preflight.ok) {
    throw new Error(`CODEGEN_PREFLIGHT_FAILED: ${preflight.reasonCode}`);
  }

  const now = input.nowIso ? input.nowIso() : new Date().toISOString();
  const manifest = {
    id: modId,
    name: `Generated ${slug}`,
    version: '0.1.0',
    description: `Generated from prompt: ${String(input.prompt || '').slice(0, 120)}`,
    entry: './dist/index.js',
    hash: preflight.bundleHash,
    capabilities,
    nimi: {
      minVersion: '0.1.0',
      maxVersion: '1.x',
    },
  };
  const meta = {
    createdAt: now,
    updatedAt: now,
    template: input.template || 'generic',
    originalPrompt: String(input.prompt || ''),
    revisionHistory: [],
    modelUsed: input.modelUsed || 'unknown',
    routePolicy: input.routePolicy || 'token-api',
    lastBuildHash: preflight.bundleHash,
    grantedCapabilities: preflight.autoGrantedCapabilities,
    consentRequiredCapabilities: preflight.consentRequiredCapabilities,
  };

  return {
    manifest,
    source,
    dist,
    meta,
    preflight,
  };
}

export function resolveCodegenConsentDecision(input: {
  preflight: CodegenPreflightResult;
  approvedCapabilities: string[];
}): CodegenConsentDecision {
  const approved = new Set(
    (input.approvedCapabilities || [])
      .map((item) => String(item || '').trim())
      .filter(Boolean),
  );

  const grantedCapabilities = [
    ...input.preflight.autoGrantedCapabilities,
    ...input.preflight.consentRequiredCapabilities.filter((item) => approved.has(item)),
  ];
  const deniedCapabilities = input.preflight.consentRequiredCapabilities.filter(
    (item) => !approved.has(item),
  );

  return {
    grantedCapabilities,
    deniedCapabilities,
  };
}

export function buildCodegenRuntimeModRegistration(input: {
  artifacts: CodegenGeneratedArtifacts;
  setup: RuntimeModRegistration['setup'];
  teardown?: RuntimeModRegistration['teardown'];
  consent: CodegenConsentDecision;
}): RuntimeModRegistration {
  const modId = String(input.artifacts.manifest.id || '').trim();
  return {
    modId,
    sourceType: 'codegen',
    capabilities: [...input.artifacts.preflight.autoGrantedCapabilities, ...input.artifacts.preflight.consentRequiredCapabilities],
    manifestCapabilities: normalizeCapabilities(input.artifacts.manifest.capabilities as string[]),
    grantCapabilities: input.consent.grantedCapabilities,
    denialCapabilities: input.consent.deniedCapabilities,
    setup: input.setup,
    teardown: input.teardown,
  };
}
