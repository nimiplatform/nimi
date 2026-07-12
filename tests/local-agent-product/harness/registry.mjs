import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

export const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
export const testPointCatalogPath = path.join(repoRoot, 'config', 'local-agent-product-acceptance-points.yaml');
export const journeyRegistryPath = path.join(repoRoot, 'config', 'local-agent-product-journeys.yaml');
export const executionPolicyPath = path.join(repoRoot, 'config', 'local-agent-product-execution-policy.yaml');
export const conversationScenarioRegistryPath = path.join(repoRoot, 'config', 'local-agent-product-conversation-scenarios.yaml');

function readYaml(filePath) {
  return YAML.parse(fs.readFileSync(filePath, 'utf8'));
}

export function readTestPointCatalog(filePath = testPointCatalogPath) {
  return readYaml(filePath);
}

export function readJourneyRegistry(filePath = journeyRegistryPath) {
  return readYaml(filePath);
}

export function readExecutionPolicy(filePath = executionPolicyPath) {
  return readYaml(filePath);
}

export function readConversationScenarioRegistry(filePath = conversationScenarioRegistryPath) {
  return readYaml(filePath);
}

export function readLocalAgentTestArchitecture() {
  return {
    points: readTestPointCatalog(),
    journeys: readJourneyRegistry(),
    policy: readExecutionPolicy(),
    scenarios: readConversationScenarioRegistry(),
  };
}
