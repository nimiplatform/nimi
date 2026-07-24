import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

export const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
export const journeyRegistryPath = path.join(repoRoot, 'config', 'local-agent-product-journeys.yaml');
export const executionPolicyPath = path.join(repoRoot, 'config', 'local-agent-product-execution-policy.yaml');

function readYaml(filePath) {
  return YAML.parse(fs.readFileSync(filePath, 'utf8'));
}

export function readJourneyRegistry(filePath = journeyRegistryPath) {
  return readYaml(filePath);
}

export function readExecutionPolicy(filePath = executionPolicyPath) {
  return readYaml(filePath);
}

export function readLocalAgentTestArchitecture() {
  return {
    journeys: readJourneyRegistry(),
    policy: readExecutionPolicy(),
  };
}
