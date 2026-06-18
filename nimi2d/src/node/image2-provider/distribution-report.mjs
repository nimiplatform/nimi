import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';

function usage() {
  return [
    'Usage:',
    '  node nimi2d/experiments/image-to-layer-input/workflows/codex-image2-distribution-report.mjs \\',
    '    --runs-dir <image2-runs-dir> --out <report.yaml> [--min-samples <n>] [--source-surface <surface>]',
    '',
    'Summarizes Codex Image2 layer workflow runs by unique source image hash.',
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

function verdictOf(value) {
  return value?.decision?.verdict ?? value?.verdict ?? 'not_recorded';
}

function qualityGateStatuses(quality) {
  return Object.fromEntries(Object.entries(quality?.quality_gate_results ?? {}).map(([key, value]) => [key, value.status ?? 'not_recorded']));
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

function sourceSurfaceCounts(cases) {
  const counts = {};
  for (const item of cases) {
    const surface = item.source_surface ?? 'not_recorded';
    counts[surface] = (counts[surface] ?? 0) + 1;
  }
  return counts;
}

function casePasses(item, gateMode = 'formal_admission') {
  if (gateMode === 'repaired_workflow') {
    return item.repaired_workflow === 'pass'
      && item.normalized_atlas === 'pass'
      && item.transparent_atlas === 'pass'
      && item.atlas_quality_verdict === 'pass'
      && item.workflow_bench_verdict === 'pass';
  }
  return item.workflow_verdict === 'pass'
    && item.formal_nimi2d_admission === 'pass'
    && item.atlas_quality_verdict === 'pass'
    && item.workflow_bench_verdict === 'pass';
}

function decide({ cases, uniqueSourceCount, minSamples, gateMode }) {
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
  const failed = cases.filter((item) => !casePasses(item, gateMode));
  if (failed.length > 0) {
    return {
      verdict: 'fail',
      reason: gateMode === 'repaired_workflow'
        ? `${failed.length} run(s) failed repaired workflow, atlas quality, or workflow bench gates.`
        : `${failed.length} run(s) failed workflow, formal admission, or atlas quality gates.`,
      stop_class: 'sample_gate_failure',
    };
  }
  return {
    verdict: 'pass',
    reason: gateMode === 'repaired_workflow'
      ? `${uniqueSourceCount} unique source samples passed repaired workflow and atlas quality gates.`
      : `${uniqueSourceCount} unique source samples passed formal admission and atlas quality gates.`,
    stop_class: 'none',
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

  return {
    run_id: path.basename(runDir),
    manifest_path: manifestPath,
    source_hash: manifest.source?.file_sha256 ?? null,
    source_surface: manifest.source?.surface ?? null,
    producer_verdict: manifest.upstream_producer?.verdict ?? 'not_recorded',
    workflow_verdict: manifest.verdict ?? 'not_recorded',
    repaired_workflow: manifest.quality_summary?.repaired_workflow ?? 'not_recorded',
    formal_nimi2d_admission: manifest.quality_summary?.formal_nimi2d_admission ?? 'not_recorded',
    upstream_image2_atlas: manifest.quality_summary?.upstream_image2_atlas ?? verdictOf(manifest.upstream_quality),
    normalized_atlas: manifest.quality_summary?.normalized_atlas ?? verdictOf(manifest.normalized_quality),
    transparent_atlas: manifest.quality_summary?.transparent_atlas ?? verdictOf(manifest.transparent_atlas),
    atlas_quality_verdict: verdictOf(atlasQuality ?? manifest.atlas_quality),
    workflow_bench_verdict: workflowReport?.decision?.verdict ?? manifest.workflow_bench?.decision?.verdict ?? 'not_recorded',
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
  const minSamples = options.minSamples ?? 5;
  const gateMode = options.gateMode ?? 'formal_admission';
  const decision = decide({
    cases,
    uniqueSourceCount: uniqueSourceHashes.length,
    minSamples,
    gateMode,
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
    summary: {
      total_run_count: allCases.length,
      run_count: cases.length,
      excluded_run_count: allCases.length - cases.length,
      unique_source_sample_count: uniqueSourceHashes.length,
      passing_run_count: cases.filter((item) => casePasses(item, gateMode)).length,
      source_surface_counts: sourceSurfaceCounts(cases),
      duplicate_source_groups: duplicateSourceGroups(cases),
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
    sourceSurface: getFlag(args, '--source-surface') ?? undefined,
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
  }, null, 2)}\n`);
  if (report.decision.verdict !== 'pass') {
    process.exitCode = 1;
  }
}

export { summarizeRuns, runCodexImage2DistributionReportCli };
