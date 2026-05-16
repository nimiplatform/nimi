export function collectReferencedRuntimeRuleIds(content, kernelRuleSet) {
  const refs = new Set();

  for (const match of content.matchAll(/\bK-[A-Z]+-\d{3}[a-z]?\b/g)) {
    if (kernelRuleSet.has(match[0])) {
      refs.add(match[0]);
    }
  }

  for (const match of content.matchAll(/\b(K-[A-Z]+)-\*/g)) {
    const prefix = `${match[1]}-`;
    for (const ruleId of kernelRuleSet) {
      if (ruleId.startsWith(prefix)) {
        refs.add(ruleId);
      }
    }
  }

  for (const match of content.matchAll(/\b(K-[A-Z]+)-(\d{3})[~鈥?](\d{3})\b/g)) {
    const prefix = `${match[1]}-`;
    const start = Number.parseInt(match[2], 10);
    const end = Number.parseInt(match[3], 10);
    if (Number.isNaN(start) || Number.isNaN(end)) continue;
    const lower = Math.min(start, end);
    const upper = Math.max(start, end);
    for (const ruleId of kernelRuleSet) {
      if (!ruleId.startsWith(prefix)) continue;
      const suffix = ruleId.slice(prefix.length);
      const numeric = Number.parseInt(suffix.slice(0, 3), 10);
      if (!Number.isNaN(numeric) && numeric >= lower && numeric <= upper) {
        refs.add(ruleId);
      }
    }
  }

  return refs;
}

