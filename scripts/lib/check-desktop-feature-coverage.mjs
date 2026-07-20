import {
  fileExists,
  read,
  readYaml,
} from './check-desktop-spec-kernel-consistency-shared.mjs';
import {
  isWdioScenarioEntry,
  scenarioRegistry,
} from '../../apps/desktop/e2e/helpers/registry.mjs';

export function checkDesktopTestingGateCoverage(fail, kernelRuleDefinitions) {
  const tablePath = '.nimi/spec/desktop/kernel/tables/desktop-testing-gates.yaml';
  if (!fileExists(tablePath)) {
    fail(`missing desktop testing gate table: ${tablePath}`);
    return;
  }

  const doc = readYaml(tablePath) || {};
  const gates = Array.isArray(doc?.gates) ? doc.gates : [];
  if (gates.length === 0) {
    fail(`${tablePath} must define at least one gate`);
    return;
  }

  const gateMap = new Map();
  for (const gateEntry of gates) {
    const gate = String(gateEntry?.gate || '').trim();
    const command = String(gateEntry?.command || '').trim();
    const sourceRule = String(gateEntry?.source_rule || '').trim();
    if (!gate) {
      fail(`${tablePath} contains gate entry with empty gate id`);
      continue;
    }
    if (gateMap.has(gate)) {
      fail(`${tablePath} contains duplicate gate id: ${gate}`);
      continue;
    }
    gateMap.set(gate, gateEntry);
    if (!command) {
      fail(`${tablePath} gate ${gate} must declare command`);
    }
    if (!/^D-[A-Z]+-\d{3}$/u.test(sourceRule)) {
      fail(`${tablePath} gate ${gate} has invalid source_rule: ${sourceRule}`);
      continue;
    }
    if (!kernelRuleDefinitions.has(sourceRule)) {
      fail(`${tablePath} gate ${gate} references undefined desktop kernel Rule ID: ${sourceRule}`);
    }
  }

  const requiredGates = [
    ['unit_contract_mock', 'D-GATE-010', ['pnpm --filter @nimiplatform/desktop test']],
    ['rust_tauri_integration', 'D-GATE-020', ['pnpm check:desktop-native-quality']],
    ['desktop_e2e', 'D-GATE-030', ['pnpm --filter @nimiplatform/desktop test:e2e']],
    ['selector_testability', 'D-GATE-050', ['pnpm --filter @nimiplatform/desktop run check:e2e-parity']],
    ['os_matrix', 'D-GATE-060', ['linux:PR+release', 'windows:release', 'macos:manual-smoke']],
    ['release_parity', 'D-GATE-070', ['pnpm --filter @nimiplatform/desktop test:e2e']],
    ['spec_consistency', 'D-GATE-080', ['pnpm exec nimicoding validate-spec-governance --profile nimi --scope desktop-consistency']],
    ['docs_drift', 'D-GATE-080', ['pnpm exec nimicoding generate-spec-derived-docs --profile nimi --scope desktop --check']],
    ['design_contract', 'D-GATE-090', ['pnpm check:desktop-design-contract']],
    ['design_adoption', 'D-GATE-091', ['pnpm check:desktop-design-contract']],
  ];

  for (const [gate, expectedRule, expectedTokens] of requiredGates) {
    const gateEntry = gateMap.get(gate);
    if (!gateEntry) {
      fail(`${tablePath} missing required gate: ${gate}`);
      continue;
    }
    const sourceRule = String(gateEntry?.source_rule || '').trim();
    if (sourceRule !== expectedRule) {
      fail(`${tablePath} gate ${gate} must use source_rule ${expectedRule}, got ${sourceRule || '<empty>'}`);
    }
    const command = String(gateEntry?.command || '').trim();
    for (const token of expectedTokens) {
      if (!command.includes(token)) {
        fail(`${tablePath} gate ${gate} command must include: ${token}`);
      }
    }
  }
}

