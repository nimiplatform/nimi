#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readYamlWithFragments } from './read-yaml-with-fragments.mjs';
import {
  renderAiTimeoutDefaults,
  renderConnectorAuthProfiles,
  renderConnectorRpcFieldRules,
  renderDaemonHealthStates,
  renderErrorMappingMatrix,
  renderInterceptorChain,
  renderJobStates,
  renderKeySourceTruthTable,
  renderLocalAdapterRouting,
  renderLocalEngineCatalog,
  renderMetadataKeys,
  renderProviderCapabilities,
  renderProviderCatalog,
  renderProviderModelCatalog,
  renderProviderProbeTargets,
  renderProviderVoiceCatalog,
  renderReasonCodes,
  renderRpcMethods,
  renderRpcMigrationMap,
  renderStateTransitions,
  renderWorkflowNodeTypes,
  renderWorkflowStates,
} from './runtime-spec-kernel-doc-renderers-basic.mjs';
import { renderGeneratedIndex, renderJsonSnapshot } from './runtime-spec-kernel-doc-renderer-utils.mjs';
import {
  renderMultimodalArtifactFields,
  renderMultimodalCanonicalFields,
  renderCapabilityVocabularyMapping,
  renderConfigSchema,
  renderProviderExtensionRegistry,
  renderRuleEvidence,
  renderRuntimeAgentTypedFamily,
  renderRuntimeDeliveryGates,
  renderRuntimeMemoryBankScope,
  renderRuntimeMemoryHookTrigger,
  renderRuntimeMemoryReplicationOutcome,
  renderRuntimeProtoGovernanceGates,
  renderScenarioExecutionMatrix,
  renderScenarioProfileFields,
  renderScenarioTypes,
  renderTtsProviderCapabilityMatrix,
  renderVoiceEnums,
} from './runtime-spec-kernel-doc-renderers-media.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..');

const tablesDir = path.join(repoRoot, '.nimi', 'spec', 'runtime', 'kernel', 'tables');
const outDir = path.join(repoRoot, '.nimi', 'spec', 'runtime', 'kernel', 'generated');

const specs = [
  {
    input: 'rpc-methods.yaml',
    output: 'rpc-methods.md',
    render: renderRpcMethods,
  },
  {
    input: 'rpc-migration-map.yaml',
    output: 'rpc-migration-map.md',
    render: renderRpcMigrationMap,
  },
  {
    input: 'reason-codes.yaml',
    output: 'reason-codes.md',
    render: renderReasonCodes,
  },
  {
    input: 'error-mapping-matrix.yaml',
    output: 'error-mapping-matrix.md',
    render: renderErrorMappingMatrix,
  },
  {
    input: 'metadata-keys.yaml',
    output: 'metadata-keys.md',
    render: renderMetadataKeys,
  },
  {
    input: 'key-source-truth-table.yaml',
    output: 'key-source-truth-table.md',
    render: renderKeySourceTruthTable,
  },
  {
    input: 'connector-auth-profiles.yaml',
    output: 'connector-auth-profiles.md',
    render: renderConnectorAuthProfiles,
  },
  {
    input: 'provider-catalog.yaml',
    output: 'provider-catalog.md',
    render: renderProviderCatalog,
  },
  {
    input: 'provider-capabilities.yaml',
    output: 'provider-capabilities.md',
    render: renderProviderCapabilities,
  },
  {
    input: 'connector-rpc-field-rules.yaml',
    output: 'connector-rpc-field-rules.md',
    render: renderConnectorRpcFieldRules,
  },
  {
    input: 'job-states.yaml',
    output: 'job-states.md',
    render: renderJobStates,
  },
  {
    input: 'state-transitions.yaml',
    output: 'state-transitions.md',
    render: renderStateTransitions,
  },
  {
    input: 'local-engine-catalog.yaml',
    output: 'local-engine-catalog.md',
    render: renderLocalEngineCatalog,
  },
  {
    input: 'local-adapter-routing.yaml',
    output: 'local-adapter-routing.md',
    render: renderLocalAdapterRouting,
  },
  {
    input: 'daemon-health-states.yaml',
    output: 'daemon-health-states.md',
    render: renderDaemonHealthStates,
  },
  {
    input: 'interceptor-chain.yaml',
    output: 'interceptor-chain.md',
    render: renderInterceptorChain,
  },
  {
    input: 'ai-timeout-defaults.yaml',
    output: 'ai-timeout-defaults.md',
    render: renderAiTimeoutDefaults,
  },
  {
    input: 'provider-probe-targets.yaml',
    output: 'provider-probe-targets.md',
    render: renderProviderProbeTargets,
  },
  {
    input: 'workflow-node-types.yaml',
    output: 'workflow-node-types.md',
    render: renderWorkflowNodeTypes,
  },
  {
    input: 'workflow-states.yaml',
    output: 'workflow-states.md',
    render: renderWorkflowStates,
  },
  {
    input: 'voice-enums.yaml',
    output: 'voice-enums.md',
    render: renderVoiceEnums,
  },
  {
    input: 'tts-provider-capability-matrix.yaml',
    output: 'tts-provider-capability-matrix.md',
    render: renderTtsProviderCapabilityMatrix,
  },
  {
    input: 'multimodal-canonical-fields.yaml',
    output: 'multimodal-canonical-fields.md',
    render: renderMultimodalCanonicalFields,
  },
  {
    input: 'multimodal-artifact-fields.yaml',
    output: 'multimodal-artifact-fields.md',
    render: renderMultimodalArtifactFields,
  },
  {
    input: 'scenario-types.yaml',
    output: 'scenario-types.md',
    render: renderScenarioTypes,
  },
  {
    input: 'scenario-execution-matrix.yaml',
    output: 'scenario-execution-matrix.md',
    render: renderScenarioExecutionMatrix,
  },
  {
    input: 'provider-extension-registry.yaml',
    output: 'provider-extension-registry.md',
    render: renderProviderExtensionRegistry,
  },
  {
    input: 'runtime-memory-bank-scope.yaml',
    output: 'runtime-memory-bank-scope.md',
    render: renderRuntimeMemoryBankScope,
  },
  {
    input: 'runtime-memory-hook-trigger.yaml',
    output: 'runtime-memory-hook-trigger.md',
    render: renderRuntimeMemoryHookTrigger,
  },
  {
    input: 'runtime-memory-replication-outcome.yaml',
    output: 'runtime-memory-replication-outcome.md',
    render: renderRuntimeMemoryReplicationOutcome,
  },
  {
    input: 'runtime-agent-service-typed-family.yaml',
    output: 'runtime-agent-typed-family.md',
    render: renderRuntimeAgentTypedFamily,
  },
  {
    input: 'agent-participation-axis-model.yaml',
    output: 'agent-participation-axis-model.md',
    render: renderJsonSnapshot('Generated Agent Participation Axis Model'),
  },
  {
    input: 'agent-participation-profiles.yaml',
    output: 'agent-participation-profiles.md',
    render: renderJsonSnapshot('Generated Agent Participation Profiles'),
  },
  {
    input: 'agent-participation-context-blocks.yaml',
    output: 'agent-participation-context-blocks.md',
    render: renderJsonSnapshot('Generated Agent Participation Context Blocks'),
  },
  {
    input: 'agent-participation-output-destinations.yaml',
    output: 'agent-participation-output-destinations.md',
    render: renderJsonSnapshot('Generated Agent Participation Output Destinations'),
  },
  {
    input: 'agent-participation-memory-policy.yaml',
    output: 'agent-participation-memory-policy.md',
    render: renderJsonSnapshot('Generated Agent Participation Memory Policy'),
  },
  {
    input: 'agent-participation-memory-read-scopes.yaml',
    output: 'agent-participation-memory-read-scopes.md',
    render: renderJsonSnapshot('Generated Agent Participation Memory Read Scopes'),
  },
  {
    input: 'agent-participation-capability-scopes.yaml',
    output: 'agent-participation-capability-scopes.md',
    render: renderJsonSnapshot('Generated Agent Participation Capability Scopes'),
  },
  {
    input: 'agent-participation-concurrency-policy.yaml',
    output: 'agent-participation-concurrency-policy.md',
    render: renderJsonSnapshot('Generated Agent Participation Concurrency Policy'),
  },
  {
    input: 'scenario-profile-fields.yaml',
    output: 'scenario-profile-fields.md',
    render: renderScenarioProfileFields,
  },
  {
    input: 'runtime-delivery-gates.yaml',
    output: 'runtime-delivery-gates.md',
    render: renderRuntimeDeliveryGates,
  },
  {
    input: 'runtime-proto-governance-gates.yaml',
    output: 'runtime-proto-governance-gates.md',
    render: renderRuntimeProtoGovernanceGates,
  },
  {
    input: 'capability-vocabulary-mapping.yaml',
    output: 'capability-vocabulary-mapping.md',
    render: renderCapabilityVocabularyMapping,
  },
  {
    input: 'config-schema.yaml',
    output: 'config-schema.md',
    render: renderConfigSchema,
  },
  {
    input: 'rule-evidence.yaml',
    output: 'rule-evidence.md',
    render: renderRuleEvidence,
  },
];

