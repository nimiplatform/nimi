import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { assess, validateMapAgainstLedger } from './assess';
import {
  MASTRA_APP_FIXTURE,
  NO_FRAMEWORK_FIXTURE,
  OPENAI_APP_FIXTURE,
  PENDING_FRAMEWORK_FIXTURE,
  VERCEL_APP_FIXTURE,
} from './doctor.fixtures';
import { loadAdapterCapabilityLedger } from './ledger';
import { loadFrameworkApiCapabilityMap, NimiDoctorMapError } from './map';
import { renderTextReport } from './report';
import { scanSource } from './scanner';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const mapPath = path.join(repoRoot, 'config/sdks-framework-api-capability-map.yaml');
const ledgerPath = path.join(repoRoot, 'config/sdks-typescript-adapter-capability-ledger.yaml');

const frameworks = loadFrameworkApiCapabilityMap(readFileSync(mapPath, 'utf8'));
const ledger = loadAdapterCapabilityLedger(readFileSync(ledgerPath, 'utf8'));

test('map loader parses the spec table and enforces pending semantics', () => {
  const ids = frameworks.map((framework) => framework.id).sort();
  assert.deepEqual(ids, ['langgraph', 'llamaindex', 'mastra', 'mcp', 'openai-compatible', 'vercel-ai']);
  const pending = frameworks.filter((framework) => framework.status === 'pending-upstream-binding');
  assert.deepEqual(pending.map((framework) => framework.id).sort(), ['langgraph', 'llamaindex', 'mcp']);
  for (const framework of pending) {
    assert.equal(framework.apiEntries.length, 0);
  }
});

test('map loader fails closed on inadmissible shapes', () => {
  assert.throws(() => loadFrameworkApiCapabilityMap('frameworks: []'), NimiDoctorMapError);
  assert.throws(
    () =>
      loadFrameworkApiCapabilityMap(
        [
          'frameworks:',
          '  - id: bogus',
          '    upstream_package: bogus',
          '    status: mapped',
          '    api_entries:',
          '      - api: x',
          '        detection: { kind: telepathy, package: bogus, symbol: x }',
          '        capabilities: []',
        ].join('\n'),
      ),
    /detection kind telepathy is not admitted/,
  );
  assert.throws(
    () =>
      loadFrameworkApiCapabilityMap(
        [
          'frameworks:',
          '  - id: bogus',
          '    upstream_package: bogus',
          '    status: pending-upstream-binding',
          '    api_entries:',
          '      - api: x',
          '        detection: { kind: import-call, package: bogus, symbol: x }',
          '        capabilities: []',
        ].join('\n'),
      ),
    /pending framework must not declare api entries/,
  );
});

test('map capabilities resolve verbatim against the adapter capability ledger', () => {
  const errors = validateMapAgainstLedger(frameworks, ledger);
  assert.deepEqual(errors, []);
});

test('scanner detects import-call, constructor, member-call, member-chain, options, and unknown apis', () => {
  const vercel = scanSource({ fileName: 'vercel-app.ts', sourceText: VERCEL_APP_FIXTURE, frameworks });
  const vercelApis = new Map(vercel.hits.map((hit) => [hit.api, hit]));
  assert.ok(vercelApis.has('generateText'));
  assert.ok(vercelApis.has('streamText'));
  assert.ok(vercelApis.has('tool'));
  assert.deepEqual(vercel.unknownApis, []);
  assert.ok(vercelApis.get('generateText')?.optionKeys.includes('tools'));
  assert.ok(vercelApis.get('generateText')?.optionKeys.includes('providerOptions'));
  assert.ok(vercelApis.get('streamText')?.optionKeys.includes('includeRawChunks'));

  const mastra = scanSource({ fileName: 'mastra-app.ts', sourceText: MASTRA_APP_FIXTURE, frameworks });
  const mastraApis = new Set(mastra.hits.map((hit) => hit.api));
  assert.ok(mastraApis.has('Agent'));
  assert.ok(mastraApis.has('Agent.generate'));
  assert.ok(mastraApis.has('createTool'));
  assert.ok(mastraApis.has('Memory'));
  assert.equal(mastra.unknownApis.length, 1);
  assert.equal(mastra.unknownApis[0]?.call, 'Agent.unknownExperimentalThing');

  const openai = scanSource({ fileName: 'openai-app.ts', sourceText: OPENAI_APP_FIXTURE, frameworks });
  const openaiApis = new Set(openai.hits.map((hit) => hit.api));
  assert.ok(openaiApis.has('OpenAI'), 'client entry constructor must be an informational hit, not unknown-api');
  assert.ok(openaiApis.has('OpenAI.chat.completions.create'));
  assert.ok(openaiApis.has('OpenAI.embeddings.create'));
  assert.deepEqual(openai.unknownApis, []);

  const pending = scanSource({ fileName: 'graph-app.ts', sourceText: PENDING_FRAMEWORK_FIXTURE, frameworks });
  assert.deepEqual(pending.detectedPendingFrameworks, ['langgraph']);
  assert.deepEqual(pending.hits, []);

  const clean = scanSource({ fileName: 'pure.ts', sourceText: NO_FRAMEWORK_FIXTURE, frameworks });
  assert.deepEqual(clean.hits, []);
  assert.deepEqual(clean.unknownApis, []);
  assert.deepEqual(clean.detectedPendingFrameworks, []);
});

