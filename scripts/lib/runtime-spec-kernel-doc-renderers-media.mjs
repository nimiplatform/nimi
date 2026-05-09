import { header, mdBool, normalizeMarkdown } from './runtime-spec-kernel-doc-renderer-utils.mjs';

export function renderVoiceEnums(doc, sourceName) {
  let out = header('Generated Voice Enums', sourceName);

  const workflowTypes = Array.isArray(doc?.workflow_types) ? doc.workflow_types : [];
  out += '## Workflow Types\n\n';
  out += '| Workflow Type | Enum Name | Enum Value | Description | Source |\n';
  out += '|---|---|---:|---|---|\n';
  for (const item of workflowTypes) {
    const workflowType = String(item?.workflow_type || '').trim();
    if (!workflowType) continue;
    const enumName = String(item?.enum_name || '').trim() || '—';
    const enumValue = Number(item?.enum_value);
    const description = String(item?.description || '').trim() || '—';
    const source = String(item?.source_rule || '').trim() || '—';
    out += `| \`${workflowType}\` | \`${enumName}\` | ${Number.isNaN(enumValue) ? '—' : enumValue} | ${description} | \`${source}\` |\n`;
  }
  out += '\n';

  const referenceKinds = Array.isArray(doc?.reference_kinds) ? doc.reference_kinds : [];
  out += '## Reference Kinds\n\n';
  out += '| Kind | Enum Name | Enum Value | Description | Source |\n';
  out += '|---|---|---:|---|---|\n';
  for (const item of referenceKinds) {
    const kind = String(item?.kind || '').trim();
    if (!kind) continue;
    const enumName = String(item?.enum_name || '').trim() || '—';
    const enumValue = Number(item?.enum_value);
    const description = String(item?.description || '').trim() || '—';
    const source = String(item?.source_rule || '').trim() || '—';
    out += `| \`${kind}\` | \`${enumName}\` | ${Number.isNaN(enumValue) ? '—' : enumValue} | ${description} | \`${source}\` |\n`;
  }
  out += '\n';

  const persistenceTypes = Array.isArray(doc?.persistence_types) ? doc.persistence_types : [];
  out += '## Persistence Types\n\n';
  out += '| Persistence | Enum Name | Enum Value | Description | Source |\n';
  out += '|---|---|---:|---|---|\n';
  for (const item of persistenceTypes) {
    const persistence = String(item?.persistence || '').trim();
    if (!persistence) continue;
    const enumName = String(item?.enum_name || '').trim() || '—';
    const enumValue = Number(item?.enum_value);
    const description = String(item?.description || '').trim() || '—';
    const source = String(item?.source_rule || '').trim() || '—';
    out += `| \`${persistence}\` | \`${enumName}\` | ${Number.isNaN(enumValue) ? '—' : enumValue} | ${description} | \`${source}\` |\n`;
  }
  out += '\n';

  const handleScopes = Array.isArray(doc?.handle_scopes) ? doc.handle_scopes : [];
  out += '## Handle Scopes\n\n';
  out += '| Scope | Enum Name | Enum Value | Description | Source |\n';
  out += '|---|---|---:|---|---|\n';
  for (const item of handleScopes) {
    const scope = String(item?.scope || '').trim();
    if (!scope) continue;
    const enumName = String(item?.enum_name || '').trim() || '—';
    const enumValue = Number(item?.enum_value);
    const description = String(item?.description || '').trim() || '—';
    const source = String(item?.source_rule || '').trim() || '—';
    out += `| \`${scope}\` | \`${enumName}\` | ${Number.isNaN(enumValue) ? '—' : enumValue} | ${description} | \`${source}\` |\n`;
  }
  out += '\n';

  const deleteSemantics = Array.isArray(doc?.delete_semantics) ? doc.delete_semantics : [];
  out += '## Delete Semantics\n\n';
  out += '| Delete Semantics | Enum Name | Enum Value | Description | Source |\n';
  out += '|---|---|---:|---|---|\n';
  for (const item of deleteSemantics) {
    const semantics = String(item?.delete_semantics || '').trim();
    if (!semantics) continue;
    const enumName = String(item?.enum_name || '').trim() || '—';
    const enumValue = Number(item?.enum_value);
    const description = String(item?.description || '').trim() || '—';
    const source = String(item?.source_rule || '').trim() || '—';
    out += `| \`${semantics}\` | \`${enumName}\` | ${Number.isNaN(enumValue) ? '—' : enumValue} | ${description} | \`${source}\` |\n`;
  }
  out += '\n';

  const assetStatuses = Array.isArray(doc?.asset_statuses) ? doc.asset_statuses : [];
  out += '## Asset Statuses\n\n';
  out += '| Status | Enum Name | Enum Value | Description | Source |\n';
  out += '|---|---|---:|---|---|\n';
  for (const item of assetStatuses) {
    const status = String(item?.status || '').trim();
    if (!status) continue;
    const enumName = String(item?.enum_name || '').trim() || '—';
    const enumValue = Number(item?.enum_value);
    const description = String(item?.description || '').trim() || '—';
    const source = String(item?.source_rule || '').trim() || '—';
    out += `| \`${status}\` | \`${enumName}\` | ${Number.isNaN(enumValue) ? '—' : enumValue} | ${description} | \`${source}\` |\n`;
  }
  out += '\n';

  return normalizeMarkdown(out);
}

