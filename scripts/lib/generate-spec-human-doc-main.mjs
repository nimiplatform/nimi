#!/usr/bin/env node

/** Generate or drift-check the human-readable spec document. */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DocBuilder,
  renderAppTabs,
  renderAdmittedReferenceMatrix,
  renderArtifactFamilies,
  renderBootstrapPhases,
  renderCompletionGates,
  renderConnectorAuthProfiles,
  renderDataSyncFlows,
  renderDesktopErrorCodes,
  renderErrorMappingMatrix,
  renderFeatureFlags,
  renderImportBoundaries,
  renderIpcCommands,
  renderJobStates,
  renderKeySourceTruthTable,
  renderLocalAdapterRouting,
  renderLocalEngineCatalog,
  renderLogAreas,
  renderMethodGroups,
  renderProviderCapabilities,
  renderProviderCatalog,
  renderPromptServingLanes,
  renderPublicSurface,
  renderReasonCodes,
  renderRuleEvidence,
  renderRuntimeCapabilityUpgradeMatrix,
  renderRuntimeBridgeBoundary,
  renderRetryStatusCodes,
  renderRpcMethods,
  renderSdkErrorCodes,
  renderServiceOperations,
  renderStoreSlices,
} from './spec-human-doc-core.mjs';
import { appendSpecHumanDocNarrative } from './spec-human-doc-narrative.mjs';
import { appendSpecHumanDocRuntimeSdkNarrative } from './spec-human-doc-runtime-sdk-narrative.mjs';
import {
  finalizeGeneratedDoc,
  loadKernelRuleMap,
} from './generate-spec-human-doc-helpers.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..');
const specDir = path.join(repoRoot, '.nimi', 'spec');
const outPath = path.join(specDir, 'generated', 'nimi-spec.md');