test('audit regressions: approval shape, dynamic resolution, unbound calls, option variables, namespace constructor, dynamic import', () => {
  // A1: requireToolApproval is a generate/stream loop option (conformance shape).
  const approvalSource = `
import { Agent } from '@mastra/core';
const agent = new Agent({ name: 'a', model: {} });
export const run = () => agent.generate('delete user u-1', { requireToolApproval: true, maxSteps: 3 });
`;
  const approvalScan = scanSource({ fileName: 'approval.ts', sourceText: approvalSource, frameworks });
  const approvalAssessment = assess({
    frameworks,
    ledger,
    hits: approvalScan.hits,
    unknownApis: approvalScan.unknownApis,
    detectedPendingFrameworks: [],
  });
  const approvalMastra = approvalAssessment.frameworks.find((f) => f.frameworkId === 'mastra');
  assert.ok(approvalMastra);
  assert.ok(
    approvalMastra.partial.some((finding) => finding.capability === 'toolApproval'),
    'requireToolApproval on Agent.generate must surface the toolApproval partial cluster',
  );

  // A2: static model must not claim dynamicResolution; function-valued model must.
  const staticAgent = scanSource({
    fileName: 'static.ts',
    sourceText: "import { Agent } from '@mastra/core';\nexport const a = new Agent({ name: 'a', model: {} });",
    frameworks,
  });
  const staticAssessment = assess({ frameworks, ledger, hits: staticAgent.hits, unknownApis: [], detectedPendingFrameworks: [] });
  const staticMastra = staticAssessment.frameworks.find((f) => f.frameworkId === 'mastra');
  assert.ok(staticMastra);
  assert.ok(
    !staticMastra.supported.some((finding) => finding.capability === 'dynamicResolution'),
    'a static model value must not claim dynamicResolution',
  );
  const dynamicAgent = scanSource({
    fileName: 'dynamic.ts',
    sourceText: "import { Agent } from '@mastra/core';\nexport const a = new Agent({ name: 'a', model: () => ({}) });",
    frameworks,
  });
  const dynamicAssessment = assess({ frameworks, ledger, hits: dynamicAgent.hits, unknownApis: [], detectedPendingFrameworks: [] });
  const dynamicMastra = dynamicAssessment.frameworks.find((f) => f.frameworkId === 'mastra');
  assert.ok(dynamicMastra?.supported.some((finding) => finding.capability === 'dynamicResolution'));

  // B-flagship: cross-file member call must surface as an unbound call, not vanish.
  const routesOnly = scanSource({
    fileName: 'routes.ts',
    sourceText: "import { Agent } from '@mastra/core';\nexport const handle = (agent: Agent, q: string) => agent.generate(q, { structuredOutput: { schema: {} } });",
    frameworks,
  });
  assert.ok(
    routesOnly.unboundCalls.some((call) => call.frameworkId === 'mastra' && call.member === 'generate'),
    'receiver-unbindable framework member call must be reported as unbound',
  );

  // B10: option variables resolve file-locally; unresolvable options surface as unresolved conditionals.
  const optsResolved = scanSource({
    fileName: 'opts.ts',
    sourceText: "import { generateText } from 'ai';\nconst opts = { model: {}, tools: {} };\nexport const r = () => generateText(opts);",
    frameworks,
  });
  assert.ok(optsResolved.hits[0]?.optionKeys.includes('tools'));
  const optsUnresolved = scanSource({
    fileName: 'opts-ext.ts',
    sourceText: "import { generateText } from 'ai';\nexport const r = (opts: object) => generateText(opts);",
    frameworks,
  });
  assert.equal(optsUnresolved.hits[0]?.optionsResolved, false);
  const unresolvedAssessment = assess({
    frameworks,
    ledger,
    hits: optsUnresolved.hits,
    unknownApis: [],
    detectedPendingFrameworks: [],
  });
  const unresolvedVercel = unresolvedAssessment.frameworks.find((f) => f.frameworkId === 'vercel-ai');
  assert.ok(unresolvedVercel);
  assert.ok(
    unresolvedVercel.unresolvedConditional.some((item) => item.capability === 'tools.definitionMapping'),
    'unmet conditions on unresolvable options must surface as unresolved, not vanish',
  );
  assert.ok(unresolvedVercel.supported.some((finding) => finding.capability === 'text.generate'));

  // B9: namespace constructor.
  const nsCtor = scanSource({
    fileName: 'ns-ctor.ts',
    sourceText: "import * as ai from 'ai';\nexport const agent = new ai.ToolLoopAgent({});",
    frameworks,
  });
  assert.ok(nsCtor.hits.some((hit) => hit.api === 'ToolLoopAgent'));

  // B7: dynamic import detects the framework (including for member-name heuristics downstream).
  const dyn = scanSource({
    fileName: 'dyn.ts',
    sourceText: "export const load = async () => { const { generateText } = await import('ai'); return generateText; };",
    frameworks,
  });
  assert.equal(dyn.dynamicImports.length, 1);
  assert.equal(dyn.dynamicImports[0]?.frameworkId, 'vercel-ai');
});