export function checkDesktopFeatureCoverage(fail, kernelRuleDefinitions) {
  const tablePath = '.nimi/spec/desktop/kernel/tables/desktop-feature-coverage.yaml';
  if (!fileExists(tablePath)) {
    fail(`missing desktop feature coverage table: ${tablePath}`);
    return;
  }

  const doc = readYaml(tablePath) || {};
  const entries = Array.isArray(doc?.entries) ? doc.entries.map((value) => String(value || '').trim()).filter(Boolean) : [];
  const features = Array.isArray(doc?.features) ? doc.features : [];
  if (features.length === 0) {
    fail(`${tablePath} must define at least one feature`);
    return;
  }
  if (entries.length !== features.length) {
    fail(`${tablePath} entries length ${entries.length} must match features length ${features.length}`);
  }

  const featureMap = new Map();
  const registeredDesktopE2EScenarios = new Map(
    Array.from(scenarioRegistry.entries()).filter(([, entry]) => isWdioScenarioEntry(entry)),
  );
  const coveredDesktopE2EScenarios = new Set();
  const allowedLayers = new Set(['unit_contract', 'renderer_mock_integration', 'rust_tauri_integration', 'desktop_e2e']);
  for (const [index, featureEntry] of features.entries()) {
    const feature = String(featureEntry?.feature || '').trim();
    const riskTier = String(featureEntry?.risk_tier || '').trim();
    const requiredLayers = Array.isArray(featureEntry?.required_layers) ? featureEntry.required_layers : [];
    const coversTabs = Array.isArray(featureEntry?.covers_tabs) ? featureEntry.covers_tabs : [];
    const coversBootstrapPhases = Array.isArray(featureEntry?.covers_bootstrap_phases) ? featureEntry.covers_bootstrap_phases : [];
    const coversIpcCommands = Array.isArray(featureEntry?.covers_ipc_commands) ? featureEntry.covers_ipc_commands : [];
    const coversRuntimePages = Array.isArray(featureEntry?.covers_runtime_pages) ? featureEntry.covers_runtime_pages : [];
    const scenarios = Array.isArray(featureEntry?.scenarios) ? featureEntry.scenarios : [];
    if (!feature) {
      fail(`${tablePath} contains feature entry with empty feature id`);
      continue;
    }
    const expectedEntryId = `features_${index + 1}`;
    if (entries[index] !== expectedEntryId) {
      fail(`${tablePath} entry index ${index + 1} must be ${expectedEntryId}, got ${entries[index] || '<missing>'}`);
    }
    if (featureMap.has(feature)) {
      fail(`${tablePath} contains duplicate feature id: ${feature}`);
      continue;
    }
    featureMap.set(feature, featureEntry);
    if (!['P0', 'P1', 'P2'].includes(riskTier)) {
      fail(`${tablePath} feature ${feature} has invalid risk_tier: ${riskTier || '<empty>'}`);
    }
    for (const layer of requiredLayers) {
      if (!allowedLayers.has(String(layer))) {
        fail(`${tablePath} feature ${feature} declares unknown required layer: ${String(layer)}`);
      }
    }
    if ((riskTier === 'P0' || riskTier === 'P1') && !requiredLayers.includes('desktop_e2e')) {
      fail(`${tablePath} feature ${feature} risk_tier=${riskTier} must declare desktop_e2e coverage`);
    }
    for (const field of ['covers_tabs', 'covers_bootstrap_phases', 'covers_ipc_commands', 'covers_runtime_pages']) {
      if (!Array.isArray(featureEntry?.[field])) {
        fail(`${tablePath} feature ${feature} must declare array field ${field}`);
      }
    }
    if (scenarios.length === 0) {
      fail(`${tablePath} feature ${feature} must define at least one scenario`);
      continue;
    }
    for (const scenario of scenarios) {
      const scenarioId = String(scenario?.scenario_id || '').trim();
      const sourceRule = String(scenario?.source_rule || '').trim();
      const specPath = String(scenario?.spec_path || '').trim();
      const registeredScenario = registeredDesktopE2EScenarios.get(scenarioId);
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/u.test(scenarioId)) {
        fail(`${tablePath} feature ${feature} has invalid scenario_id: ${scenarioId || '<empty>'}`);
      }
      if (!/^D-[A-Z]+-\d{3}$/u.test(sourceRule)) {
        fail(`${tablePath} feature ${feature} scenario ${scenarioId || '<empty>'} has invalid source_rule: ${sourceRule || '<empty>'}`);
      } else if (!kernelRuleDefinitions.has(sourceRule)) {
        fail(`${tablePath} feature ${feature} scenario ${scenarioId} references undefined desktop kernel Rule ID: ${sourceRule}`);
      }
      if (!specPath) {
        fail(`${tablePath} feature ${feature} scenario ${scenarioId || '<empty>'} missing spec_path`);
        continue;
      }
      if (!fileExists(specPath)) {
        fail(`${tablePath} feature ${feature} scenario ${scenarioId} spec_path does not exist: ${specPath}`);
        continue;
      }
      const specContent = read(specPath);
      if (!specContent.includes(scenarioId)) {
        fail(`${tablePath} feature ${feature} scenario ${scenarioId} spec file must contain scenario id`);
      }
      if (registeredScenario) {
        coveredDesktopE2EScenarios.add(scenarioId);
        if (String(registeredScenario.spec || '').trim() !== specPath) {
          fail(`${tablePath} feature ${feature} scenario ${scenarioId} must use registered spec_path ${registeredScenario.spec}`);
        }
      } else if (specPath.startsWith('apps/desktop/e2e/specs/')) {
        fail(`${tablePath} feature ${feature} scenario ${scenarioId} uses an E2E spec but is absent from the executable scenario registry`);
      }
    }
    if (requiredLayers.includes('desktop_e2e') && !scenarios.some((scenario) => registeredDesktopE2EScenarios.has(String(scenario?.scenario_id || '').trim()))) {
      fail(`${tablePath} feature ${feature} declares desktop_e2e but has no executable registered Desktop E2E scenario`);
    }
  }

  for (const scenarioId of registeredDesktopE2EScenarios.keys()) {
    if (!coveredDesktopE2EScenarios.has(scenarioId)) {
      fail(`${tablePath} must map registered Desktop E2E scenario to a feature: ${scenarioId}`);
    }
  }

  const requiredFeatures = [
    'boot-startup',
    'shell-navigation',
    'offline-recovery',
    'settings-release-preferences',
    'chat-core',
    'explore-entry',
    'runtime-config',
    'local-ai-entry',
    'external-agent-entry',
  ];
  for (const feature of requiredFeatures) {
    if (!featureMap.has(feature)) {
      fail(`${tablePath} missing required feature coverage entry: ${feature}`);
    }
  }

  const appTabsPath = '.nimi/spec/desktop/kernel/tables/app-tabs.yaml';
  if (fileExists(appTabsPath)) {
    const appTabsDoc = readYaml(appTabsPath) || {};
    const tabs = Array.isArray(appTabsDoc?.tabs) ? appTabsDoc.tabs : [];
    const requiredTabIds = tabs
      .filter((item) => String(item?.nav_group || '').trim() === 'core')
      .map((item) => String(item?.id || '').trim())
      .filter(Boolean);
    const coveredTabIds = new Set(
      features.flatMap((item) => Array.isArray(item?.covers_tabs) ? item.covers_tabs : []).map((value) => String(value || '').trim()).filter(Boolean),
    );
    for (const tabId of requiredTabIds) {
      if (!coveredTabIds.has(tabId)) {
        fail(`${tablePath} must cover app tab via covers_tabs: ${tabId}`);
      }
    }
  }

  const bootstrapPath = '.nimi/spec/desktop/kernel/tables/bootstrap-phases.yaml';
  if (fileExists(bootstrapPath)) {
    const bootstrapDoc = readYaml(bootstrapPath) || {};
    const phases = Array.isArray(bootstrapDoc?.phases) ? bootstrapDoc.phases : [];
    const requiredPhases = phases.map((item) => String(item?.phase || '').trim()).filter(Boolean);
    const coveredPhases = new Set(
      features.flatMap((item) => Array.isArray(item?.covers_bootstrap_phases) ? item.covers_bootstrap_phases : []).map((value) => String(value || '').trim()).filter(Boolean),
    );
    for (const phase of requiredPhases) {
      if (!coveredPhases.has(phase)) {
        fail(`${tablePath} must cover bootstrap phase via covers_bootstrap_phases: ${phase}`);
      }
    }
  }

  const ipcPath = '.nimi/spec/desktop/kernel/tables/ipc-commands.yaml';
  if (fileExists(ipcPath)) {
    const ipcDoc = readYaml(ipcPath) || {};
    const commands = Array.isArray(ipcDoc?.commands) ? ipcDoc.commands : [];
    const criticalCommands = ['runtime_defaults', 'runtime_bridge_status', 'desktop_release_info_get'];
    const declaredCommands = new Set(commands.map((item) => String(item?.command || '').trim()).filter(Boolean));
    const coveredCommands = new Set(
      features.flatMap((item) => Array.isArray(item?.covers_ipc_commands) ? item.covers_ipc_commands : []).map((value) => String(value || '').trim()).filter(Boolean),
    );
    for (const command of criticalCommands) {
      if (declaredCommands.has(command) && !coveredCommands.has(command)) {
        fail(`${tablePath} must cover critical IPC command via covers_ipc_commands: ${command}`);
      }
    }
  }
}