async function main() {
  const checkMode = process.argv.includes('--check');
  const ruleMap = await loadKernelRuleMap(specDir);

  process.stderr.write(`parsed ${ruleMap.size} kernel rules\n`);

  const rtTables = (name) => path.join(specDir, 'runtime', 'kernel', 'tables', name);
  const ctTables = (name) => path.join(specDir, 'cognition', 'kernel', 'tables', name);
  const sdkTables = (name) => path.join(specDir, 'sdks', 'kernel', 'tables', name);
  const dtTables = (name) => path.join(specDir, 'desktop', 'kernel', 'tables', name);
  const configFile = (name) => path.join(repoRoot, 'config', name);
  const d = new DocBuilder(ruleMap);

  appendSpecHumanDocNarrative(d);
  await d.yamlTable(configFile('runtime-provider-catalog.yaml'), renderProviderCatalog);
  await d.yamlTable(configFile('runtime-provider-capabilities.yaml'), renderProviderCapabilities);

  await appendSpecHumanDocRuntimeSdkNarrative(d, { renderJobStates, rtTables });

  d.text(`---

## 12. 附录：参考表

以下表格从 YAML 输入自动渲染。输入的权威身份以其文件声明为准；如需修改，请编辑对应输入后重新生成。

### 12.1 Runtime — RPC 方法列表
`);
  await d.yamlTable(configFile('runtime-rpc-methods.yaml'), renderRpcMethods);

  d.text(`### 12.2 Runtime — ReasonCode 错误码表
`);
  await d.yamlTable(configFile('runtime-reason-codes.yaml'), renderReasonCodes);

  d.text(`### 12.3 Runtime — 错误映射矩阵
`);
  await d.yamlTable(rtTables('error-mapping-matrix.yaml'), renderErrorMappingMatrix);

  d.text(`### 12.4 Cognition — Artifact Families
`);
  await d.yamlTable(ctTables('artifact-families.yaml'), renderArtifactFamilies);

  d.text(`### 12.5 Cognition — Admitted Reference Matrix
`);
  await d.yamlTable(ctTables('admitted-reference-matrix.yaml'), renderAdmittedReferenceMatrix);

  d.text(`### 12.6 Cognition — Public Surface
`);
  await d.yamlTable(ctTables('public-surface.yaml'), renderPublicSurface);

  d.text(`### 12.7 Cognition — Runtime Capability Upgrade Matrix
`);
  await d.yamlTable(ctTables('runtime-capability-upgrade-matrix.yaml'), renderRuntimeCapabilityUpgradeMatrix);

  d.text(`### 12.8 Cognition — Memory Service Operations
`);
  await d.yamlTable(ctTables('memory-service-operations.yaml'), renderServiceOperations);

  d.text(`### 12.9 Cognition — Knowledge Service Operations
`);
  await d.yamlTable(ctTables('knowledge-service-operations.yaml'), renderServiceOperations);

  d.text(`### 12.10 Cognition — Prompt Serving Lanes
`);
  await d.yamlTable(ctTables('prompt-serving-lanes.yaml'), renderPromptServingLanes);

  d.text(`### 12.11 Cognition — Skill Service Operations
`);
  await d.yamlTable(ctTables('skill-service-operations.yaml'), renderServiceOperations);

  d.text(`### 12.12 Cognition — Completion Gates
`);
  await d.yamlTable(ctTables('completion-gates.yaml'), renderCompletionGates);

  d.text(`### 12.13 Cognition — Runtime Bridge Boundary
`);
  await d.yamlTable(ctTables('runtime-bridge-boundary.yaml'), renderRuntimeBridgeBoundary);

  d.text(`### 12.14 Cognition — Rule Evidence
`);
  await d.yamlTable(ctTables('rule-evidence.yaml'), renderRuleEvidence);

  d.text(`### 12.15 Runtime — Key Source 真值表
`);
  await d.yamlTable(rtTables('key-source-truth-table.yaml'), renderKeySourceTruthTable);

  d.text(`### 12.16 Runtime — Connector Auth Profiles
`);
  await d.yamlTable(rtTables('connector-auth-profiles.yaml'), renderConnectorAuthProfiles);

  d.text(`### 12.17 Runtime — 本地引擎目录
`);
  await d.yamlTable(configFile('runtime-local-engine-catalog.yaml'), renderLocalEngineCatalog);

  d.text(`### 12.18 Runtime — 本地适配器路由
`);
  await d.yamlTable(configFile('runtime-local-adapter-routing.yaml'), renderLocalAdapterRouting);

  d.text(`### 12.19 SDK — 错误码
`);
  await d.yamlTable(sdkTables('sdk-error-codes.yaml'), renderSdkErrorCodes);

  d.text(`### 12.20 SDK — Runtime 方法投影分组
`);
  await d.yamlTable(sdkTables('runtime-method-groups.yaml'), renderMethodGroups);

  d.text(`### 12.21 Desktop — 启动阶段
`);
  await d.yamlTable(configFile('desktop-shell-runtime-bootstrap-phases.yaml'), renderBootstrapPhases);

  d.text(`### 12.22 Desktop — IPC 命令
`);
  await d.yamlTable(configFile('desktop-ipc-commands.yaml'), renderIpcCommands);

  d.text(`### 12.23 Desktop — App Tabs
`);
  await d.yamlTable(configFile('desktop-shell-ui-app-tabs.yaml'), renderAppTabs);

  d.text(`### 12.24 Desktop — Store Slices
`);
  await d.yamlTable(configFile('desktop-shell-runtime-store-slices.yaml'), renderStoreSlices);

  d.text(`### 12.25 Desktop — Feature Flags
`);
  await d.yamlTable(configFile('desktop-shell-runtime-feature-flags.yaml'), renderFeatureFlags);

  d.text(`### 12.26 Desktop — 数据同步流
`);
  await d.yamlTable(configFile('desktop-shell-runtime-data-sync-flows.yaml'), renderDataSyncFlows);

  d.text(`### 12.27 Desktop — 错误码
`);
  await d.yamlTable(configFile('desktop-shell-ui-error-codes.yaml'), renderDesktopErrorCodes);

  d.text(`### 12.28 Desktop — Retry Status Codes
`);
  await d.yamlTable(configFile('desktop-shell-runtime-retry-status-codes.yaml'), renderRetryStatusCodes);

  d.text(`### 12.29 Desktop — Log Areas
`);
  await d.yamlTable(configFile('desktop-shell-ui-log-areas.yaml'), renderLogAreas);

  const output = d.build();
  await finalizeGeneratedDoc({ checkMode, outPath, output, repoRoot });
}

main().catch((error) => {
  process.stderr.write(`generate-spec-human-doc failed: ${String(error)}\n`);
  process.exitCode = 1;
});
