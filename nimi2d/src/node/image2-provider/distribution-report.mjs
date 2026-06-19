import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';

function usage() {
  return [
    'Usage:',
    '  node nimi2d/experiments/image-to-layer-input/workflows/codex-image2-distribution-report.mjs \\',
    '    --runs-dir <image2-runs-dir> --out <report.yaml> [--min-samples <n>] [--min-underlying-sources <n>] [--require-layer-input-full-chain] [--source-surface <surface>] [--gate-mode <mode>]',
    '',
    'Summarizes Codex Image2 layer workflow runs by unique atlas/source hash and optional underlying source image hash.',
    'Gate modes: source_to_layer_pipeline, repaired_workflow, raw_provider_atlas, formal_admission.',
    'This is a local evidence report; it does not generate or modify atlas assets.',
  ].join('\n');
}

function getFlag(args, name, fallback = null) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  return args[index + 1] ?? fallback;
}

function requireFlag(args, name) {
  const value = getFlag(args, name);
  if (!value) throw new Error(`Missing required flag: ${name}`);
  return value;
}

function integerFlag(args, name, fallback) {
  const raw = getFlag(args, name);
  if (raw === null) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Expected positive integer for ${name}: ${raw}`);
  }
  return value;
}

function booleanFlag(args, name) {
  return args.includes(name);
}

async function readYaml(filePath) {
  return YAML.parse(await readFile(filePath, 'utf8'));
}

async function readOptionalYaml(filePath) {
  try {
    return await readYaml(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function resolveRunPath(runDir, maybePath) {
  if (!maybePath) return null;
  return path.isAbsolute(maybePath) ? maybePath : path.resolve(runDir, maybePath);
}

function resolveBasePath(baseDir, maybePath) {
  if (!maybePath) return null;
  return path.isAbsolute(maybePath) ? maybePath : path.resolve(baseDir, maybePath);
}

function verdictOf(value) {
  return value?.decision?.verdict ?? value?.verdict ?? 'not_recorded';
}

function qualityGateStatuses(quality) {
  return Object.fromEntries(Object.entries(quality?.quality_gate_results ?? {}).map(([key, value]) => [key, value.status ?? 'not_recorded']));
}

function deriveSourceToLayerPipeline({
  manifest,
  producerVerdict,
  repairedWorkflow,
  normalizedAtlas,
  transparentAtlas,
  atlasQualityVerdict,
  workflowBenchVerdict,
}) {
  const recorded = manifest.quality_summary?.source_to_layer_pipeline;
  if (recorded) return recorded;
  return producerVerdict === 'admit'
    && repairedWorkflow === 'pass'
    && normalizedAtlas === 'pass'
    && transparentAtlas === 'pass'
    && atlasQualityVerdict === 'pass'
    && workflowBenchVerdict === 'pass'
    ? 'pass'
    : 'fail';
}

function deriveRawProviderAtlasAdmission({ manifest, producerVerdict, upstreamImage2Atlas }) {
  const recorded = manifest.quality_summary?.raw_provider_atlas_admission;
  if (recorded) return recorded;
  return producerVerdict === 'admit' && upstreamImage2Atlas === 'pass' ? 'pass' : 'fail';
}

function measuredBounds(quality) {
  return Object.fromEntries((quality?.layer_measurements ?? []).map((layer) => [
    layer.layer_id,
    layer.measured_visible_bounds_px ?? null,
  ]));
}

function duplicateSourceGroups(cases) {
  const groups = new Map();
  for (const item of cases) {
    if (!item.source_hash) continue;
    if (!groups.has(item.source_hash)) groups.set(item.source_hash, []);
    groups.get(item.source_hash).push(item.run_id);
  }
  return [...groups.entries()]
    .filter(([, runs]) => runs.length > 1)
    .map(([source_hash, run_ids]) => ({ source_hash, run_ids }));
}

function duplicateUnderlyingSourceGroups(cases) {
  const groups = new Map();
  for (const item of cases) {
    if (!item.underlying_source_hash) continue;
    if (!groups.has(item.underlying_source_hash)) groups.set(item.underlying_source_hash, []);
    groups.get(item.underlying_source_hash).push(item.run_id);
  }
  return [...groups.entries()]
    .filter(([, runs]) => runs.length > 1)
    .map(([underlying_source_hash, run_ids]) => ({ underlying_source_hash, run_ids }));
}

function sourceSurfaceCounts(cases) {
  const counts = {};
  for (const item of cases) {
    const surface = item.source_surface ?? 'not_recorded';
    counts[surface] = (counts[surface] ?? 0) + 1;
  }
  return counts;
}

function casePasses(item, gateMode = 'formal_admission', options = {}) {
  if (options.requireLayerInputFullChain && item.layer_input_full_chain !== 'pass') {
    return false;
  }
  if (gateMode === 'repaired_workflow') {
    return item.repaired_workflow === 'pass'
      && item.normalized_atlas === 'pass'
      && item.transparent_atlas === 'pass'
      && item.atlas_quality_verdict === 'pass'
      && item.workflow_bench_verdict === 'pass';
  }
  if (gateMode === 'raw_provider_atlas') {
    return item.raw_provider_atlas_admission === 'pass'
      && item.producer_verdict === 'admit'
      && item.upstream_image2_atlas === 'pass'
      && item.atlas_quality_verdict === 'pass'
      && item.workflow_bench_verdict === 'pass';
  }
  if (gateMode === 'formal_admission') {
    return item.workflow_verdict === 'pass'
      && item.producer_verdict === 'admit'
      && item.formal_nimi2d_admission === 'pass'
      && item.atlas_quality_verdict === 'pass'
      && item.workflow_bench_verdict === 'pass';
  }
  return item.producer_verdict === 'admit'
    && item.source_to_layer_pipeline === 'pass'
    && item.atlas_quality_verdict === 'pass'
    && item.workflow_bench_verdict === 'pass';
}

function gateFailureReason(gateMode, failedCount) {
  if (gateMode === 'repaired_workflow') {
    return `${failedCount} run(s) failed repaired workflow, atlas quality, or workflow bench gates.`;
  }
  if (gateMode === 'raw_provider_atlas') {
    return `${failedCount} run(s) failed raw provider atlas diagnostic admission or downstream gates.`;
  }
  return `${failedCount} run(s) failed source-to-layer pipeline, producer evidence, or downstream gates.`;
}

function gatePassReason(gateMode, uniqueSourceCount) {
  if (gateMode === 'repaired_workflow') {
    return `${uniqueSourceCount} unique source samples passed repaired workflow and atlas quality gates.`;
  }
  if (gateMode === 'raw_provider_atlas') {
    return `${uniqueSourceCount} unique source samples passed raw provider atlas diagnostic admission and downstream gates.`;
  }
  return `${uniqueSourceCount} unique source samples passed raw-plus-repaired source-to-layer admission gates.`;
}

function decide({
  cases,
  uniqueSourceCount,
  uniqueUnderlyingSourceCount,
  minSamples,
  minUnderlyingSources,
  gateMode,
  requireLayerInputFullChain,
}) {
  if (cases.length === 0) {
    return {
      verdict: 'fail',
      reason: 'No Codex Image2 layer workflow runs were found.',
      stop_class: 'no_runs',
    };
  }
  if (uniqueSourceCount < minSamples) {
    return {
      verdict: 'fail',
      reason: `Only ${uniqueSourceCount} unique source sample(s) found; ${minSamples} required for the distribution gate.`,
      stop_class: 'insufficient_unique_samples',
    };
  }
  if (minUnderlyingSources !== null && uniqueUnderlyingSourceCount < minUnderlyingSources) {
    return {
      verdict: 'fail',
      reason: `Only ${uniqueUnderlyingSourceCount} unique underlying source sample(s) found; ${minUnderlyingSources} required for the distribution gate.`,
      stop_class: 'insufficient_unique_underlying_sources',
    };
  }
  const failed = cases.filter((item) => !casePasses(item, gateMode, { requireLayerInputFullChain }));
  if (failed.length > 0) {
    return {
      verdict: 'fail',
      reason: gateFailureReason(gateMode, failed.length),
      stop_class: 'sample_gate_failure',
    };
  }
  return {
    verdict: 'pass',
    reason: gatePassReason(gateMode, uniqueSourceCount),
    stop_class: 'none',
  };
}

async function readUnderlyingSourceEvidence(runDir, manifest) {
  const producerManifestPath = resolveRunPath(runDir, manifest.source?.producer_manifest_path)
    ?? resolveRunPath(runDir, manifest.upstream_producer?.manifest_path);
  if (!producerManifestPath) {
    return {
      underlying_source_hash: null,
      underlying_source_ref: null,
      underlying_source_evidence_status: 'producer_manifest_not_recorded',
      producer_manifest_path: null,
      provider_request_path: null,
    };
  }
  const producerManifest = await readOptionalYaml(producerManifestPath);
  if (!producerManifest) {
    return {
      underlying_source_hash: null,
      underlying_source_ref: null,
      underlying_source_evidence_status: 'producer_manifest_missing',
      producer_manifest_path: producerManifestPath,
      provider_request_path: null,
    };
  }
  const providerRequestPath = resolveBasePath(
    path.dirname(producerManifestPath),
    producerManifest.producer?.request?.path,
  );
  if (!providerRequestPath) {
    return {
      underlying_source_hash: null,
      underlying_source_ref: null,
      underlying_source_evidence_status: 'provider_request_not_recorded',
      producer_manifest_path: producerManifestPath,
      provider_request_path: null,
    };
  }
  const providerRequest = await readOptionalYaml(providerRequestPath);
  if (!providerRequest) {
    return {
      underlying_source_hash: null,
      underlying_source_ref: null,
      underlying_source_evidence_status: 'provider_request_missing',
      producer_manifest_path: producerManifestPath,
      provider_request_path: providerRequestPath,
    };
  }
  const sourceHash = providerRequest.inputs?.source_image_sha256 ?? null;
  return {
    underlying_source_hash: sourceHash,
    underlying_source_ref: providerRequest.inputs?.source_image_ref ?? null,
    underlying_source_evidence_status: sourceHash ? 'recorded' : 'source_image_sha256_not_recorded',
    producer_manifest_path: producerManifestPath,
    provider_request_path: providerRequestPath,
  };
}

async function summarizeRun(runDir) {
  const manifestPath = path.join(runDir, 'codex-image2-layer-workflow.yaml');
  const manifest = await readOptionalYaml(manifestPath);
  if (!manifest) return null;

  const atlasQualityPath = resolveRunPath(runDir, manifest.atlas_quality?.report_path)
    ?? path.join(runDir, 'quality', 'atlas-quality.yaml');
  const atlasQuality = await readOptionalYaml(atlasQualityPath);
  const workflowReportPath = resolveRunPath(runDir, manifest.workflow_bench?.report_path)
    ?? path.join(runDir, 'output', 'workflow-report.yaml');
  const workflowReport = await readOptionalYaml(workflowReportPath);
  const bounds = measuredBounds(atlasQuality);
  const producerVerdict = manifest.upstream_producer?.verdict ?? 'not_recorded';
  const repairedWorkflow = manifest.quality_summary?.repaired_workflow ?? 'not_recorded';
  const upstreamImage2Atlas = manifest.quality_summary?.upstream_image2_atlas ?? verdictOf(manifest.upstream_quality);
  const normalizedAtlas = manifest.quality_summary?.normalized_atlas ?? verdictOf(manifest.normalized_quality);
  const transparentAtlas = manifest.quality_summary?.transparent_atlas ?? verdictOf(manifest.transparent_atlas);
  const atlasQualityVerdict = verdictOf(atlasQuality ?? manifest.atlas_quality);
  const workflowBenchVerdict = workflowReport?.decision?.verdict ?? manifest.workflow_bench?.decision?.verdict ?? 'not_recorded';
  const layerInputFullChain = manifest.quality_summary?.layer_input_full_chain
    ?? manifest.layer_input_full_chain?.decision?.verdict
    ?? 'not_recorded';
  const sourceToLayerPipeline = deriveSourceToLayerPipeline({
    manifest,
    producerVerdict,
    repairedWorkflow,
    normalizedAtlas,
    transparentAtlas,
    atlasQualityVerdict,
    workflowBenchVerdict,
  });
  const rawProviderAtlasAdmission = deriveRawProviderAtlasAdmission({
    manifest,
    producerVerdict,
    upstreamImage2Atlas,
  });
  const underlyingSource = await readUnderlyingSourceEvidence(runDir, manifest);

  return {
    run_id: path.basename(runDir),
    manifest_path: manifestPath,
    source_hash: manifest.source?.file_sha256 ?? null,
    source_surface: manifest.source?.surface ?? null,
    underlying_source_hash: underlyingSource.underlying_source_hash,
    underlying_source_ref: underlyingSource.underlying_source_ref,
    underlying_source_evidence_status: underlyingSource.underlying_source_evidence_status,
    provider_request_path: underlyingSource.provider_request_path,
    producer_verdict: producerVerdict,
    workflow_verdict: manifest.verdict ?? 'not_recorded',
    repaired_workflow: repairedWorkflow,
    layer_input_full_chain: layerInputFullChain,
    source_to_layer_pipeline: sourceToLayerPipeline,
    raw_provider_atlas_admission: rawProviderAtlasAdmission,
    formal_nimi2d_admission: manifest.quality_summary?.formal_nimi2d_admission ?? 'not_recorded',
    formal_admission_model: manifest.quality_summary?.formal_admission_model ?? 'not_recorded',
    upstream_image2_atlas: upstreamImage2Atlas,
    normalized_atlas: normalizedAtlas,
    transparent_atlas: transparentAtlas,
    atlas_quality_verdict: atlasQualityVerdict,
    workflow_bench_verdict: workflowBenchVerdict,
    hard_gate_results: atlasQuality?.hard_gate_results ?? {},
    quality_gate_results: qualityGateStatuses(atlasQuality),
    failure_attribution: atlasQuality?.failure_attribution ?? manifest.atlas_quality?.failure_attribution ?? {},
    measured_bounds_px: bounds,
    mouth_bounds_px: bounds.layer_mouth ?? null,
    eye_bounds_px: bounds.layer_eye ?? null,
    outfit_bounds_px: bounds.layer_outfit ?? null,
    manual_correction_minutes: atlasQuality?.tracking_metrics?.manual_correction_minutes ?? { status: 'not_measured' },
  };
}

async function summarizeRuns(runsDir, options = {}) {
  const absoluteRunsDir = path.resolve(runsDir);
  const entries = await readdir(absoluteRunsDir, { withFileTypes: true });
  const runDirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(absoluteRunsDir, entry.name))
    .sort((left, right) => left.localeCompare(right));
  const allCases = (await Promise.all(runDirs.map((runDir) => summarizeRun(runDir)))).filter(Boolean);
  const sourceSurface = options.sourceSurface ?? null;
  const cases = sourceSurface
    ? allCases.filter((item) => item.source_surface === sourceSurface)
    : allCases;
  const uniqueSourceHashes = [...new Set(cases.map((item) => item.source_hash).filter(Boolean))];
  const uniqueUnderlyingSourceHashes = [...new Set(cases.map((item) => item.underlying_source_hash).filter(Boolean))];
  const minSamples = options.minSamples ?? 5;
  const minUnderlyingSources = options.minUnderlyingSources ?? null;
  const gateMode = options.gateMode ?? 'source_to_layer_pipeline';
  const requireLayerInputFullChain = options.requireLayerInputFullChain ?? false;
  const decision = decide({
    cases,
    uniqueSourceCount: uniqueSourceHashes.length,
    uniqueUnderlyingSourceCount: uniqueUnderlyingSourceHashes.length,
    minSamples,
    minUnderlyingSources,
    gateMode,
    requireLayerInputFullChain,
  });

  return {
    manifest_kind: 'nimi.nimi2d.codex-image2.distribution-report',
    schema_version: 1,
    runs_dir: absoluteRunsDir,
    gate_mode: gateMode,
    filters: {
      source_surface: sourceSurface,
    },
    min_unique_samples: minSamples,
    min_unique_underlying_sources: minUnderlyingSources,
    require_layer_input_full_chain: requireLayerInputFullChain,
    summary: {
      total_run_count: allCases.length,
      run_count: cases.length,
      excluded_run_count: allCases.length - cases.length,
      unique_source_sample_count: uniqueSourceHashes.length,
      unique_underlying_source_sample_count: uniqueUnderlyingSourceHashes.length,
      underlying_source_not_recorded_count: cases.filter((item) => !item.underlying_source_hash).length,
      layer_input_full_chain_pass_count: cases.filter((item) => item.layer_input_full_chain === 'pass').length,
      passing_run_count: cases.filter((item) => casePasses(item, gateMode, { requireLayerInputFullChain })).length,
      source_surface_counts: sourceSurfaceCounts(cases),
      duplicate_source_groups: duplicateSourceGroups(cases),
      duplicate_underlying_source_groups: duplicateUnderlyingSourceGroups(cases),
    },
    decision,
    cases,
  };
}

async function runCodexImage2DistributionReportCli(args = process.argv.slice(2)) {
  if (args.includes('--help') || args.length === 0) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const runsDir = requireFlag(args, '--runs-dir');
  const outPath = path.resolve(requireFlag(args, '--out'));
  const report = await summarizeRuns(runsDir, {
    minSamples: integerFlag(args, '--min-samples', 5),
    minUnderlyingSources: integerFlag(args, '--min-underlying-sources', null),
    requireLayerInputFullChain: booleanFlag(args, '--require-layer-input-full-chain'),
    sourceSurface: getFlag(args, '--source-surface') ?? undefined,
    gateMode: getFlag(args, '--gate-mode') ?? undefined,
  });
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, YAML.stringify(report), 'utf8');
  process.stdout.write(`${JSON.stringify({
    status: 'ok',
    kind: 'codex_image2_distribution_report',
    outPath,
    decision: report.decision,
    runCount: report.summary.run_count,
    uniqueSourceSampleCount: report.summary.unique_source_sample_count,
    uniqueUnderlyingSourceSampleCount: report.summary.unique_underlying_source_sample_count,
    layerInputFullChainPassCount: report.summary.layer_input_full_chain_pass_count,
  }, null, 2)}\n`);
  if (report.decision.verdict !== 'pass') {
    process.exitCode = 1;
  }
}

export { summarizeRuns, runCodexImage2DistributionReportCli };