export function renderTtsProviderCapabilityMatrix(doc, sourceName) {
  const entries = Array.isArray(doc?.entries) ? doc.entries : [];
  let out = header('Generated TTS Provider Capability Matrix', sourceName);

  out += '| Provider ID | Runtime Plane | Synthesize | Clone | Design | Timing Alignment | Voice Discovery Mode | Activation State | Source Rule |\n';
  out += '|---|---|---|---|---|---|---|---|---|\n';
  for (const item of entries) {
    const providerID = String(item?.provider_id || '').trim();
    if (!providerID) continue;
    const runtimePlane = String(item?.runtime_plane || '').trim() || '—';
    const supportsSynthesize = mdBool(Boolean(item?.supports_tts_synthesize));
    const supportsClone = mdBool(Boolean(item?.supports_voice_clone));
    const supportsDesign = mdBool(Boolean(item?.supports_voice_design));
    const supportsTimingAlignment = mdBool(Boolean(item?.supports_timing_alignment));
    const discoveryMode = String(item?.voice_discovery_mode || '').trim() || '—';
    const activationState = String(item?.activation_state || '').trim() || '—';
    const sourceRule = String(item?.source_rule || '').trim() || '—';
    out += `| \`${providerID}\` | \`${runtimePlane}\` | \`${supportsSynthesize}\` | \`${supportsClone}\` | \`${supportsDesign}\` | \`${supportsTimingAlignment}\` | \`${discoveryMode}\` | \`${activationState}\` | \`${sourceRule}\` |\n`;
  }
  out += '\n';

  return normalizeMarkdown(out);
}

export function renderMultimodalCanonicalFields(doc, sourceName) {
  const fields = Array.isArray(doc?.fields) ? doc.fields : [];
  let out = header('Generated Multimodal Canonical Fields', sourceName);

  out += '| Modality | Field | Required | Description | Source Rule |\n';
  out += '|---|---|---|---|---|\n';
  for (const item of fields) {
    const modality = String(item?.modality || '').trim();
    const field = String(item?.field || '').trim();
    if (!modality || !field) continue;
    const required = mdBool(Boolean(item?.required));
    const description = String(item?.description || '').trim() || '—';
    const sourceRule = String(item?.source_rule || '').trim() || '—';
    out += `| \`${modality}\` | \`${field}\` | \`${required}\` | ${description} | \`${sourceRule}\` |\n`;
  }
  out += '\n';

  return normalizeMarkdown(out);
}