async function parseYamlFile(filePath) {
  return readYamlWithFragments(filePath);
}

async function main() {
  const checkMode = process.argv.includes('--check');

  await fs.mkdir(outDir, { recursive: true });

  const renderedEntries = [];
  for (const spec of specs) {
    const inputPath = path.join(tablesDir, spec.input);
    const outputPath = path.join(outDir, spec.output);

    const parsed = await parseYamlFile(inputPath);
    const rendered = spec.render(parsed, spec.input);
    renderedEntries.push({ ...spec, outputPath, rendered });
  }

  const indexPath = path.join(outDir, 'index.md');
  const indexRendered = renderGeneratedIndex(specs);

  if (checkMode) {
    const drifted = [];

    for (const entry of renderedEntries) {
      let current = '';
      try {
        current = await fs.readFile(entry.outputPath, 'utf8');
      } catch {
        drifted.push(entry.outputPath);
        continue;
      }
      if (current !== entry.rendered) {
        drifted.push(entry.outputPath);
      }
    }

    let currentIndex = '';
    try {
      currentIndex = await fs.readFile(indexPath, 'utf8');
    } catch {
      drifted.push(indexPath);
    }
    if (currentIndex !== indexRendered) {
      drifted.push(indexPath);
    }

    if (drifted.length > 0) {
      process.stderr.write('runtime kernel generated docs drift detected:\n');
      for (const file of drifted) {
        process.stderr.write(`  - ${path.relative(repoRoot, file)}\n`);
      }
      process.stderr.write('run `pnpm exec nimicoding generate-spec-derived-docs --profile nimi --scope runtime` to regenerate.\n');
      process.exitCode = 1;
      return;
    }

    process.stdout.write(`runtime kernel generated docs are up-to-date (${renderedEntries.length + 1} files)\n`);
    return;
  }

  for (const entry of renderedEntries) {
    await fs.writeFile(entry.outputPath, entry.rendered, 'utf8');
  }
  await fs.writeFile(indexPath, indexRendered, 'utf8');

  process.stdout.write(`generated runtime kernel docs (${renderedEntries.length + 1} files)\n`);
}

main().catch((error) => {
  process.stderr.write(`generate-runtime-spec-kernel-docs failed: ${String(error)}\n`);
  process.exitCode = 1;
});
