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

test('tester run history is a global runtime test timeline (no standalone Evidence module)', () => {
  const capabilities = readTesterAiTestingSurface(root);
  const surface = readTesterAiTestingSurface(root);
  const historyStore = read('src/tester/tester-history.ts');
  const appStorage = read('src/tester/tester-app-storage.ts');
  const workbench = read('src/tester/tester-workbench.tsx');

  // Evidence is folded into each capability's test panel as recent local runs,
  // rendered from the app-owned history store â€?not a separate Evidence route.
  assert.match(surface, /function CapabilityRunHistory/);
  assert.match(surface, /Runtime test History/);
  assert.match(surface, /flattenTesterRunHistory\(history\)/);
  assert.match(surface, /runtimeHistoryCapabilityIds\.has\(record\.capabilityId as TesterCapabilityId\)/);
  assert.match(surface, /className="studio-history__runs"/);
  assert.match(surface, /studio-history__filter-trigger/);
  assert.match(surface, /aria-label="History filters"/);
  assert.match(surface, /\{ id: 'all', label: 'All' \}/);
  assert.doesNotMatch(surface, /All environments/);
  assert.match(surface, /Remote Control/);
  assert.match(surface, /No runs match these filters/);
  assert.match(surface, /capabilityIcons\[capability\.id\]/);
  assert.doesNotMatch(surface, /const historyPreviewLimit = 5/);
  assert.doesNotMatch(surface, /\.slice\(0, historyPreviewLimit\)/);
  assert.doesNotMatch(surface, /className="studio-history__capability/);
  assert.doesNotMatch(surface, /expandedCapabilityIds\.has\(capability\.id\)/);
  assert.doesNotMatch(surface, /onToggleCapability\(capability\.id\)/);
  assert.doesNotMatch(workbench, /createDefaultExpandedHistoryCapabilityIds/);
  assert.doesNotMatch(workbench, /historyExpansionInitializedRef/);
  assert.doesNotMatch(workbench, /setExpandedHistoryCapabilityIds/);
  assert.match(capabilities, /getTesterRunStatusLabel/);
  assert.match(capabilities, /getTesterRunResultSummary/);
  assert.match(capabilities, /TextStudioHistorySnapshotBody/);
  assert.doesNotMatch(capabilities, /No recent runs yet\./);
  assert.doesNotMatch(capabilities, /View more|Show less/);
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

test('tester run history timestamps use English labels and preserve visible row dates', () => {
  const historyStore = read('src/tester/tester-history.ts');

  assert.match(historyStore, /new Intl\.DateTimeFormat\('en-US'/);
  assert.match(historyStore, /hourCycle:\s*'h23'/);
  assert.match(historyStore, /formatTesterRunTimestamp\(value: string, now = new Date\(\)\)/);
  assert.match(historyStore, /if \(isSameLocalCalendarDate\(date, now\)\) return testerRunTimeFormatter\.format\(date\);/);
  assert.match(historyStore, /formatTesterRunHistoryTimestamp\(value: string, now = new Date\(\)\)/);
  assert.match(historyStore, /if \(!value\.trim\(\)\) return 'Unknown date';/);
  assert.match(historyStore, /if \(Number\.isNaN\(date\.valueOf\(\)\)\) return 'Unknown date';/);
  assert.match(historyStore, /return testerRunDateTimeFormatter\.format\(date\);/);
  assert.match(historyStore, /return testerRunDateTimeWithYearFormatter\.format\(date\);/);
  assert.doesNotMatch(historyStore, /toLocaleString\(\[\]/);
});

test('right-side history timeline renders a visible timestamp slot', () => {
  const capabilities = readTesterAiTestingSurface(root);
  const styles = read('src/tester/tester-workbench.css');

  assert.match(capabilities, /formatTesterRunHistoryTimestamp/);
  assert.match(capabilities, /<time dateTime=\{record\.createdAt\}>\{formatTesterRunHistoryTimestamp\(record\.createdAt\)\}<\/time>/);
  assert.match(capabilities, /formatTesterRunHistoryTimestamp\(record\.createdAt\), metrics/);
  assert.match(styles, /\.studio-recent__model-tooltip\s*\{[^}]*min-width:\s*0/s);
  assert.match(styles, /\.studio-recent__model-tooltip\s*\{[^}]*overflow:\s*hidden/s);
  assert.match(styles, /\.studio-recent__title time\s*\{[^}]*min-width:\s*max-content/s);
  assert.match(styles, /\.studio-recent__title time\s*\{[^}]*overflow:\s*visible/s);
});

test('tester run history rows prioritize prompt title, timeline filters, and run metrics', () => {
  const capabilities = readTesterAiTestingSurface(root);
  const historyStore = read('src/tester/tester-history.ts');
  const workbench = read('src/tester/workbench/section-ai-testing.tsx');
  const surface = readTesterAiTestingSurface(root);
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
  assert.match(historyStore, /\| 'paramsSummary'/);
  assert.doesNotMatch(historyStore, /const params = record\.runConfig\?\.target\.paramsSummary/);
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
  assert.match(surface, /historyLabelForRun/);
  assert.match(surface, /historyModelTitleForRun/);
  assert.match(surface, /historyFailureReasonForRun/);
  assert.match(surface, /historySubtitleForRun/);
  assert.match(surface, /type HistoryStatusFilter = 'all' \| 'active' \| 'blocked' \| 'local-fixture'/);
  assert.match(surface, /type HistoryEnvironmentFilter = 'all' \| 'local' \| 'cloud' \| 'remote-control'/);
  assert.match(surface, /type HistoryGroupBy = 'none' \| 'date' \| 'capability'/);
  assert.match(surface, /flattenTesterRunHistory\(history\)/);
  assert.match(surface, /matchesHistoryStatus\(record, statusFilter\)/);
  assert.match(surface, /matchesHistoryEnvironment\(record, environmentFilter\)/);
  assert.match(surface, /matchesHistoryActivity\(record, activityFilter, now\)/);
  assert.match(surface, /groupedHistoryRecords\(records, groupBy\)/);
  assert.match(surface, /const hasActiveHistoryFilters = statusFilter !== 'all'/);
  assert.match(surface, /capabilityFilter !== 'all'/);
  assert.match(surface, /environmentFilter !== 'all'/);
  assert.match(surface, /activityFilter !== 'all'/);
  assert.match(surface, /groupBy !== 'none'/);
  assert.match(surface, /sortBy !== 'recency'/);
  assert.match(surface, /function clearHistoryFilters\(\)/);
  assert.match(surface, /setStatusFilter\('all'\)/);
  assert.match(surface, /setCapabilityFilter\('all'\)/);
  assert.match(surface, /setEnvironmentFilter\('all'\)/);
  assert.match(surface, /setActivityFilter\('all'\)/);
  assert.match(surface, /setGroupBy\('none'\)/);
  assert.match(surface, /setSortBy\('recency'\)/);
  assert.match(surface, /HISTORY_ENVIRONMENT_OPTIONS/);
  assert.match(surface, /\{ id: 'all', label: 'All' \}/);
  assert.doesNotMatch(surface, /All environments/);
  assert.match(surface, /Remote Control/);
  assert.match(surface, /SlidersHorizontal/);
  assert.match(surface, /ChevronRight/);
  assert.match(surface, /getTesterRunModelSource\(record\)/);
  assert.match(surface, /getTesterRunModelLabel\(record\)/);
  assert.match(capabilities, /function isOpaqueRuntimeModelId\(value: string\)/);
  assert.match(capabilities, /!\s*isOpaqueRuntimeModelId\(resolved\)/);
  assert.match(workbench, /historySelectionRequest/);
  assert.match(workbench, /onSelectHistoryRun/);
  assert.doesNotMatch(workbench, /expandedHistoryCapabilityIds/);
  assert.doesNotMatch(workbench, /onToggleHistoryCapability/);
  assert.doesNotMatch(workbench, /const historyRecords = history\?\.\[capability\.id\] \?\? \[\]/);
  assert.doesNotMatch(workbench, /const hasHistory = historyRecords\.length > 0/);
  assert.match(workbench, /className="studio__workspace studio__workspace--with-history"/);
  assert.match(capabilities, /<CapabilityRunHistory/);
  assert.match(surface, /studio-history__empty/);
  assert.doesNotMatch(surface, /<span>\{records\.length\}<\/span>/);
  assert.match(surface, /className="studio-history__runs"/);
  assert.match(surface, /className="studio-history__group"/);
  assert.match(surface, /studio-history__filter-trigger/);
  assert.match(surface, /studio-history-filter__row/);
  assert.match(surface, /className="studio-history-filter__clear"/);
  assert.match(surface, /\{hasActiveHistoryFilters \? \(\s*<button[\s\S]*className="studio-history-filter__clear"/);
  assert.doesNotMatch(surface, /disabled=\{!hasActiveHistoryFilters\}/);
  assert.match(surface, /onClick=\{clearHistoryFilters\}/);
  assert.match(surface, /Clear all filters/);
  assert.match(surface, /className="studio-history-filter__submenu nimi-material-glass-regular backdrop-blur-\[var\(--nimi-backdrop-blur-regular\)\]"/);
  assert.match(surface, /useState<HistoryFilterMenuId \| null>\(null\)/);
  assert.match(surface, /if \(!activeMenu\) \{\s*return null;\s*\}/s);
  assert.match(surface, /\{activeMenu \? \(\s*<div\s+className="studio-history-filter__submenu nimi-material-glass-regular backdrop-blur-\[var\(--nimi-backdrop-blur-regular\)\]"/s);
  assert.match(surface, /filterButtonRef/);
  assert.match(surface, /filterPanelRef/);
  assert.match(surface, /document\.addEventListener\('pointerdown', handleOutsidePointerDown, true\)/);
  assert.match(surface, /document\.removeEventListener\('pointerdown', handleOutsidePointerDown, true\)/);
  assert.match(surface, /setFilterOpen\(false\);\s*setActiveMenu\(null\);/s);
  assert.match(surface, /studio-recent__icon/);
  assert.match(surface, /studio-recent__copy/);
  assert.match(surface, /studio-recent__summary/);
  assert.match(surface, /studio-recent__title/);
  assert.match(surface, /studio-recent__detail/);
  assert.match(surface, /<Tooltip content=\{historySubtitleForRun\(record\)\} placement="top" className="studio-recent__detail-tooltip">/);
  assert.match(surface, /\{historySubtitleForRun\(record\)\}/);
  assert.match(surface, /\['Failed', source, historyFailureReasonForRun\(record\)\]\.filter\(Boolean\)\.join\(' \/ '\)/);
  assert.match(surface, /return source;/);
  assert.doesNotMatch(surface, /\[source, historyTitleForRun\(record\)\]\.filter\(Boolean\)\.join\(' \/ '\)/);
  assert.doesNotMatch(surface, /\[source, getTesterRunMetricSummary\(record\), historyTitleForRun\(record\)\]\.filter\(Boolean\)\.join\(' \/ '\)/);
  assert.doesNotMatch(surface, /\[record\.capabilityLabel, historySourceLabelForRun\(record\), historyMetaForRun\(record\)\]/);
  assert.doesNotMatch(surface, /historyMetaForRun/);
  assert.doesNotMatch(surface, /historyDetailForRun/);
  assert.doesNotMatch(surface, /promptControls\.toneSelected/);
  assert.doesNotMatch(surface, /className="studio-history__capability/);
  assert.doesNotMatch(surface, /historyPreviewLimit/);
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
  assert.match(surface, /Embedding generated successfully\./);
  assert.match(capabilities, /Embedding generated successfully\./);
  assert.match(surface, /Media generated successfully\./);
  assert.match(capabilities, /Media generated successfully\./);
  assert.match(surface, /function hasPreviewableArtifact/);
  assert.match(capabilities, /ArtifactMediaPreview/);
  assert.match(capabilities, /hasPreviewableArtifact\(snapshot\.firstArtifact\)/);
  assert.match(historyStore, /if \(result\.kind === 'embedding'\) return \['Embedding ready'\]/);
  assert.match(historyStore, /if \(result\.kind === 'artifacts'\) return \['Ready'\]/);
  assert.match(historyStore, /if \(result\.kind === 'transcript'\) return \['Ready'\]/);
  assert.match(surface, /\{ label: 'Result', value: 'Created' \}/);
  assert.doesNotMatch(surface, /output\.sample\.map\(\(value, index\)/);
  assert.doesNotMatch(capabilities, /snapshot\.sample\.map\(\(value, index\)/);
  assert.doesNotMatch(capabilities, /snapshot\.dimensions\} dimensions/);
  assert.doesNotMatch(capabilities, /snapshot\.totalTokens/);
  assert.doesNotMatch(capabilities, /studio-chip">\{value\.toFixed\(4\)\}/);
  assert.doesNotMatch(capabilities, /Job \{snapshot\.jobId/);
  assert.doesNotMatch(capabilities, /snapshot\.jobState/);
  assert.doesNotMatch(capabilities, /snapshot\.artifactCount\} artifact/);
  assert.doesNotMatch(capabilities, /Hosted artifact:/);
  assert.doesNotMatch(capabilities, /Inline local media is not duplicated in run history/);
  assert.doesNotMatch(surface, /Job \{output\.jobId/);
  assert.doesNotMatch(surface, /output\.jobState\} \/ \{output\.artifactCount\} artifact/);
  assert.match(surface, /function splitSubjectLine\(text: string\)/);
  assert.match(surface, /\^Subject:\\s\*\(\.\+\)\$/);
  assert.doesNotMatch(surface, /\u8def/);
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
  assert.match(capabilities, /invokeTesterCommand<TesterExportSaveResult>\('tester_export_save',\s*\{\s*payload:\s*\{/s);
  assert.match(capabilities, /export async function saveTesterExport/);
  assert.match(surface, /await saveTesterExport\(\{ filename, mimeType: blob\.type, body: blob \}\)/);
  assert.match(surface, /await saveTesterExport\(\{ filename, mimeType: blob\.type \|\| undefined, body: blob \}\)/);
  assert.match(surface, /function anchorDownload\(filename: string, blob: Blob\)/);
  assert.match(surface, /function studioResultModelLabel\(result: TesterCapabilityRunResult \| null, capability: TesterCapability, preferredLabel\?: string\)/);
  assert.match(surface, /const preferred = preferredLabel\?\.trim\(\)/);
  assert.match(surface, /const displayModelLabel = studioResultModelLabel\(result, capability, modelLabel\)/);
  assert.match(capabilities, /modelLabel=\{activeRun\.record \? getTesterRunModelLabel\(activeRun\.record\) : runTarget\.modelLabel\}/);
  assert.match(capabilities, /modelLabel=\{textStudioModelSummary\(headerResult, runTarget, activeRun\?\.record \?\? null\)\}/);
  assert.match(surface, /<Tooltip content=\{displayModelLabel\} placement="top" className="min-w-0">/);
  assert.match(surface, /className="studio-recent__title"/);
  assert.match(surface, /className="studio-recent__model-tooltip"/);
  assert.match(surface, /className="studio-recent__model-name"/);
  assert.match(surface, /<time dateTime=\{record\.createdAt\}>\{formatTesterRunHistoryTimestamp\(record\.createdAt\)\}<\/time>/);
  assert.doesNotMatch(surface, /<Tooltip content=\{`\$\{historyModelTitleForRun\(record\)\} \/ \$\{formatTesterRunHistoryTimestamp\(record\.createdAt\)\}`\} placement="top" className="min-w-0">/);
  assert.match(surface, /<Tooltip content=\{historySubtitleForRun\(record\)\} placement="top" className="studio-recent__detail-tooltip">/);
  assert.doesNotMatch(capabilities, /className="studio-result__action"[^>]*\btitle=/);
  assert.doesNotMatch(surface, /className="studio-result__action"[^>]*\btitle=/);
  assert.match(capabilities, /<CopyIcon size=\{16\} aria-hidden="true" \/>/);
  assert.match(capabilities, /<DownloadIcon size=\{16\} aria-hidden="true" \/>/);
  assert.match(capabilities, /<RefreshCw size=\{16\} aria-hidden="true" \/>/);
  assert.match(styles, /\.studio-diag\s*\{[^}]*position:\s*relative/s);
  assert.match(styles, /\.studio-diag__actions\s*\{[^}]*position:\s*absolute/s);
  assert.match(styles, /\.studio-diag__actions\s*\{[^}]*right:\s*16px/s);
  assert.doesNotMatch(capabilities, /function summarizeParamRows/);
  assert.doesNotMatch(capabilities, /studio-history-settings__summary/);
  assert.match(capabilities, /Model settings/);
  assert.match(capabilities, /className="studio-history-result__model"/);
  assert.doesNotMatch(capabilities, /className="studio-history-result__facts"/);
  assert.match(capabilities, /getTesterRunConfigParamRows\(runConfig\)/);
  assert.match(capabilities, /if \(!runConfig\) \{\s*return null;\s*\}/s);
  assert.match(capabilities, /if \(paramRows\.length === 0 && !fallbackSummary\) \{\s*return null;\s*\}/s);
  assert.match(capabilities, /function hasTextStudioModelSettings\(record: TesterRunHistoryRecord\): boolean/);
  assert.match(capabilities, /modelSettings=\{activeRun\.record && hasTextStudioModelSettings\(activeRun\.record\) \? <TextStudioModelSettings record=\{activeRun\.record\} \/> : null\}/);
  assert.match(capabilities, /className=\{hasModelSettings \? 'studio-model-pill__box' : 'studio-model-pill__box studio-model-pill__box--static'\}/);
  assert.match(capabilities, /className=\{modelSettingsOpen \? 'studio-model-pill__trigger studio-model-pill__trigger--open' : 'studio-model-pill__trigger'\}/);
  assert.match(capabilities, /aria-expanded=\{modelSettingsOpen\}/);
  assert.match(capabilities, /\{modelSettingsOpen && hasModelSettings \? <TextStudioModelSettings record=\{record\} \/> : null\}/);
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
  assert.match(styles, /\.studio-history\s*\{[^}]*overflow:\s*visible/s);
  assert.match(styles, /\.studio-history\s*\{[^}]*grid-template-rows:\s*auto minmax\(0,\s*1fr\)/s);
  assert.match(styles, /\.studio-history__runs/);
  assert.match(styles, /\.studio-history__runs\s*\{[^}]*overflow:\s*auto/s);
  assert.match(styles, /\.studio-history__runs\s*\{[^}]*align-content:\s*start/s);
  assert.match(styles, /\.studio-history__group/);
  assert.match(styles, /\.studio-history__group\s*\{[^}]*align-content:\s*start/s);
  assert.match(styles, /\.studio-recent__rows\s*\{[^}]*align-content:\s*start/s);
  assert.match(styles, /\.studio-history__filter-trigger/);
  assert.match(styles, /\.studio-history-filter/);
  assert.match(styles, /\.studio-history-filter\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
  assert.match(styles, /\.studio-history-filter\s*\{[^}]*position:\s*absolute/s);
  assert.match(styles, /\.studio-history-filter\s*\{[^}]*top:\s*93px/s);
  assert.match(styles, /\.studio-history-filter\s*\{[^}]*right:\s*22px/s);
  assert.match(styles, /\.studio-history-filter\s*\{[^}]*width:\s*min\(236px,\s*calc\(100% - 44px\)\)/s);
  assert.match(styles, /\.studio-history-filter__menu/);
  assert.match(styles, /\.studio-history-filter__submenu/);
  assert.match(styles, /\.studio-history-filter__submenu\s*\{[^}]*position:\s*absolute/s);
  assert.match(styles, /\.studio-history-filter__submenu\s*\{[^}]*right:\s*calc\(100% \+ 8px\)/s);
  assert.match(styles, /\.studio-history-filter__submenu\s*\{[^}]*width:\s*176px/s);
  assert.doesNotMatch(styles, /\.studio-history-filter__submenu\s*\{[^}]*margin-left:\s*-1px/s);
  assert.match(styles, /\.studio-history-filter__row/);
  assert.match(styles, /\.studio-history-filter__option/);
  assert.match(styles, /\.studio-history-filter__clear/);
  assert.match(styles, /\.studio-history-filter__clear\s*\{[^}]*grid-template-columns:\s*16px minmax\(0,\s*1fr\)/s);
  assert.match(styles, /\.studio-history-filter__clear\s*\{[^}]*box-shadow:\s*0 -8px 0 -7px/s);
  assert.match(styles, /\.studio-history-filter__clear:hover\s*\{/);
  assert.doesNotMatch(styles, /\.studio-history-filter__clear:disabled/);
  assert.match(styles, /\.studio-history-filter__option span,\s*\n\.studio-history-filter__clear span\s*\{[^}]*font-size:\s*14px/s);
  assert.match(styles, /\.studio-history-filter__row strong\s*\{[^}]*font-size:\s*13px/s);
  assert.match(styles, /\.studio-recent__icon/);
  assert.doesNotMatch(styles, /\.studio-history__capability/);
  assert.doesNotMatch(styles, /\.studio-history__capability-arrow/);
  assert.doesNotMatch(styles, /aria-expanded="true"/);
  assert.match(styles, /\.studio-recent__copy/);
  assert.match(styles, /\.studio-recent__summary/);
  assert.match(styles, /\.studio-recent__title/);
  assert.match(styles, /\.studio-recent__title > span\s*\{[^}]*justify-self:\s*start/s);
  assert.match(styles, /\.studio-recent__model-tooltip\s*\{[^}]*width:\s*100%/s);
  assert.match(styles, /\.studio-recent__model-tooltip\s*\{[^}]*justify-content:\s*flex-start/s);
  assert.match(styles, /\.studio-recent__model-name\s*\{[^}]*text-overflow:\s*ellipsis/s);
  assert.match(styles, /\.studio-recent__title time\s*\{[^}]*justify-self:\s*end/s);
  assert.match(styles, /\.studio-recent__title time\s*\{[^}]*width:\s*max-content/s);
  assert.match(styles, /\.studio-recent__title time\s*\{[^}]*text-align:\s*right/s);
  assert.match(styles, /\.studio-recent__detail-tooltip\s*\{[^}]*width:\s*100%/s);
  assert.match(styles, /\.studio-recent__detail-tooltip\s*\{[^}]*justify-content:\s*flex-start/s);
  assert.match(styles, /\.studio-recent__detail/);
  assert.match(styles, /\.studio-recent__detail\s*\{[^}]*display:\s*block/s);
  assert.match(styles, /\.studio-recent__detail\s*\{[^}]*width:\s*100%/s);
  assert.match(styles, /\.studio-recent__detail\s*\{[^}]*text-align:\s*left/s);
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
  assert.match(styles, /\.studio-model-pill__box\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) 30px/s);
  assert.match(styles, /\.studio-model-pill__trigger\s*\{[^}]*border-left/s);
  assert.match(styles, /\.studio-model-pill__trigger--open svg\s*\{[^}]*rotate\(90deg\)/s);
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

test('tester model settings hide runtime profile injection internals', () => {
  const historyStore = read('src/tester/tester-history.ts');

  for (const key of ['companionSlots', 'profileEntries', 'profile_entries', 'entryOverrides', 'entry_overrides']) {
    assert.match(historyStore, new RegExp(`'${key}'`));
  }
  assert.match(historyStore, /const HIDDEN_MODEL_PARAM_KEYS = new Set/);
  assert.match(historyStore, /Object\.keys\(runConfig\.target\.params\)[\s\S]*\.filter\(\(key\) => !HIDDEN_MODEL_PARAM_KEYS\.has\(key\)\)[\s\S]*\.map\(\(key\) => \(\{ key, label: key, group: 'Model parameters' \}\)\)/);
});

test('tester artifact history persistence is real and fail-closed', () => {
  const imageHistory = read('src/tester/tester-image-history.ts');
  const workbench = read('src/tester/tester-workbench.tsx');
  const artifactStorage = read('src/tester/tester-artifact-storage.ts');
  const testerStorage = read('src-tauri/src/tester_storage.rs');
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
  assert.match(workbench, /materializeTesterArtifactResult/);
  assert.match(workbench, /saveTesterArtifact/);
  assert.match(workbench, /createTesterRunHistoryResultSnapshot\(historyResult\)/);
  assert.match(workbench, /appendTesterImageHistoryRecord/);
  assert.match(artifactStorage, /tester_artifact_save/);
  assert.match(artifactStorage, /convertTauriFileSrc\(result\.artifactPath\)/);
  assert.match(testerStorage, /pub fn tester_artifact_save/);
  assert.match(testerStorage, /scoped_storage_child\(&payload\.storage_root, "tester data root", "artifacts"\)/);
  assert.doesNotMatch(imageHistory, /kind: record\.kind \|\| 'runtime-media'/);

  // Real runtime artifacts are previewed from their typed url/mimeType only â€?  // no fabricated placeholder media.
  assert.match(capabilities, /function ArtifactPreview/);
  assert.match(capabilities, /function ArtifactMediaPreview/);
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