test('scanner resolves namespace imports instead of silently passing them', () => {
  const namespaceFixture = `
import * as ai from 'ai';
export async function run(model: unknown) {
  const result = await ai.generateText({ model, prompt: 'q', tools: {} });
  await ai.embedMany({ model, values: [] });
  return result;
}
`;
  const result = scanSource({ fileName: 'ns-app.ts', sourceText: namespaceFixture, frameworks });
  const apis = new Map(result.hits.map((hit) => [hit.api, hit]));
  assert.ok(apis.has('generateText'));
  assert.ok(apis.get('generateText')?.optionKeys.includes('tools'));
  assert.equal(result.unknownApis.length, 1);
  assert.equal(result.unknownApis[0]?.call, 'embedMany');
});

test('assess applies when-conditions and buckets findings by ledger support', () => {
  const vercel = scanSource({ fileName: 'vercel-app.ts', sourceText: VERCEL_APP_FIXTURE, frameworks });
  const mastra = scanSource({ fileName: 'mastra-app.ts', sourceText: MASTRA_APP_FIXTURE, frameworks });
  const assessment = assess({
    frameworks,
    ledger,
    hits: [...vercel.hits, ...mastra.hits],
    unknownApis: [...vercel.unknownApis, ...mastra.unknownApis],
    detectedPendingFrameworks: [],
  });
  assert.deepEqual(assessment.configErrors, []);

  const vercelAssessment = assessment.frameworks.find((framework) => framework.frameworkId === 'vercel-ai');
  assert.ok(vercelAssessment);
  const vercelSupported = new Set(vercelAssessment.supported.map((finding) => finding.capability));
  assert.ok(vercelSupported.has('text.generate'));
  assert.ok(vercelSupported.has('tools.definitionMapping'));
  assert.ok(!vercelSupported.has('multiStep'), 'option:stopWhen absent so multiStep must not be claimed');

  const mastraAssessment = assessment.frameworks.find((framework) => framework.frameworkId === 'mastra');
  assert.ok(mastraAssessment);
  const partialCapabilities = new Set(mastraAssessment.partial.map((finding) => finding.capability));
  assert.ok(partialCapabilities.has('memory'), 'Mastra Memory must surface as partial, not silently pass');
  assert.ok(partialCapabilities.has('structuredOutput') || new Set(mastraAssessment.supported.map((f) => f.capability)).has('structuredOutput'));
  assert.equal(mastraAssessment.unknownApis.length, 1);

  const rendered = renderTextReport(assessment);
  assert.match(rendered, /\[vercel-ai\]/);
  assert.match(rendered, /unknown-api/);
  assert.match(rendered, /Totals:/);
});

test('assess reports unsupported openai surfaces as gaps instead of dropping them', () => {
  const openai = scanSource({ fileName: 'openai-app.ts', sourceText: OPENAI_APP_FIXTURE, frameworks });
  const assessment = assess({
    frameworks,
    ledger,
    hits: openai.hits,
    unknownApis: openai.unknownApis,
    detectedPendingFrameworks: [],
  });
  const openaiAssessment = assessment.frameworks.find((framework) => framework.frameworkId === 'openai-compatible');
  assert.ok(openaiAssessment);
  const unsupported = new Set(openaiAssessment.unsupported.map((finding) => finding.capability));
  assert.ok(unsupported.has('embeddingsApi'));
});

test('integration: cli end-to-end over a fixture app directory', async () => {
  const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { runNimiSdkDoctor } = await import('./cli');

  const appDir = mkdtempSync(path.join(tmpdir(), 'nimi-sdk-doctor-'));
  try {
    writeFileSync(path.join(appDir, 'vercel-app.ts'), VERCEL_APP_FIXTURE);
    writeFileSync(path.join(appDir, 'mastra-app.ts'), MASTRA_APP_FIXTURE);
    writeFileSync(path.join(appDir, 'graph-app.ts'), PENDING_FRAMEWORK_FIXTURE);
    const { exitCode, output } = runNimiSdkDoctor({
      targetDir: appDir,
      json: true,
      mapPath,
      ledgerPath,
    });
    assert.equal(exitCode, 0);
    const parsed = JSON.parse(output) as {
      frameworks: { frameworkId: string }[];
      pendingFrameworks: { frameworkId: string }[];
      totals: { supported: number; unknownApis: number };
    };
    const ids = parsed.frameworks.map((framework) => framework.frameworkId).sort();
    assert.deepEqual(ids, ['mastra', 'vercel-ai']);
    assert.deepEqual(parsed.pendingFrameworks.map((framework) => framework.frameworkId), ['langgraph']);
    assert.ok(parsed.totals.supported > 0);
    assert.equal(parsed.totals.unknownApis, 1);
  } finally {
    rmSync(appDir, { recursive: true, force: true });
  }
});

