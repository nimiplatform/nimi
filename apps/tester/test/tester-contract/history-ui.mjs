import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
  RUNTIME_EXECUTION_MODE_STREAM,
  RUNTIME_EXECUTION_MODE_SYNC,
  RUNTIME_ROUTE_POLICY_CLOUD,
  RUNTIME_ROUTE_POLICY_LOCAL,
  RUNTIME_SCENARIO_TYPE_TEXT_EMBED,
  RUNTIME_SCENARIO_TYPE_TEXT_GENERATE,
  RUNTIME_SCHEDULING_DENIED,
  cleanupBehaviorModules,
  createMemoryStorage,
  importBehaviorModule,
  listSourceFiles,
  read,
  readTesterAiTestingSurface,
  readTesterKitComponentGallerySurface,
  readTesterRuntimeInvokersSurface,
  root,
  runnableSchedulingResponse,
  textEmbedScenarioResponse,
  textGenerateScenarioResponse,
  textScenarioStream,
} from './helpers.mjs';

test.after(cleanupBehaviorModules);

test('tester run history is the per-capability evidence surface (no standalone Evidence module)', () => {
  const capabilities = readTesterAiTestingSurface(root);
  const historyStore = read('src/tester/tester-history.ts');
  const appStorage = read('src/tester/tester-app-storage.ts');
  const workbench = read('src/tester/tester-workbench.tsx');

  // Evidence is folded into each capability's test panel as recent local runs,
  // rendered from the app-owned history store — not a separate Evidence route.
  assert.match(capabilities, /function CapabilityRunHistory/);
  assert.match(capabilities, /Recent runs/);
  assert.match(capabilities, /getTesterRunStatusLabel/);
  assert.match(capabilities, /getTesterRunResultSummary/);
  assert.match(capabilities, /TextStudioHistorySnapshotBody/);
  assert.match(capabilities, /if \(records\.length === 0\) return null/);
  assert.doesNotMatch(capabilities, /className="studio-history__empty"/);
  assert.doesNotMatch(capabilities, /No recent runs yet\./);
  assert.doesNotMatch(capabilities, /does not contain the full generated body/);
  for (const helper of ['createTesterRunHistoryResultSnapshot', 'getTesterRunResultSummary', 'getTesterRunResultTags', 'getTesterRunStatusLabel', 'getTesterRunStatusTone', 'formatTesterRunTimestamp', 'flattenTesterRunHistory']) {
    assert.match(historyStore, new RegExp(helper));
  }
  assert.match(appStorage, /resolveNimiRuntimeAppStorageRoots/);
  assert.match(appStorage, /attachNimiRuntimeAppDataStorageRoot/);
  assert.match(appStorage, /attachNimiRuntimeAppStorageRoots/);
  assert.doesNotMatch(appStorage, /resolveRuntimeAppStorageRoots/);
  assert.doesNotMatch(appStorage, /attachRuntimeAppDataStorageRoot/);
  assert.doesNotMatch(appStorage, /attachRuntimeAppStorageRoots/);
  assert.doesNotMatch(appStorage, /\.nimi|nimi\.json|runtime\/config|join\(/);

  // Single-level capability workspace: no app-lab / evidence / settings routes.
  assert.match(workbench, /WorkbenchView/);
  assert.doesNotMatch(workbench, /SectionEvidence|SectionSettings|SectionAppLab/);
});

test('tester run history timestamps use English date labels and omit today date labels', () => {
  const historyStore = read('src/tester/tester-history.ts');

  assert.match(historyStore, /new Intl\.DateTimeFormat\('en-US'/);
  assert.match(historyStore, /hourCycle:\s*'h23'/);
  assert.match(historyStore, /formatTesterRunTimestamp\(value: string, now = new Date\(\)\)/);
  assert.match(historyStore, /if \(isSameLocalCalendarDate\(date, now\)\) return testerRunTimeFormatter\.format\(date\);/);
  assert.match(historyStore, /formatTesterRunHistoryTimestamp\(value: string, now = new Date\(\)\)/);
  assert.match(historyStore, /return testerRunDateFormatter\.format\(date\);/);
  assert.match(historyStore, /return testerRunDateWithYearFormatter\.format\(date\);/);
  assert.doesNotMatch(historyStore, /toLocaleString\(\[\]/);
});

test('right-side capability history uses date-only labels for older runs', () => {
  const capabilities = readTesterAiTestingSurface(root);

  assert.match(capabilities, /formatTesterRunHistoryTimestamp/);
  assert.match(capabilities, /<time dateTime=\{record\.createdAt\}>\{formatTesterRunHistoryTimestamp\(record\.createdAt\)\}<\/time>/);
  assert.match(capabilities, /formatTesterRunHistoryTimestamp\(record\.createdAt\), metrics/);
});

test('tester run history rows prioritize prompt title, recency groups, and run metrics', () => {
  const capabilities = readTesterAiTestingSurface(root);
  const historyStore = read('src/tester/tester-history.ts');
  const workbench = read('src/tester/workbench/section-ai-testing.tsx');
  const surface = read('src/tester/workbench/section-ai-testing-surface.tsx');
  const styles = read('src/tester/tester-workbench.css');

  assert.match(historyStore, /function formatTesterTokenUsage/);
  assert.match(historyStore, /export function getTesterRunModelLabel/);
  assert.match(historyStore, /export function getTesterRunModelSource/);
  assert.match(historyStore, /cleanTesterRunModelName/);
  assert.match(historyStore, /\^\(local-import\|local\|cloud\)\\\//);
  assert.match(historyStore, /routeDecisionModelSource/);
  assert.match(historyStore, /export function getTesterRunMetricSummary/);
  assert.match(historyStore, /export type TesterRunConfigSnapshot/);
  assert.match(historyStore, /runConfig\?: TesterRunConfigSnapshot/);
  assert.match(historyStore, /record\.runConfig\?\.target\.modelLabel/);
  assert.match(historyStore, /record\.runConfig\?\.target\.source/);
  assert.match(historyStore, /\| 'params'/);
  assert.match(historyStore, /record\.runConfig\?\.target\.paramsSummary/);
  assert.match(historyStore, /toneSelected\?: boolean/);
  assert.match(historyStore, /lengthSelected\?: boolean/);
  assert.match(historyStore, /export function getTesterRunPromptControlFacts/);
  assert.match(historyStore, /export function getTesterRunConfigParamRows/);
  assert.match(historyStore, /Prompt controls/);
  assert.match(historyStore, /\{ key: 'tone', label: 'Tone'/);
  assert.match(historyStore, /\{ key: 'length', label: 'Length'/);
  assert.match(historyStore, /Temperature/);
  assert.match(historyStore, /Max Tokens/);
  assert.match(historyStore, /Top P/);
  assert.match(historyStore, /Top K/);
  assert.match(historyStore, /Timeout/);
  assert.match(historyStore, /Stop Sequences/);
  assert.match(historyStore, /Advanced settings/);
  assert.match(historyStore, /JSON\.stringify\(value\)/);
  assert.doesNotMatch(historyStore, /effectiveTesterModelParamsForCapability/);
  assert.doesNotMatch(historyStore, /TEXT_MODEL_EFFECTIVE_DEFAULTS/);
  assert.doesNotMatch(historyStore, /export function getTesterRunConfigTargetFacts/);
  assert.doesNotMatch(historyStore, /export function getTesterRunConfigPromptFacts/);
  assert.doesNotMatch(historyStore, /pushFact\(facts, 'Context', 'Attached'\)/);
  assert.match(historyStore, /modelResolved/);
  assert.match(historyStore, /inputTokens/);
  assert.match(historyStore, /outputTokens/);
  assert.match(historyStore, /totalTokens/);
  assert.doesNotMatch(historyStore, /\bin \/.*\bout/);
  assert.doesNotMatch(historyStore, /\bout \/.*\btotal/);
  assert.match(capabilities, /historyLabelForRun/);
  assert.match(capabilities, /historyDetailForRun/);
  assert.match(capabilities, /historyGroupLabel/);
  assert.match(capabilities, /groupHistoryRecords/);
  assert.match(capabilities, /getTesterRunModelSource\(record\)/);
  assert.match(capabilities, /getTesterRunModelLabel\(record\)/);
  assert.match(capabilities, /function isOpaqueRuntimeModelId\(value: string\)/);
  assert.match(capabilities, /!\s*isOpaqueRuntimeModelId\(resolved\)/);
  assert.match(capabilities, /label: 'Today' \| 'Yesterday' \| 'Earlier'/);
  assert.match(workbench, /const historyRecords = history\?\.\[capability\.id\] \?\? \[\]/);
  assert.match(workbench, /const hasHistory = historyRecords\.length > 0/);
  assert.match(workbench, /hasHistory \? 'studio__workspace studio__workspace--with-history' : 'studio__workspace'/);
  assert.match(workbench, /\{hasHistory \? \(\s*<CapabilityRunHistory/s);
  assert.doesNotMatch(capabilities, /studio-history__empty/);
  assert.doesNotMatch(capabilities, /<span>\{records\.length\}<\/span>/);
  assert.match(capabilities, /className="studio-history__groups"/);
  assert.match(capabilities, /className="studio-history__group"/);
  assert.match(capabilities, /<p>\{group\.label\}<\/p>/);
  assert.match(capabilities, /studio-recent__copy/);
  assert.match(capabilities, /studio-recent__title/);
  assert.match(capabilities, /studio-recent__detail/);
  assert.match(capabilities, /createRunConfigSnapshot/);
  assert.match(capabilities, /function effectiveTextStudioPromptStyle\(target: TesterRunTargetSummary\): TextStudioPromptStyle/);
  assert.match(capabilities, /function textStudioDirectiveForTarget\(\s*target: TesterRunTargetSummary/s);
  assert.match(capabilities, /tone: selectedStudioParamValue\(target\.params, 'tone', TONE_OPTIONS, DEFAULT_TONE_VALUE\)/);
  assert.match(capabilities, /length: selectedStudioParamValue\(target\.params, 'length', LENGTH_OPTIONS, DEFAULT_LENGTH_VALUE\)/);
  assert.match(capabilities, /tone: input\.promptStyle\.tone/);
  assert.match(capabilities, /length: input\.promptStyle\.length/);
  assert.match(capabilities, /params,\s*\n\s*paramsSummary/s);
  assert.doesNotMatch(capabilities, /toneSelected: input\.toneSelected/);
  assert.doesNotMatch(capabilities, /lengthSelected: input\.lengthSelected/);
  assert.match(capabilities, /function textStudioRuntimePrompt\(prompt: string, context: string, directive\?: string\)/);
  assert.match(capabilities, /`Instructions:\\n\$\{directive\.trim\(\)\}`/);
  assert.match(capabilities, /`Context:\\n\$\{trimmedContext\}`/);
  assert.match(capabilities, /`Request:\\n\$\{prompt\}`/);
  assert.match(capabilities, /prompt: textStudioRuntimePrompt\(displayPrompt, nextContext, directive\)/);
  assert.doesNotMatch(capabilities, /directive,\s*\n\s*onPartial/);
  assert.match(capabilities, /function TextStudioPromptSettings/);
  assert.match(capabilities, /function TextStudioModelSettings/);
  assert.match(capabilities, /function TextStudioHistoryRecordResult\(\{/);
  assert.match(capabilities, /Copy as CopyIcon/);
  assert.match(capabilities, /Download as DownloadIcon/);
  assert.match(capabilities, /getTesterRunModelLabel/);
  assert.match(capabilities, /TextStudioOutputBody/);
  assert.match(surface, /function splitSubjectLine\(text: string\)/);
  assert.match(surface, /\^Subject:\\s\*\(\.\+\)\$/);
  assert.doesNotMatch(surface, /路/);
  assert.match(surface, /join\(' \/ '\)/);
  assert.match(surface, /className="studio-result__subject"/);
  assert.match(surface, /className="studio-result__text-body"/);
  assert.match(capabilities, /className="studio-result__actions studio-history-result__actions"/);
  assert.match(capabilities, /studio-history-result__status-mark--\$\{toneClass\}/);
  assert.match(capabilities, /studio-history-result__tag--\$\{toneClass\}/);
  assert.match(capabilities, /className="studio-history-result__title-stack"/);
  assert.match(capabilities, /className="studio-history-result__meta"/);
  assert.match(capabilities, /aria-label="Copy generation"/);
  assert.match(capabilities, /aria-label="Download generation"/);
  assert.match(capabilities, /aria-label="Regenerate"/);
  assert.match(capabilities, /Tooltip/);
  assert.match(surface, /<Tooltip content="Copy" placement="top">/);
  assert.match(surface, /<Tooltip content="Download" placement="top">/);
  assert.match(surface, /<Tooltip content="Regenerate" placement="top">/);
  assert.match(surface, /function studioResultModelLabel\(result: TesterCapabilityRunResult \| null, capability: TesterCapability, preferredLabel\?: string\)/);
  assert.match(surface, /const preferred = preferredLabel\?\.trim\(\)/);
  assert.match(surface, /const displayModelLabel = studioResultModelLabel\(result, capability, modelLabel\)/);
  assert.match(capabilities, /modelLabel=\{activeRun\.record \? getTesterRunModelLabel\(activeRun\.record\) : runTarget\.modelLabel\}/);
  assert.match(capabilities, /modelLabel=\{textStudioModelSummary\(headerResult, runTarget, activeRun\?\.record \?\? null\)\}/);
  assert.match(surface, /<Tooltip content=\{displayModelLabel\} placement="top" className="min-w-0">/);
  assert.match(surface, /<Tooltip content=\{historyTitleForRun\(record\)\} placement="top" className="min-w-0">/);
  assert.doesNotMatch(capabilities, /className="studio-result__action"[^>]*\btitle=/);
  assert.doesNotMatch(surface, /className="studio-result__action"[^>]*\btitle=/);
  assert.match(capabilities, /<CopyIcon size=\{16\} aria-hidden="true" \/>/);
  assert.match(capabilities, /<DownloadIcon size=\{16\} aria-hidden="true" \/>/);
  assert.match(capabilities, /<RefreshCw size=\{16\} aria-hidden="true" \/>/);
  assert.match(capabilities, /function summarizeParamRows/);
  assert.match(capabilities, /Model settings/);
  assert.match(capabilities, /className="studio-history-result__model"/);
  assert.doesNotMatch(capabilities, /className="studio-history-result__facts"/);
  assert.match(capabilities, /getTesterRunConfigParamRows\(runConfig\)/);
  assert.match(capabilities, /if \(!runConfig\) \{\s*return null;\s*\}/s);
  assert.match(capabilities, /if \(paramRows\.length === 0 && !fallbackSummary\) \{\s*return null;\s*\}/s);
  assert.doesNotMatch(capabilities, /No configured parameters|No model parameters were configured|studio-history-settings--missing/);
  assert.match(capabilities, /getTesterRunPromptControlFacts\(runConfig\)/);
  assert.match(capabilities, /record\.runConfig\?\.promptControls\.context/);
  assert.doesNotMatch(workbench, /record\.runConfig\?\.promptControls\.toneSelected/);
  assert.doesNotMatch(workbench, /record\.runConfig\?\.promptControls\.lengthSelected/);
  assert.match(capabilities, /setContext\(historyContext\)/);
  assert.doesNotMatch(capabilities, /SelectField/);
  assert.doesNotMatch(capabilities, /studio-control--tone|studio-control--length/);
  assert.doesNotMatch(capabilities, /function TextStudioRunSettings/);
  assert.doesNotMatch(capabilities, /Run settings/);
  assert.doesNotMatch(capabilities, /Model target|Target detail/);
  assert.match(capabilities, /aria-label=\{historyLabelForRun\(record\)\}/);
  assert.match(styles, /grid-template-rows:\s*auto minmax\(0,\s*1fr\)/);
  assert.match(styles, /\.studio__workspace\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
  assert.match(
    styles,
    /\.studio__workspace--with-history\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(320px,\s*360px\)/s,
  );
  assert.match(styles, /\.studio__title\s*\{[^}]*overflow:\s*visible/s);
  assert.match(styles, /\.studio__title\s+h1\s*\{[^}]*overflow:\s*visible/s);
  assert.match(styles, /\.studio__title\s+h1\s*\{[^}]*white-space:\s*normal/s);
  assert.match(styles, /\.studio__title\s+h1\s*\{[^}]*line-height:\s*1\.42/s);
  assert.match(styles, /--studio-work-width:\s*760px/);
  assert.match(styles, /\.studio-turn\s*\{[^}]*max-width:\s*var\(--studio-work-width\)/s);
  assert.match(styles, /\.studio-turn--user p\s*\{[^}]*border-radius:\s*18px/s);
  assert.match(styles, /\.studio-turn--user p\s*\{[^}]*font-size:\s*15px/s);
  assert.match(styles, /\.studio-turn__label\s*\{[^}]*letter-spacing:\s*0\.12em/s);
  assert.match(styles, /\.studio-thread\s*\{[^}]*--studio-scrollbar-gutter:\s*17px/s);
  assert.match(styles, /\.studio-thread__composer\s*\{[^}]*padding:\s*12px calc\(18px \+ var\(--studio-scrollbar-gutter\)\) 16px 18px/s);
  assert.match(styles, /\.studio-composer\s*\{[^}]*max-width:\s*var\(--studio-work-width\);[^}]*margin:\s*0 auto/s);
  assert.match(capabilities, /Generation could not be completed/);
  assert.match(capabilities, /unavailableReasonUserMessage\(snapshot\.reason\)/);
  assert.match(capabilities, /unavailableReasonUserAction\(snapshot\.reason\)/);
  assert.match(capabilities, /unavailableReasonUserMessage\(blocked\.reason\)/);
  assert.match(capabilities, /unavailableReasonUserAction\(blocked\.reason\)/);
  assert.doesNotMatch(capabilities, /<p>\{snapshot\.message\}<\/p>/);
  assert.doesNotMatch(capabilities, /<p>\{blocked\.message\}<\/p>/);
  assert.match(styles, /border-left:\s*1px solid/);
  assert.match(styles, /\.studio-history__groups/);
  assert.match(styles, /\.studio-history__group/);
  assert.match(styles, /\.studio-recent__copy/);
  assert.match(styles, /\.studio-recent__title/);
  assert.match(styles, /\.studio-recent__detail/);
  assert.doesNotMatch(styles, /\.studio-history \.studio-recent__source--local/);
  assert.doesNotMatch(styles, /\.studio-history \.studio-recent__source--cloud/);
  assert.match(styles, /\.studio-prompt-settings/);
  assert.match(styles, /\.studio-prompt-settings__context/);
  assert.match(styles, /\.studio-history-settings/);
  assert.match(styles, /\.studio-history-settings__params/);
  assert.doesNotMatch(styles, /\.studio-control/);
  assert.match(styles, /\.studio-history-result__model/);
  assert.match(styles, /\.studio-history-result__head/);
  assert.match(styles, /\.studio-history-result__meta/);
  assert.match(styles, /\.studio-history-result__status-mark/);
  assert.match(styles, /\.studio-history-result__status-mark--warning/);
  assert.match(styles, /\.studio-history-result__tag--warning/);
  assert.match(styles, /\.studio-result__avatar--warning/);
  assert.match(styles, /\.studio-result__runtime-chip--warning/);
  assert.match(styles, /\.studio-result__meta/);
  assert.match(styles, /\.studio-result__model-pill/);
  assert.match(styles, /\.studio-result__text\s*\{[^}]*font-size:\s*15px/s);
  assert.match(styles, /\.studio-result__subject\s*\{[^}]*font-size:\s*17px/s);
  assert.match(styles, /\.studio-result__divider/);
  assert.match(styles, /\.studio-history-result__actions/);
  assert.match(styles, /\.studio-result__action\s*\{[^}]*width:\s*30px/s);
  assert.match(styles, /\.studio-result__action\s+svg\s*\{[^}]*display:\s*block/s);
  assert.match(styles, /\.studio-result__action\s+svg\s*\{[^}]*stroke:\s*currentColor/s);
  assert.doesNotMatch(styles, /\.studio-history-settings__empty/);
  assert.doesNotMatch(styles, /\.studio-history-settings__context/);
  assert.match(styles, /\.studio-result\s*\{[^}]*overflow:\s*hidden/s);
  assert.match(styles, /\.studio-result\s*\{[^}]*box-shadow:\s*none !important/s);
  assert.doesNotMatch(styles, /workbench-topbar-tooltip__bubble/);
  assert.doesNotMatch(styles, /\.studio-result\s*\{[^}]*border-radius:\s*14px/s);
});

test('tester artifact history persistence is real and fail-closed', () => {
  const imageHistory = read('src/tester/tester-image-history.ts');
  const workbench = read('src/tester/tester-workbench.tsx');
  const capabilities = readTesterAiTestingSurface(root);
  const tauri = read('src/tester/tester-tauri.ts');

  assert.match(imageHistory, /runId\?: string/);
  assert.match(imageHistory, /kind\?: 'runtime-media'/);
  assert.match(tauri, /@nimiplatform\/kit\/shell\/renderer\/bridge/);
  assert.match(tauri, /toShellBridgeNimiError/);
  assert.doesNotMatch(tauri, /@tauri-apps\/api\/core/);
  assert.match(imageHistory, /artifactCount\?: number/);
  assert.match(imageHistory, /traceState\?: 'captured' \| 'not-captured'/);
  assert.match(imageHistory, /records\.slice\(0, 80\)/);
  assert.match(workbench, /shouldPersistTesterArtifactRecord\(result\)/);
  assert.match(workbench, /appendTesterImageHistoryRecord/);
  assert.doesNotMatch(imageHistory, /kind: record\.kind \|\| 'runtime-media'/);

  // Real runtime artifacts are previewed from their typed url/mimeType only —
  // no fabricated placeholder media.
  assert.match(capabilities, /function ArtifactPreview/);
  assert.match(capabilities, /mimeType\.startsWith\('image\/'\)/);
  assert.doesNotMatch(capabilities, /fake thumbnail/i);
});

test('tester attachment input uses the kit chat composer, not an app-local multimodal component', () => {
  const capabilities = readTesterAiTestingSurface(root);

  // Attachments flow through the kit chat composer headless primitive
  // (BrowserDataUrlAttachment), not a forked app-local multimodal component.
  assert.match(capabilities, /useChatComposer<BrowserDataUrlAttachment>/);
  assert.match(capabilities, /createBrowserDataUrlAttachmentAdapter/);
  assert.match(capabilities, /from '@nimiplatform\/kit\/features\/chat\/headless'/);
  assert.match(capabilities, /attachments: supportsMedia \? \[\.\.\.composerState\.attachments\] : undefined/);
  assert.doesNotMatch(capabilities, /tester-multimodal-input|ImageAttachmentStrip|useMediaAttachments/);
});

test('tester run history labels local fixtures distinctly from runtime results', () => {
  const history = read('src/tester/tester-history.ts');
  assert.match(history, /if \(status === 'ready'\) return 'runtime ready'/);
  assert.match(history, /if \(status === 'unavailable'\) return 'sdk unavailable'/);
  assert.match(history, /return 'local fixture'/);
  assert.match(history, /status === 'local-fixture'\) return 'info'/);
  assert.match(history, /isJsonObject/);
  assert.match(history, /from '@nimiplatform\/sdk\/types'/);
  assert.doesNotMatch(history, /@nimiplatform\/kit\/shell\/renderer\/bridge/);
});