export function renderMultimodalArtifactFields(doc, sourceName) {
  const fields = Array.isArray(doc?.fields) ? doc.fields : [];
  let out = header('Generated Multimodal Artifact Fields', sourceName);

  out += '| Field | Required | Description | Source Rule |\n';
  out += '|---|---|---|---|\n';
  for (const item of fields) {
    const field = String(item?.field || '').trim();
    if (!field) continue;
    const required = mdBool(Boolean(item?.required));
    const description = String(item?.description || '').trim() || '—';
    const sourceRule = String(item?.source_rule || '').trim() || '—';
    out += `| \`${field}\` | \`${required}\` | ${description} | \`${sourceRule}\` |\n`;
  }
  out += '\n';

  return normalizeMarkdown(out);
}

export function renderScenarioTypes(doc, sourceName) {
  const entries = Array.isArray(doc?.entries) ? doc.entries : [];
  let out = header('Generated Scenario Types', sourceName);

  out += '| Scenario Type | Description | Source Rule |\n';
  out += '|---|---|---|\n';
  for (const item of entries) {
    const scenarioType = String(item?.scenario_type || '').trim();
    if (!scenarioType) continue;
    const description = String(item?.description || '').trim() || '—';
    const sourceRule = String(item?.source_rule || '').trim() || '—';
    out += `| \`${scenarioType}\` | ${description} | \`${sourceRule}\` |\n`;
  }
  out += '\n';

  return normalizeMarkdown(out);
}

export function renderScenarioExecutionMatrix(doc, sourceName) {
  const entries = Array.isArray(doc?.entries) ? doc.entries : [];
  let out = header('Generated Scenario Execution Matrix', sourceName);

  out += '| Scenario Type | Canonical Modality | Supported Execution Modes | Source Rule |\n';
  out += '|---|---|---|---|\n';
  for (const item of entries) {
    const scenarioType = String(item?.scenario_type || '').trim();
    if (!scenarioType) continue;
    const canonicalModality = String(item?.canonical_modality || '').trim() || '—';
    const modes = Array.isArray(item?.supported_execution_modes)
      ? item.supported_execution_modes.map((mode) => `\`${String(mode || '').trim()}\``).filter(Boolean).join(', ')
      : '—';
    const sourceRule = String(item?.source_rule || '').trim() || '—';
    out += `| \`${scenarioType}\` | \`${canonicalModality}\` | ${modes || '—'} | \`${sourceRule}\` |\n`;
  }
  out += '\n';

  return normalizeMarkdown(out);
}

export function renderProviderExtensionRegistry(doc, sourceName) {
  const entries = Array.isArray(doc?.entries) ? doc.entries : [];
  let out = header('Generated Provider Extension Registry', sourceName);

  out += '| Provider ID | Scenario Type | Direction | Namespace | Strategy | Source Rule |\n';
  out += '|---|---|---|---|---|---|\n';
  for (const item of entries) {
    const providerID = String(item?.provider_id || '').trim();
    const scenarioType = String(item?.scenario_type || '').trim();
    if (!providerID || !scenarioType) continue;
    const direction = String(item?.direction || '').trim() || '—';
    const namespace = String(item?.namespace || '').trim() || '—';
    const strategy = String(item?.strategy || '').trim() || '—';
    const sourceRule = String(item?.source_rule || '').trim() || '—';
    out += `| \`${providerID}\` | \`${scenarioType}\` | \`${direction}\` | \`${namespace}\` | \`${strategy}\` | \`${sourceRule}\` |\n`;
  }
  out += '\n';

  return normalizeMarkdown(out);
}