export function createRuntimeSpecTraceabilityChecks({
  cwd,
  domainFiles,
  fail,
  fs,
  kernelFiles,
  path,
  read,
  readYaml,
  runtimeMarkdownFiles,
}) {
  function checkRpcMethodsSourceTraceability(kernelRuleSet) {
    const rpcTable = readYaml('.nimi/spec/runtime/kernel/tables/rpc-methods.yaml');
    const services = Array.isArray(rpcTable?.services) ? rpcTable.services : [];
    for (const service of services) {
      const name = String(service?.name || '').trim();
      if (!name) continue;
      const source = String(service?.source_rule || '').trim();
      if (!source) {
        fail(`rpc-methods service ${name} missing source_rule`);
        continue;
      }
      if (!/^K-[A-Z]+-\d{3}[a-z]?$/u.test(source)) {
        fail(`rpc-methods service ${name} has invalid source_rule: ${source}`);
        continue;
      }
      if (!kernelRuleSet.has(source)) {
        fail(`rpc-methods service ${name} references undefined kernel rule: ${source}`);
      }
    }
  }
  
  function checkProviderCatalogSourceTraceability(kernelRuleSet) {
    const catalog = readYaml('.nimi/spec/runtime/kernel/tables/provider-catalog.yaml');
    const providers = Array.isArray(catalog?.providers) ? catalog.providers : [];
    for (const item of providers) {
      const provider = String(item?.provider || '').trim();
      if (!provider) continue;
      const source = String(item?.source_rule || '').trim();
      if (!source) {
        fail(`provider-catalog provider ${provider} missing source_rule`);
        continue;
      }
      if (!/^K-[A-Z]+-\d{3}[a-z]?$/u.test(source)) {
        fail(`provider-catalog provider ${provider} has invalid source_rule: ${source}`);
        continue;
      }
      if (!kernelRuleSet.has(source)) {
        fail(`provider-catalog provider ${provider} references undefined kernel rule: ${source}`);
      }
    }
  }
  
  function checkReasonCodeSourceTraceability(kernelRuleSet) {
    const reasonTable = readYaml('.nimi/spec/runtime/kernel/tables/reason-codes.yaml');
    const codes = Array.isArray(reasonTable?.codes) ? reasonTable.codes : [];
    for (const code of codes) {
      const name = String(code?.name || '').trim();
      if (!name) continue;
      const source = String(code?.source_rule || '').trim();
      if (!source) {
        fail(`reason-codes code ${name} missing source_rule`);
        continue;
      }
      if (!/^K-[A-Z]+-\d{3}[a-z]?$/u.test(source)) {
        fail(`reason-codes code ${name} has invalid source_rule: ${source}`);
        continue;
      }
      if (!kernelRuleSet.has(source)) {
        fail(`reason-codes code ${name} references undefined kernel rule: ${source}`);
      }
    }
  }
  
  function checkCapabilityVocabularyMapping(kernelRuleSet) {
    const rel = '.nimi/spec/runtime/kernel/tables/capability-vocabulary-mapping.yaml';
    const doc = readYaml(rel) || {};
    const canonicalTokens = new Set(
      (Array.isArray(doc?.canonical_tokens) ? doc.canonical_tokens : [])
        .map((value) => String(value || '').trim())
        .filter(Boolean),
    );
    const localTokens = new Set(
      (Array.isArray(doc?.local_manifest_tokens) ? doc.local_manifest_tokens : [])
        .map((value) => String(value || '').trim())
        .filter(Boolean),
    );
    const localCategories = new Set(
      (Array.isArray(doc?.local_categories) ? doc.local_categories : [])
        .map((value) => String(value || '').trim())
        .filter(Boolean),
    );
    const mappings = Array.isArray(doc?.local_to_canonical) ? doc.local_to_canonical : [];
    const canonicalOnly = Array.isArray(doc?.canonical_only) ? doc.canonical_only : [];
  
    if (canonicalTokens.size === 0) fail(`${rel} canonical_tokens must not be empty`);
    if (localTokens.size === 0) fail(`${rel} local_manifest_tokens must not be empty`);
    if (mappings.length === 0) fail(`${rel} local_to_canonical must not be empty`);
  
    const mappedLocalTokens = new Set();
    for (const entry of mappings) {
      const localToken = String(entry?.local_token || '').trim();
      const canonicalToken = String(entry?.canonical_token || '').trim();
      const localCategory = String(entry?.local_category || '').trim();
      const sourceRule = String(entry?.source_rule || '').trim();
      if (!localToken || !localTokens.has(localToken)) {
        fail(`${rel} mapping references unknown local_token: ${localToken || '<empty>'}`);
      }
      if (!canonicalToken || !canonicalTokens.has(canonicalToken)) {
        fail(`${rel} mapping references unknown canonical_token: ${canonicalToken || '<empty>'}`);
      }
      if (localCategory && !localCategories.has(localCategory)) {
        fail(`${rel} mapping ${localToken} uses unknown local_category: ${localCategory}`);
      }
      if (!/^K-[A-Z]+-\d{3}[a-z]?$/u.test(sourceRule) || !kernelRuleSet.has(sourceRule)) {
        fail(`${rel} mapping ${localToken} has invalid source_rule: ${sourceRule || '<empty>'}`);
      }
      mappedLocalTokens.add(localToken);
    }
  
    for (const token of localTokens) {
      if (!mappedLocalTokens.has(token)) {
        fail(`${rel} local token missing mapping: ${token}`);
      }
    }
  
    for (const entry of canonicalOnly) {
      const canonicalToken = String(entry?.canonical_token || '').trim();
      if (!canonicalToken || !canonicalTokens.has(canonicalToken)) {
        fail(`${rel} canonical_only references unknown canonical_token: ${canonicalToken || '<empty>'}`);
      }
    }
  }
  
  function checkOrphanRules(kernelRuleSet) {
    const files = [...new Set([
      ...runtimeMarkdownFiles,
      ...kernelFiles.filter((rel) => rel.endsWith('.yaml')),
      ...domainFiles,
    ])];
    const refCounts = new Map();
    for (const rel of files) {
      if (!fs.existsSync(path.join(cwd, rel))) continue;
      const content = read(rel);
      for (const ruleId of collectReferencedRuntimeRuleIds(content, kernelRuleSet)) {
        refCounts.set(ruleId, (refCounts.get(ruleId) || 0) + 1);
      }
    }
  
    const orphans = [...kernelRuleSet].filter((ruleId) => (refCounts.get(ruleId) || 0) <= 1);
    if (orphans.length > 0) {
      fail(`runtime orphan kernel rules detected: ${orphans.join(', ')}`);
    }
  }
  
  function collectReferencedRuntimeRuleIds(content, kernelRuleSet) {
    const refs = new Set();
  
    for (const match of content.matchAll(/\bK-[A-Z]+-\d{3}[a-z]?\b/g)) {
      if (kernelRuleSet.has(match[0])) {
        refs.add(match[0]);
      }
    }
  
    for (const match of content.matchAll(/\b(K-[A-Z]+)-\*/g)) {
      const prefix = `${match[1]}-`;
      for (const ruleId of kernelRuleSet) {
        if (ruleId.startsWith(prefix)) {
          refs.add(ruleId);
        }
      }
    }
  
    for (const match of content.matchAll(/\b(K-[A-Z]+)-(\d{3})[~–-](\d{3})\b/g)) {
      const prefix = `${match[1]}-`;
      const start = Number.parseInt(match[2], 10);
      const end = Number.parseInt(match[3], 10);
      if (Number.isNaN(start) || Number.isNaN(end)) continue;
      const lower = Math.min(start, end);
      const upper = Math.max(start, end);
      for (const ruleId of kernelRuleSet) {
        if (!ruleId.startsWith(prefix)) continue;
        const suffix = ruleId.slice(prefix.length);
        const numeric = Number.parseInt(suffix.slice(0, 3), 10);
        if (!Number.isNaN(numeric) && numeric >= lower && numeric <= upper) {
          refs.add(ruleId);
        }
      }
    }
  
    return refs;
  }
  
  function checkRuleEvidence(kernelRuleSet) {
    const table = readYaml('.nimi/spec/runtime/kernel/tables/rule-evidence.yaml');
    if (!table) { fail('rule-evidence.yaml: failed to parse'); return; }
  
    const catalog = table.evidence_catalog || {};
    const catalogKeys = new Set(Object.keys(catalog));
    const rules = Array.isArray(table.rules) ? table.rules : [];
    const declaredTotal = Number(table?.rule_registry?.total_k_rules);
  
    if (rules.length === 0) {
      fail('rule-evidence.yaml: rules list is empty');
      return;
    }

    if (!Number.isInteger(declaredTotal) || declaredTotal <= 0) {
      fail('rule-evidence.yaml: rule_registry.total_k_rules must be a positive integer');
    }
  
    const evidenceRuleIds = new Set();
    for (const entry of rules) {
      const rid = String(entry?.rule_id || '').trim();
      if (!rid) { fail('rule-evidence.yaml: entry missing rule_id'); continue; }
      if (!/^K-[A-Z]+-\d{3}[a-z]?$/u.test(rid)) {
        fail(`rule-evidence.yaml: invalid rule_id format: ${rid}`);
      }
      if (evidenceRuleIds.has(rid)) {
        fail(`rule-evidence.yaml: duplicate rule_id: ${rid}`);
      }
      evidenceRuleIds.add(rid);
  
      if (!kernelRuleSet.has(rid)) {
        fail(`rule-evidence.yaml: rule_id not found in kernel: ${rid}`);
      }
  
      const requirement = String(entry?.evidence_requirement || '').trim();
      if (!['required', 'not_applicable', 'deferred'].includes(requirement)) {
        fail(`rule-evidence.yaml ${rid}: invalid evidence_requirement: ${requirement}`);
      }
  
      const refs = Array.isArray(entry?.evidence_refs) ? entry.evidence_refs : [];
      if (requirement === 'required' && refs.length === 0) {
        fail(`rule-evidence.yaml ${rid}: required evidence must have at least one evidence_ref`);
      }
      for (const ref of refs) {
        if (!catalogKeys.has(String(ref))) {
          fail(`rule-evidence.yaml ${rid}: unknown evidence_ref: ${ref}`);
        }
      }
    }
  
    // Every kernel rule must appear in rule-evidence
    for (const kid of kernelRuleSet) {
      if (!evidenceRuleIds.has(kid)) {
      fail(`rule-evidence.yaml: missing evidence requirement for kernel rule: ${kid}`);
      }
    }

    if (declaredTotal !== evidenceRuleIds.size) {
      fail(`rule-evidence.yaml: rule_registry.total_k_rules (${declaredTotal}) must match resolved rule evidence rows (${evidenceRuleIds.size})`);
    }
  }
  

  return {
    checkCapabilityVocabularyMapping,
    checkOrphanRules,
    checkProviderCatalogSourceTraceability,
    checkReasonCodeSourceTraceability,
    checkRpcMethodsSourceTraceability,
    checkRuleEvidence,
  };
}
