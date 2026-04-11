/**
 * check-parentos-ai-boundary.ts
 * Validates AI safety boundaries:
 * - banned wording stays out of executable source contexts
 * - reports runtime use is allowed only on the admitted report narration surface
 * - journal AI tagging stays on local closed-set extraction
 * - voice STT stays on the typed local transcription surface
 * - profile AI surfaces stay inside the admitted local summary / OCR boundaries
 * - advisor chat retains reviewed-domain gating and structured fallback markers
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const TABLES = resolve(ROOT, 'spec/kernel/tables');
const SRC = resolve(ROOT, 'src/shell/renderer');

const BANNED_WORDS = [
  '发育迟缓',
  '异常',
  '障碍',
  '应该吃',
  '建议用药',
  '建议服用',
  '推荐治疗',
  '落后',
  '危险',
  '警告',
];

export interface SourceFile {
  path: string;
  content: string;
}

function uniqueSorted(values: Iterable<string>) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function relativeToRoot(path: string, rootPath: string) {
  return path.replace(rootPath + '/', '').replace(rootPath + '\\', '');
}

function fileHasRuntimeCall(content: string) {
  return content.includes('runtime.ai.text.generate')
    || content.includes('runtime.ai.text.stream')
    || content.includes('media.stt.transcribe');
}

function extractQuotedSurfaceIds(content: string) {
  const surfaces: string[] = [];
  for (const match of content.matchAll(/surfaceId:\s*(['"])([^'"]+)\1/g)) {
    if (match[2]) surfaces.push(match[2]);
  }
  return uniqueSorted(surfaces);
}

export function collectTsFiles(dir: string): string[] {
  const files: string[] = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== 'gen' && entry.name !== 'node_modules') {
        files.push(...collectTsFiles(full));
      } else if (
        entry.isFile()
        && /\.(ts|tsx)$/.test(entry.name)
        && !entry.name.endsWith('.gen.ts')
        && !entry.name.endsWith('.test.ts')
        && !entry.name.endsWith('.test.tsx')
      ) {
        files.push(full);
      }
    }
  } catch {
    return files;
  }
  return files;
}

export function findUnexpectedRuntimeFileErrors(input: {
  files: SourceFile[];
  rootPath: string;
  admittedRuntimeFiles: string[];
  label: string;
}) {
  const errors: string[] = [];
  const admittedRuntimeFiles = new Set(input.admittedRuntimeFiles);

  for (const file of input.files) {
    if (!fileHasRuntimeCall(file.content)) continue;
    const relPath = relativeToRoot(file.path, input.rootPath);
    if (!admittedRuntimeFiles.has(relPath)) {
      errors.push(`Unexpected ${input.label} AI runtime use in ${relPath}`);
    }
  }

  return errors;
}

export function collectBannedWordViolations(files: SourceFile[], rootPath: string) {
  const errors: string[] = [];

  for (const file of files) {
    const relPath = relativeToRoot(file.path, rootPath);
    const isSafetyFilterSource =
      relPath.endsWith('src/shell/renderer/engine/ai-safety-filter.ts')
      || relPath.endsWith('src\\shell\\renderer\\engine\\ai-safety-filter.ts');

    for (const word of BANNED_WORDS) {
      const lines = file.content.split('\n');
      let inTemplateLiteral = false;
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const backtickCount = (line.match(/`/g) ?? []).length;
        if (backtickCount % 2 === 1) inTemplateLiteral = !inTemplateLiteral;

        if (!line.includes(word) || isSafetyFilterSource) continue;

        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
        if (inTemplateLiteral) continue;
        const executableSlice = line.replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '');
        if (!executableSlice.includes(word)) continue;
        if (trimmed.includes('不得出现') || trimmed.includes('禁止') || trimmed.includes('BANNED')) continue;

        errors.push(`Banned word '${word}' found in ${relPath}:${index + 1} (non-string, non-comment context)`);
      }
    }
  }

  return errors;
}

export function findReportsBoundaryErrors(input: {
  routesSource: string;
  reportFiles: SourceFile[];
}) {
  const errors: string[] = [];

  if (!input.routesSource.includes('path="/reports"')) {
    errors.push('/reports route is missing from routes.tsx');
  }

  for (const file of input.reportFiles) {
    const usesRuntime = file.content.includes('runtime.ai.text.generate') || file.content.includes('runtime.ai.text.stream');
    if (!usesRuntime) continue;

    const hasReportSurfaceMarker =
      file.content.includes("surfaceId: 'parentos.report'")
      || file.content.includes('surfaceId: "parentos.report"');

    if (!hasReportSurfaceMarker) {
      errors.push(`${file.path} uses report runtime without the parentos.report surface marker`);
    }

    if (!file.content.includes('filterAIResponse')) {
      errors.push(`${file.path} uses report runtime without AI safety filtering`);
    }
  }

  return errors;
}

export function findJournalBoundaryErrors(journalAiSource: string) {
  const errors: string[] = [];

  if (!journalAiSource.includes('runtime.ai.text.generate')) {
    errors.push('journal AI tagging is missing runtime.ai.text.generate extraction path');
  }

  if (journalAiSource.includes('runtime.ai.text.stream')) {
    errors.push('journal AI tagging must stay on closed-set extraction only');
  }

  if (!/route:\s*aiParams\.route\s*\?\?\s*['"]local['"]/.test(journalAiSource)) {
    errors.push('journal AI tagging must default to route: local');
  }

  if (!journalAiSource.includes("surfaceId: 'parentos.journal.ai-tagging'")) {
    errors.push('journal AI tagging is missing the parentos.journal.ai-tagging surface marker');
  }

  for (const marker of [
    'unknown dimensionId',
    'unsupported tag',
    'response is missing tags',
  ]) {
    if (!journalAiSource.includes(marker)) {
      errors.push(`journal AI tagging is missing fail-close marker: ${marker}`);
    }
  }

  return errors;
}

export function findVoiceBoundaryErrors(voiceObservationSource: string) {
  const errors: string[] = [];

  for (const marker of [
    'media.stt.transcribe',
    "surfaceId: 'parentos.journal.voice-observation'",
    "route: aiParams.route ?? 'local'",
    'missing transcript text',
  ]) {
    if (!voiceObservationSource.includes(marker)) {
      errors.push(`voice observation runtime is missing boundary marker: ${marker}`);
    }
  }

  return errors;
}

export function findProfileBoundaryErrors(input: {
  profileFiles: SourceFile[];
  rootPath: string;
}) {
  const errors = findUnexpectedRuntimeFileErrors({
    files: input.profileFiles,
    rootPath: input.rootPath,
    admittedRuntimeFiles: [
      'src/shell/renderer/features/profile/ai-summary-card.tsx',
      'src/shell/renderer/features/profile/checkup-ocr.ts',
      'src/shell/renderer/features/profile/medical-events-page.tsx',
    ],
    label: 'profile',
  });

  const relFiles = new Map(
    input.profileFiles.map((file) => [relativeToRoot(file.path, input.rootPath), file]),
  );

  const summaryFile = relFiles.get('src/shell/renderer/features/profile/ai-summary-card.tsx');
  if (summaryFile?.content.includes('runtime.ai.text.generate')) {
    if (!summaryFile.content.includes('parentos.profile.summary.')) {
      errors.push('ai-summary-card.tsx is missing the parentos.profile.summary.* surface marker');
    }
    if (!summaryFile.content.includes('filterAIResponse')) {
      errors.push('ai-summary-card.tsx uses runtime summaries without AI safety filtering');
    }
    if (!summaryFile.content.includes('dataContext')) {
      errors.push('ai-summary-card.tsx must build summaries from current local page dataContext only');
    }
  }

  const checkupOcrFile = relFiles.get('src/shell/renderer/features/profile/checkup-ocr.ts');
  if (checkupOcrFile?.content.includes('runtime.ai.text.generate')) {
    if (!checkupOcrFile.content.includes("surfaceId: 'parentos.profile.checkup-ocr'")) {
      errors.push('checkup-ocr.ts is missing the parentos.profile.checkup-ocr surface marker');
    }
    if (!checkupOcrFile.content.includes("type: 'image_url'")) {
      errors.push('checkup-ocr.ts must keep image OCR on the explicit image_url input path');
    }
    if (!checkupOcrFile.content.includes('parseOCRMeasurementExtraction')) {
      errors.push('checkup-ocr.ts must fail closed through the typed OCR extraction parser');
    }
  }

  const medicalEventsFile = relFiles.get('src/shell/renderer/features/profile/medical-events-page.tsx');
  if (medicalEventsFile?.content.includes('runtime.ai.text.generate')) {
    const runtimeCallCount = (medicalEventsFile.content.match(/runtime\.ai\.text\.generate\(/g) ?? []).length;
    const surfaceIds = extractQuotedSurfaceIds(medicalEventsFile.content)
      .filter((surfaceId) => surfaceId.startsWith('parentos.medical.'));
    const allowedSurfaceIds = new Set([
      'parentos.medical.smart-insight',
      'parentos.medical.ocr-intake',
      'parentos.medical.event-analysis',
    ]);

    if (surfaceIds.length !== runtimeCallCount) {
      errors.push('medical-events-page.tsx must tag every runtime call with an admitted parentos.medical.* surfaceId');
    }

    for (const surfaceId of surfaceIds) {
      if (!allowedSurfaceIds.has(surfaceId)) {
        errors.push(`medical-events-page.tsx uses unadmitted medical AI surface ${surfaceId}`);
      }
    }

    if (!medicalEventsFile.content.includes('filterAIResponse')) {
      errors.push('medical-events-page.tsx uses medical AI summaries without AI safety filtering');
    }
    if (!medicalEventsFile.content.includes("type: 'image_url'")) {
      errors.push('medical-events-page.tsx OCR intake must keep explicit image_url input');
    }
    if (!medicalEventsFile.content.includes('JSON.parse')) {
      errors.push('medical-events-page.tsx OCR intake must parse structured JSON output before prefilling');
    }
  }

  return errors;
}

export function findAdvisorBoundaryErrors(advisorPageSource: string) {
  const errors: string[] = [];

  for (const marker of [
    'REVIEWED_DOMAINS',
    'NEEDS_REVIEW_DOMAINS',
    'filterAIResponse',
    'inferRequestedDomains',
    'canUseAdvisorRuntime',
    'buildStructuredAdvisorFallback',
    'appendAdvisorSources',
  ]) {
    if (!advisorPageSource.includes(marker)) {
      errors.push(`advisor-page.tsx is missing AI boundary marker: ${marker}`);
    }
  }

  const hasReviewedDomainRuntimePath =
    advisorPageSource.includes('runtime.ai.text.stream')
    || advisorPageSource.includes('rt.ai.text.stream');

  if (!hasReviewedDomainRuntimePath) {
    errors.push('advisor-page.tsx is missing reviewed-domain runtime generation path');
  }

  return errors;
}

function pass(message: string) {
  console.log(`  PASS: ${message}`);
}

function fail(message: string) {
  console.error(`  FAIL: ${message}`);
}

export function runAiBoundaryCheck() {
  const scanDirs = [
    resolve(SRC, 'engine'),
    resolve(SRC, 'features/advisor'),
    resolve(SRC, 'features/reports'),
    resolve(SRC, 'features/journal'),
    resolve(SRC, 'features/profile'),
  ];

  const scannedFiles = scanDirs.flatMap((dir) => collectTsFiles(dir))
    .map((path) => ({ path, content: readFileSync(path, 'utf-8') }));

  const bannedWordErrors = collectBannedWordViolations(scannedFiles, ROOT);

  const advisorFiles = collectTsFiles(resolve(SRC, 'features/advisor'))
    .map((path) => ({ path, content: readFileSync(path, 'utf-8') }));

  const reportFiles = collectTsFiles(resolve(SRC, 'features/reports'))
    .map((path) => ({ path, content: readFileSync(path, 'utf-8') }));

  const journalFiles = collectTsFiles(resolve(SRC, 'features/journal'))
    .map((path) => ({ path, content: readFileSync(path, 'utf-8') }));

  const profileFiles = collectTsFiles(resolve(SRC, 'features/profile'))
    .map((path) => ({ path, content: readFileSync(path, 'utf-8') }));

  const reportErrors = [
    ...findUnexpectedRuntimeFileErrors({
      files: reportFiles,
      rootPath: ROOT,
      admittedRuntimeFiles: [
        'src/shell/renderer/features/reports/narrative-prompt.ts',
      ],
      label: 'reports',
    }),
    ...findReportsBoundaryErrors({
      routesSource: readFileSync(resolve(SRC, 'app-shell/routes.tsx'), 'utf-8'),
      reportFiles,
    }),
  ];

  const journalErrors = [
    ...findUnexpectedRuntimeFileErrors({
      files: journalFiles,
      rootPath: ROOT,
      admittedRuntimeFiles: [
        'src/shell/renderer/features/journal/ai-journal-tagging.ts',
        'src/shell/renderer/features/journal/voice-observation-runtime.ts',
      ],
      label: 'journal',
    }),
    ...findJournalBoundaryErrors(
      readFileSync(resolve(SRC, 'features/journal/ai-journal-tagging.ts'), 'utf-8'),
    ),
  ];

  const voiceErrors = findVoiceBoundaryErrors(
    readFileSync(resolve(SRC, 'features/journal/voice-observation-runtime.ts'), 'utf-8'),
  );

  const advisorErrors = [
    ...findUnexpectedRuntimeFileErrors({
      files: advisorFiles,
      rootPath: ROOT,
      admittedRuntimeFiles: [
        'src/shell/renderer/features/advisor/advisor-page.tsx',
      ],
      label: 'advisor',
    }),
    ...findAdvisorBoundaryErrors(
      readFileSync(resolve(SRC, 'features/advisor/advisor-page.tsx'), 'utf-8'),
    ),
  ];

  const profileErrors = findProfileBoundaryErrors({
    profileFiles,
    rootPath: ROOT,
  });

  const ksData = parseYaml(
    readFileSync(resolve(TABLES, 'knowledge-source-readiness.yaml'), 'utf-8'),
  ) as { sources: Array<{ domain: string; status: string }> };

  const needsReview = ksData.sources.filter((source) => source.status === 'needs-review').map((source) => source.domain);
  const reviewed = ksData.sources.filter((source) => source.status === 'reviewed').map((source) => source.domain);

  let knowledgeSourceError: string | null = null;
  try {
    const generatedReadiness = readFileSync(
      resolve(SRC, 'knowledge-base/gen/knowledge-source-readiness.gen.ts'),
      'utf-8',
    );
    if (!generatedReadiness.includes('NEEDS_REVIEW_DOMAINS') || !generatedReadiness.includes('REVIEWED_DOMAINS')) {
      knowledgeSourceError = 'knowledge-source-readiness.gen.ts is missing domain classification exports';
    }
  } catch {
    knowledgeSourceError = 'knowledge-source-readiness.gen.ts not found — run pnpm generate:knowledge-base';
  }

  return {
    bannedWordErrors,
    reportErrors,
    journalErrors,
    voiceErrors,
    advisorErrors,
    profileErrors,
    reviewed,
    needsReview,
    knowledgeSourceError,
  };
}

function isMainModule() {
  return Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  const result = runAiBoundaryCheck();

  console.log('\n=== Banned Words in Source ===\n');
  if (result.bannedWordErrors.length === 0) {
    pass('No banned wording appears in executable source contexts');
  } else {
    for (const message of result.bannedWordErrors) fail(message);
  }

  console.log('\n=== Reports Surface Boundary ===\n');
  if (result.reportErrors.length === 0) {
    pass('reports runtime use stays inside the admitted narrative surface');
  } else {
    for (const message of result.reportErrors) fail(message);
  }

  console.log('\n=== Journal AI Tagging Boundary ===\n');
  if (result.journalErrors.length === 0) {
    pass('journal AI tagging remains local, closed-set, and fail-close');
  } else {
    for (const message of result.journalErrors) fail(message);
  }

  console.log('\n=== Voice STT Boundary ===\n');
  if (result.voiceErrors.length === 0) {
    pass('voice transcription stays on the typed local STT surface');
  } else {
    for (const message of result.voiceErrors) fail(message);
  }

  console.log('\n=== Advisor Boundary Implementation ===\n');
  if (result.advisorErrors.length === 0) {
    pass('advisor chat retains reviewed-domain gating and structured fallback markers');
  } else {
    for (const message of result.advisorErrors) fail(message);
  }

  console.log('\n=== Profile AI Boundary ===\n');
  if (result.profileErrors.length === 0) {
    pass('profile AI surfaces stay inside admitted local summary and OCR boundaries');
  } else {
    for (const message of result.profileErrors) fail(message);
  }

  console.log('\n=== Knowledge Source Boundary ===\n');
  pass(`Reviewed domains: ${result.reviewed.join(', ')}`);
  pass(`Needs-review domains: ${result.needsReview.join(', ')}`);
  if (result.knowledgeSourceError) fail(result.knowledgeSourceError);
  else pass('knowledge-source-readiness.gen.ts contains domain classification exports');

  const errorCount =
    result.bannedWordErrors.length
    + result.reportErrors.length
    + result.journalErrors.length
    + result.voiceErrors.length
    + result.advisorErrors.length
    + result.profileErrors.length
    + (result.knowledgeSourceError ? 1 : 0);

  console.log(`\n${errorCount === 0 ? 'All checks passed.' : `${errorCount} error(s) found.`}\n`);
  process.exit(errorCount > 0 ? 1 : 0);
}