export function renderRuntimeMemoryBankScope(doc, sourceName) {
  const scopes = Array.isArray(doc?.scopes) ? doc.scopes : [];
  let out = header('Generated Runtime Memory Bank Scope', sourceName);
  out += '| Scope | Owner Kind | Direct App Access | Public Bank Create | Canonical Agent Scope | Source |\n';
  out += '|---|---|---:|---:|---:|---|\n';
  for (const item of scopes) {
    const scope = String(item?.scope || '').trim();
    if (!scope) continue;
    out += `| \`${scope}\` | \`${String(item?.owner_kind || '').trim()}\` | \`${mdBool(Boolean(item?.direct_app_access))}\` | \`${mdBool(Boolean(item?.public_bank_create_allowed))}\` | \`${mdBool(Boolean(item?.canonical_agent_scope))}\` | \`${String(item?.source_rule || '').trim()}\` |\n`;
  }
  out += '\n';
  for (const item of scopes) {
    const scope = String(item?.scope || '').trim();
    const description = String(item?.description || '').trim();
    if (!scope || !description) continue;
    out += `- \`${scope}\`: ${description}\n`;
  }
  out += '\n';
  return normalizeMarkdown(out);
}

export function renderRuntimeMemoryHookTrigger(doc, sourceName) {
  const triggers = Array.isArray(doc?.trigger_kinds) ? doc.trigger_kinds : [];
  let out = header('Generated Runtime Memory Hook Trigger', sourceName);
  out += '| Trigger Kind | Host Owned | Source |\n';
  out += '|---|---:|---|\n';
  for (const item of triggers) {
    const trigger = String(item?.trigger_kind || '').trim();
    if (!trigger) continue;
    out += `| \`${trigger}\` | \`${mdBool(Boolean(item?.host_owned))}\` | \`${String(item?.source_rule || '').trim()}\` |\n`;
  }
  out += '\n';
  for (const item of triggers) {
    const trigger = String(item?.trigger_kind || '').trim();
    const description = String(item?.description || '').trim();
    if (!trigger || !description) continue;
    out += `- \`${trigger}\`: ${description}\n`;
  }
  out += '\n';
  return normalizeMarkdown(out);
}

export function renderRuntimeMemoryReplicationOutcome(doc, sourceName) {
  const outcomes = Array.isArray(doc?.outcomes) ? doc.outcomes : [];
  let out = header('Generated Runtime Memory Replication Outcome', sourceName);
  out += '| Outcome | Terminal | Source |\n';
  out += '|---|---:|---|\n';
  for (const item of outcomes) {
    const outcome = String(item?.outcome || '').trim();
    if (!outcome) continue;
    out += `| \`${outcome}\` | \`${mdBool(Boolean(item?.terminal))}\` | \`${String(item?.source_rule || '').trim()}\` |\n`;
  }
  out += '\n';
  for (const item of outcomes) {
    const outcome = String(item?.outcome || '').trim();
    const description = String(item?.description || '').trim();
    if (!outcome || !description) continue;
    out += `- \`${outcome}\`: ${description}\n`;
  }
  out += '\n';
  return normalizeMarkdown(out);
}

export function renderRuntimeAgentTypedFamily(doc, sourceName) {
  const families = Array.isArray(doc?.families) ? doc.families : [];
  let out = header('Generated Runtime Agent Typed Family', sourceName);
  out += '| Family | Mutable By App | Source |\n';
  out += '|---|---:|---|\n';
  for (const item of families) {
    const family = String(item?.family || '').trim();
    if (!family) continue;
    out += `| \`${family}\` | \`${mdBool(Boolean(item?.mutable_by_app))}\` | \`${String(item?.source_rule || '').trim()}\` |\n`;
  }
  out += '\n';
  for (const item of families) {
    const family = String(item?.family || '').trim();
    const description = String(item?.description || '').trim();
    if (!family || !description) continue;
    out += `- \`${family}\`: ${description}\n`;
  }
  out += '\n';
  return normalizeMarkdown(out);
}

