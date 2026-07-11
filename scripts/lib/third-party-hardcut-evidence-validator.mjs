import {
  assertArtifactRef,
  assertExactObject,
  fail,
  readJsonFile,
} from './third-party-hardcut-evidence-core.mjs';
import {
  PacketArtifactStore,
  resolveAndVerifyPacketArtifact,
  resolvePacketArtifact,
} from './third-party-hardcut-evidence-paths.mjs';
import {
  assertRepositoryStateStable,
  canonicalizeRepositoryInputs,
  validateRepositoryBaseline,
} from './third-party-hardcut-evidence-repositories.mjs';
import { validateLiveCoverage } from './third-party-hardcut-evidence-live.mjs';
import { validateDerivedReports } from './third-party-hardcut-evidence-derived.mjs';
import {
  rejectProhibitedPacketMaterial,
  rejectStructuredLeakFindings,
  validateStructuredLeakReport,
} from './third-party-hardcut-evidence-privacy.mjs';
import { validateCommandEvidence } from './third-party-hardcut-evidence-commands.mjs';

export function validateEvidencePacket({ contract, packetRoot, trustedRepos }) {
  const artifactStore = new PacketArtifactStore(
    packetRoot,
    contract.packet_resource_policy,
    contract.privacy_scan_policy,
  );
  const manifestArtifact = resolvePacketArtifact(artifactStore, 'manifest.json');
  const manifest = readJsonFile(manifestArtifact, 'manifest');
  if (manifest.schema_version !== contract.version) {
    fail(
      'SCHEMA_VERSION_MISMATCH',
      `packet schema version must equal contract version ${contract.version}`,
    );
  }
  assertExactObject(
    manifest,
    contract.object_schemas.manifest.required_fields,
    'manifest',
  );
  if (
    typeof manifest.packet_id !== 'string'
    || !/^[a-z0-9][a-z0-9._-]*$/u.test(manifest.packet_id)
    || typeof manifest.run_id !== 'string'
    || !/^[a-z0-9][a-z0-9._-]*$/u.test(manifest.run_id)
    || !['phase0', 'A', 'U', 'R', 'B'].includes(manifest.wave)
    || Number.isNaN(Date.parse(manifest.generated_at))
    || manifest.timezone !== 'UTC'
    || !Array.isArray(manifest.authority_refs)
    || manifest.authority_refs.length === 0
    || manifest.authority_refs.some((reference) => (
      typeof reference !== 'string'
      || !reference.startsWith('.nimi/spec/')
      || reference.split('/').includes('..')
    ))
  ) {
    fail('INVALID_FIELD', 'manifest identity, wave, timestamp, timezone, or authority refs are invalid');
  }
  if (!Array.isArray(manifest.derived_reports)) {
    fail('INVALID_FIELD', 'manifest.derived_reports must be an array');
  }
  if (manifest.declared_disposition === 'admitted_and_observed') {
    fail(
      'SELF_ASSERTED_DISPOSITION',
      'v1 cannot derive admitted_and_observed from packet claims',
    );
  }
  if (manifest.declared_disposition !== 'implementation_incomplete') {
    fail(
      'DISPOSITION_MISMATCH',
      'v1 accepts only a declared implementation_incomplete disposition',
    );
  }
  const artifacts = [
    manifest.baseline_ref,
    manifest.commands_ref,
    manifest.coverage_ref,
    manifest.leak_report_ref,
  ].map((artifactRef) => resolveAndVerifyPacketArtifact(artifactStore, artifactRef));
  validateDerivedReports(artifactStore, manifest.derived_reports, contract);
  const commandRepositories = canonicalizeRepositoryInputs(trustedRepos);
  const commandRecords = validateCommandEvidence(
    artifactStore,
    artifacts[1],
    contract,
    commandRepositories,
  );
  const coverageRows = validateLiveCoverage({
    contract,
    coverageArtifact: artifacts[2],
    artifactStore,
  });
  rejectStructuredLeakFindings(artifacts[3]);
  const { baseline, repositoryStates } = validateRepositoryBaseline(
    artifacts[0],
    trustedRepos,
    contract,
    artifactStore.root,
  );
  validateStructuredLeakReport(contract, artifacts[3]);
  for (const [label, artifactRef] of [
    ['baseline_ref', manifest.baseline_ref],
    ['commands_ref', manifest.commands_ref],
    ['coverage_ref', manifest.coverage_ref],
    ['leak_report_ref', manifest.leak_report_ref],
  ]) {
    assertArtifactRef(contract, artifactRef, `manifest.${label}`);
  }
  const repositoriesById = new Map(
    baseline.repositories.map((repository) => [repository.id, repository]),
  );
  for (const command of commandRecords) {
    const repository = repositoriesById.get(command.repository_id);
    if (!repository || repository.head !== command.committed_head) {
      fail(
        'REPOSITORY_HEAD_MISMATCH',
        `command ${command.command_id} is not bound to its baseline repository HEAD`,
      );
    }
    if (Date.parse(repository.observed_at) > Date.parse(command.started_at)) {
      fail('COMMAND_TIMELINE_INVALID', 'command started before its clean repository preflight');
    }
  }
  const commandLogHashes = new Set(commandRecords.map((command) => command.log_ref.sha256));
  const unmatchedCommandRows = coverageRows.filter((row) => (
    row.execution_status === 'executed'
    && contract.row_adapters[row.row_id]?.evidence_kind === 'command'
    && !row.raw_artifact_refs.some((artifact) => commandLogHashes.has(artifact.sha256))
  ));
  if (unmatchedCommandRows.length > 0) {
    fail('COMMAND_EVIDENCE_MISSING', 'command row lacks a matching command record');
  }
  const structuralClaimRows = coverageRows
    .filter((row) => {
      if (row.execution_status !== 'executed') {
        return false;
      }
      const adapter = contract.row_adapters[row.row_id];
      if (adapter?.evidence_kind === 'command') {
        return row.raw_artifact_refs.some((artifact) => commandLogHashes.has(artifact.sha256));
      }
      if (adapter?.evidence_kind === 'live_shell') {
        return Boolean(row.shell_report_ref);
      }
      if (adapter?.evidence_kind === 'wave_posture') {
        return row.raw_artifact_refs.length > 0;
      }
      return false;
    })
    .map((row) => row.row_id)
    .sort();
  const requiredRows = contract.enforced_required_rows[manifest.wave] ?? [];
  const missingEnforcedRows = requiredRows.filter((rowId) => !structuralClaimRows.includes(rowId));
  if (missingEnforcedRows.length > 0) {
    fail(
      'REQUIRED_ROW_MISSING',
      `packet is missing ${missingEnforcedRows.length} enforced required rows`,
    );
  }
  rejectProhibitedPacketMaterial(
    artifactStore,
    contract.privacy_scan_policy,
    contract.packet_resource_policy,
  );
  artifactStore.assertStable();
  assertRepositoryStateStable(repositoryStates);
  return {
    schema_version: contract.version,
    packet_id: manifest.packet_id,
    disposition: 'implementation_incomplete',
    admitted_and_observed_supported:
      contract.admission_derivation.admitted_and_observed.supported,
    coverage: {
      observed_rows: [],
      structural_claim_rows: structuralClaimRows,
      missing_enforced_rows: missingEnforcedRows,
    },
    privacy: {
      recognized_text_scan_performed: true,
      binary_exact_canary_scan_performed: true,
      structured_probe_claims_observed: false,
      ocr_supported: false,
    },
  };
}