export function renderScenarioProfileFields(doc, sourceName) {
  const fields = Array.isArray(doc?.fields) ? doc.fields : [];
  let out = header('Generated Scenario Profile Fields', sourceName);

  out += '| Field | Required | Description | Source Rule |\n';
  out += '|---|---|---|---|\n';
  for (const item of fields) {
    const field = String(item?.field || '').trim();
    if (!field) continue;
    const required = mdBool(Boolean(item?.required));
    const description = String(item?.description || '').trim() || '—';
    const sourceRule = String(item?.source_rule || '').trim() || '—';
    out += `| \`${field}\` | \`${required}\` | ${description} | \`${sourceRule}\` |\n`;
  }
  out += '\n';

  return normalizeMarkdown(out);
}

export function renderRuntimeDeliveryGates(doc, sourceName) {
  const gates = Array.isArray(doc?.gates) ? doc.gates : [];
  let out = header('Generated Runtime Delivery Gates', sourceName);

  out += '| Gate | Name | Objective | Command | Blocking | Evidence Route | Source Rule |\n';
  out += '|---|---|---|---|---|---|---|\n';
  for (const item of gates) {
    const gate = String(item?.gate || '').trim();
    if (!gate) continue;
    const name = String(item?.name || '').trim() || '—';
    const objective = String(item?.objective || '').trim() || '—';
    const command = String(item?.command || '').trim() || '—';
    const blocking = String(item?.blocking || '').trim() || '—';
    const evidenceRoute = String(item?.evidence_route || '').trim() || '—';
    const sourceRule = String(item?.source_rule || '').trim() || '—';
    out += `| \`${gate}\` | \`${name}\` | ${objective} | \`${command}\` | \`${blocking}\` | \`${evidenceRoute}\` | \`${sourceRule}\` |\n`;
  }
  out += '\n';

  return normalizeMarkdown(out);
}

export function renderRuntimeProtoGovernanceGates(doc, sourceName) {
  const gates = Array.isArray(doc?.gates) ? doc.gates : [];
  let out = header('Generated Runtime Proto Governance Gates', sourceName);

  out += '| Gate | Command | Source Rule |\n';
  out += '|---|---|---|\n';
  for (const item of gates) {
    const gate = String(item?.gate || '').trim();
    if (!gate) continue;
    const command = String(item?.command || '').trim() || '—';
    const sourceRule = String(item?.source_rule || '').trim() || '—';
    out += `| \`${gate}\` | \`${command}\` | \`${sourceRule}\` |\n`;
  }
  out += '\n';

  return normalizeMarkdown(out);
}

export function renderCapabilityVocabularyMapping(doc, sourceName) {
  const canonicalTokens = Array.isArray(doc?.canonical_tokens) ? doc.canonical_tokens : [];
  const localManifestTokens = Array.isArray(doc?.local_manifest_tokens) ? doc.local_manifest_tokens : [];
  const localCategories = Array.isArray(doc?.local_categories) ? doc.local_categories : [];
  const localToCanonical = Array.isArray(doc?.local_to_canonical) ? doc.local_to_canonical : [];
  const canonicalOnly = Array.isArray(doc?.canonical_only) ? doc.canonical_only : [];
  const huggingfaceInference = Array.isArray(doc?.huggingface_inference) ? doc.huggingface_inference : [];

  let out = header('Generated Capability Vocabulary Mapping', sourceName);

  out += '## Canonical Tokens\n\n';
  for (const token of canonicalTokens) {
    out += `- \`${String(token)}\`\n`;
  }
  out += '\n## Local Manifest Tokens\n\n';
  for (const token of localManifestTokens) {
    out += `- \`${String(token)}\`\n`;
  }
  out += '\n## Local Categories\n\n';
  for (const category of localCategories) {
    out += `- \`${String(category)}\`\n`;
  }
  out += '\n## Local → Canonical Mapping\n\n';
  out += '| Local Token | Canonical Token | Local Category | Source Rule |\n';
  out += '|---|---|---|---|\n';
  for (const item of localToCanonical) {
    out += `| \`${String(item?.local_token || '')}\` | \`${String(item?.canonical_token || '')}\` | \`${String(item?.local_category || '') || '—'}\` | \`${String(item?.source_rule || '') || '—'}\` |\n`;
  }
  out += '\n## Canonical-Only Tokens\n\n';
  out += '| Canonical Token | Note |\n';
  out += '|---|---|\n';
  for (const item of canonicalOnly) {
    out += `| \`${String(item?.canonical_token || '')}\` | ${String(item?.note || '') || '—'} |\n`;
  }
  out += '\n## HuggingFace Inference Mapping\n\n';
  out += '| Pipeline Tag | Local Token | Note |\n';
  out += '|---|---|---|\n';
  for (const item of huggingfaceInference) {
    out += `| \`${String(item?.pipeline_tag || '')}\` | \`${String(item?.local_token || '')}\` | ${String(item?.note || '') || '—'} |\n`;
  }
  out += '\n';

  return normalizeMarkdown(out);
}

export function renderConfigSchema(doc, sourceName) {
  const fields = Array.isArray(doc?.fields) ? doc.fields : [];
  let out = header('Generated Config Schema', sourceName);

  out += '| Key | Type | Default | Reload | Description | Source |\n';
  out += '|---|---|---|---|---|---|\n';
  for (const item of fields) {
    const key = String(item?.key || '').trim();
    if (!key) continue;
    const type = String(item?.type || '').trim() || '—';
    const def = String(item?.default || '').trim() || '—';
    const reload = String(item?.reload || '').trim() || '—';
    const description = String(item?.description || '').trim() || '—';
    const source = String(item?.source_rule || '').trim() || '—';
    out += `| \`${key}\` | \`${type}\` | \`${def}\` | \`${reload}\` | ${description} | \`${source}\` |\n`;
  }
  out += '\n';

  return normalizeMarkdown(out);
}

export function renderRuleEvidence(doc, sourceName) {
  const catalog = doc?.evidence_catalog && typeof doc.evidence_catalog === 'object'
    ? doc.evidence_catalog
    : {};
  const rules = Array.isArray(doc?.rules) ? doc.rules : [];
  const declaredTotal = Number(doc?.rule_compliance?.total_k_rules);
  const uniqueRuleCount = new Set(rules
    .map((item) => String(item?.rule_id || '').trim())
    .filter(Boolean)).size;
  let out = header('Generated Rule Evidence', sourceName);

  out += '## Rule Compliance\n\n';
  out += '| Declared K Rules | Resolved Rule Rows | Evidence Catalog Entries |\n';
  out += '|---:|---:|---:|\n';
  out += `| ${Number.isInteger(declaredTotal) ? declaredTotal : '—'} | ${uniqueRuleCount} | ${Object.keys(catalog).length} |\n\n`;

  out += '## Evidence Catalog\n\n';
  out += '| Evidence Ref | Type | Command | Path | Description |\n';
  out += '|---|---|---|---|---|\n';
  for (const [ref, value] of Object.entries(catalog)) {
    const item = value && typeof value === 'object' ? value : {};
    const type = String(item.type || '').trim() || '—';
    const command = String(item.command || '').trim() || '—';
    const evidencePath = String(item.path || '').trim() || '—';
    const description = String(item.description || '').trim() || '—';
    out += `| \`${ref}\` | \`${type}\` | \`${command}\` | \`${evidencePath}\` | ${description} |\n`;
  }
  out += '\n';

  out += '## Rule Coverage Matrix\n\n';
  out += '| Rule ID | Status | Evidence Refs |\n';
  out += '|---|---|---|\n';
  for (const item of rules) {
    const ruleId = String(item?.rule_id || '').trim();
    if (!ruleId) continue;
    const status = String(item?.status || '').trim() || '—';
    const refs = Array.isArray(item?.evidence_refs) ? item.evidence_refs : [];
    const refsText = refs.length > 0
      ? refs.map((ref) => `\`${String(ref)}\``).join(', ')
      : '—';
    out += `| \`${ruleId}\` | \`${status}\` | ${refsText} |\n`;
  }
  out += '\n';

  return normalizeMarkdown(out);
}
