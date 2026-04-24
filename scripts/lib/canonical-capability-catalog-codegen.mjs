// Shared renderer for the canonical capability catalog TS codegen and drift
// checker. Pure functions; no filesystem access.

const ALLOWED_SECTIONS = new Set([
  'chat',
  'tts',
  'stt',
  'image',
  'video',
  'embed',
  'voice',
  'world',
]);
const ALLOWED_EDITOR_KINDS = new Set([
  'text',
  'image',
  'video',
  'audio-transcribe',
  'audio-synthesize',
  'voice-workflow',
  null,
]);
const ALLOWED_EVIDENCE_CLASSES = new Set(['turn', 'job', 'workflow']);
const ALLOWED_SOURCE_TABLES = new Set(['provider-capabilities', 'local-adapter-routing']);

export const CATALOG_CONSTANTS = Object.freeze({
  ALLOWED_SECTIONS: Array.from(ALLOWED_SECTIONS),
  ALLOWED_EDITOR_KINDS: Array.from(ALLOWED_EDITOR_KINDS),
  ALLOWED_EVIDENCE_CLASSES: Array.from(ALLOWED_EVIDENCE_CLASSES),
  ALLOWED_SOURCE_TABLES: Array.from(ALLOWED_SOURCE_TABLES),
});

export function validateCanonicalCapabilityCatalog(doc) {
  const errors = [];
  if (!doc || typeof doc !== 'object') {
    errors.push('catalog yaml root must be a mapping');
    return { capabilities: [], deferred: [], errors };
  }
  const capabilities = Array.isArray(doc.capabilities) ? doc.capabilities : [];
  const deferred = Array.isArray(doc.deferred) ? doc.deferred : [];

  if (capabilities.length === 0) {
    errors.push('capabilities must not be empty');
  }

  const seenIds = new Set();
  for (const [index, row] of capabilities.entries()) {
    const prefix = `capabilities[${index}]`;
    if (!row || typeof row !== 'object') {
      errors.push(`${prefix}: row must be a mapping`);
      continue;
    }
    const capabilityId = typeof row.capabilityId === 'string' ? row.capabilityId.trim() : '';
    if (!capabilityId) {
      errors.push(`${prefix}: capabilityId is required`);
    } else if (seenIds.has(capabilityId)) {
      errors.push(`${prefix}: duplicate capabilityId ${capabilityId}`);
    } else {
      seenIds.add(capabilityId);
    }
    const section = typeof row.section === 'string' ? row.section.trim() : '';
    if (!ALLOWED_SECTIONS.has(section)) {
      errors.push(`${prefix} ${capabilityId}: section ${section || '<empty>'} not allowed`);
    }
    const editorKind = row.editorKind ?? null;
    if (!ALLOWED_EDITOR_KINDS.has(editorKind)) {
      errors.push(`${prefix} ${capabilityId}: editorKind ${editorKind} not allowed`);
    }
    const sourceRef = row.sourceRef;
    if (!sourceRef || typeof sourceRef !== 'object') {
      errors.push(`${prefix} ${capabilityId}: sourceRef is required`);
    } else {
      const table = typeof sourceRef.table === 'string' ? sourceRef.table.trim() : '';
      const capability = typeof sourceRef.capability === 'string' ? sourceRef.capability.trim() : '';
      if (!ALLOWED_SOURCE_TABLES.has(table)) {
        errors.push(`${prefix} ${capabilityId}: sourceRef.table ${table || '<empty>'} not allowed`);
      }
      if (!capability) {
        errors.push(`${prefix} ${capabilityId}: sourceRef.capability is required`);
      }
    }
    const additionalRuntimeTables = row.additionalRuntimeTables;
    if (additionalRuntimeTables != null) {
      if (!Array.isArray(additionalRuntimeTables)) {
        errors.push(`${prefix} ${capabilityId}: additionalRuntimeTables must be an array when present`);
      } else {
        for (const [addIdx, addEntry] of additionalRuntimeTables.entries()) {
          if (!addEntry || typeof addEntry !== 'object') {
            errors.push(`${prefix} ${capabilityId}: additionalRuntimeTables[${addIdx}] must be a mapping`);
            continue;
          }
          const addTable = typeof addEntry.table === 'string' ? addEntry.table.trim() : '';
          const addCap = typeof addEntry.capability === 'string' ? addEntry.capability.trim() : '';
          if (!ALLOWED_SOURCE_TABLES.has(addTable)) {
            errors.push(`${prefix} ${capabilityId}: additionalRuntimeTables[${addIdx}].table ${addTable || '<empty>'} not allowed`);
          }
          if (!addCap) {
            errors.push(`${prefix} ${capabilityId}: additionalRuntimeTables[${addIdx}].capability is required`);
          }
          if (addTable && addTable === (typeof sourceRef?.table === 'string' ? sourceRef.table.trim() : '')) {
            errors.push(`${prefix} ${capabilityId}: additionalRuntimeTables[${addIdx}].table duplicates primary sourceRef.table`);
          }
        }
      }
    }
    const i18nKeys = row.i18nKeys;
    if (!i18nKeys || typeof i18nKeys !== 'object') {
      errors.push(`${prefix} ${capabilityId}: i18nKeys is required`);
    } else {
      for (const key of ['title', 'subtitle', 'detail']) {
        const value = typeof i18nKeys[key] === 'string' ? i18nKeys[key].trim() : '';
        if (!value) {
          errors.push(`${prefix} ${capabilityId}: i18nKeys.${key} is required`);
        }
      }
    }
    const runtimeEvidenceClass = typeof row.runtimeEvidenceClass === 'string'
      ? row.runtimeEvidenceClass.trim()
      : '';
    if (!ALLOWED_EVIDENCE_CLASSES.has(runtimeEvidenceClass)) {
      errors.push(`${prefix} ${capabilityId}: runtimeEvidenceClass ${runtimeEvidenceClass || '<empty>'} not allowed`);
    }
  }

  for (const [index, entry] of deferred.entries()) {
    const prefix = `deferred[${index}]`;
    if (!entry || typeof entry !== 'object') {
      errors.push(`${prefix}: entry must be a mapping`);
      continue;
    }
    const capability = typeof entry.capability === 'string' ? entry.capability.trim() : '';
    const table = typeof entry.table === 'string' ? entry.table.trim() : '';
    const reason = typeof entry.reason === 'string' ? entry.reason.trim() : '';
    const sourceRule = typeof entry.source_rule === 'string' ? entry.source_rule.trim() : '';
    if (!capability) errors.push(`${prefix}: capability is required`);
    if (!ALLOWED_SOURCE_TABLES.has(table)) {
      errors.push(`${prefix} ${capability}: table ${table || '<empty>'} not allowed`);
    }
    if (!reason) errors.push(`${prefix} ${capability}: reason is required`);
    if (!sourceRule) errors.push(`${prefix} ${capability}: source_rule is required`);
  }

  return { capabilities, deferred, errors };
}

export function flattenProviderCapabilityTokens(providerCapabilitiesDoc) {
  const tokens = new Set();
  const providers = Array.isArray(providerCapabilitiesDoc?.providers)
    ? providerCapabilitiesDoc.providers
    : [];
  for (const provider of providers) {
    const list = Array.isArray(provider?.capabilities) ? provider.capabilities : [];
    for (const token of list) {
      if (typeof token === 'string' && token.trim()) {
        tokens.add(token.trim());
      }
    }
  }
  return tokens;
}

export function flattenLocalAdapterRoutingTokens(localAdapterRoutingDoc) {
  const tokens = new Set();
  const routes = Array.isArray(localAdapterRoutingDoc?.routes)
    ? localAdapterRoutingDoc.routes
    : [];
  for (const route of routes) {
    const token = typeof route?.capability === 'string' ? route.capability.trim() : '';
    if (token) tokens.add(token);
  }
  return tokens;
}

function tsStringLiteral(value) {
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function renderEditorKind(value) {
  return value == null ? 'null' : tsStringLiteral(value);
}

export function renderCanonicalCapabilityCatalogModule(doc) {
  const { capabilities, deferred, errors } = validateCanonicalCapabilityCatalog(doc);
  if (errors.length > 0) {
    throw new Error(`invalid canonical capability catalog:\n- ${errors.join('\n- ')}`);
  }
  const sortedCaps = [...capabilities].sort((a, b) =>
    String(a.capabilityId).localeCompare(String(b.capabilityId)),
  );
  const sortedDeferred = [...deferred].sort((a, b) =>
    String(a.capability).localeCompare(String(b.capability)),
  );

  const lines = [];
  lines.push('// GENERATED FILE — DO NOT EDIT.');
  lines.push('// Source: .nimi/spec/platform/kernel/tables/canonical-capability-catalog.yaml');
  lines.push('// Emitter: scripts/gen-canonical-capability-catalog.mjs');
  lines.push('// Authority: P-CAPCAT-001 / P-CAPCAT-002 / P-CAPCAT-003');
  lines.push('');
  lines.push('export type CanonicalCapabilitySectionId =');
  const sections = CATALOG_CONSTANTS.ALLOWED_SECTIONS.map((value) => `  | '${value}'`);
  lines.push(sections.join('\n') + ';');
  lines.push('');
  lines.push('export type CanonicalCapabilityEditorKind =');
  const editorKinds = CATALOG_CONSTANTS.ALLOWED_EDITOR_KINDS.map((value) =>
    value === null ? '  | null' : `  | '${value}'`,
  );
  lines.push(editorKinds.join('\n') + ';');
  lines.push('');
  lines.push('export type CanonicalCapabilityRuntimeEvidenceClass =');
  const evidenceClasses = CATALOG_CONSTANTS.ALLOWED_EVIDENCE_CLASSES.map((value) => `  | '${value}'`);
  lines.push(evidenceClasses.join('\n') + ';');
  lines.push('');
  lines.push('export type CanonicalCapabilitySourceTable =');
  const sourceTables = CATALOG_CONSTANTS.ALLOWED_SOURCE_TABLES.map((value) => `  | '${value}'`);
  lines.push(sourceTables.join('\n') + ';');
  lines.push('');
  lines.push('export interface CanonicalCapabilitySourceRef {');
  lines.push('  readonly table: CanonicalCapabilitySourceTable;');
  lines.push('  readonly capability: string;');
  lines.push('}');
  lines.push('');
  lines.push('export interface CanonicalCapabilityI18nKeys {');
  lines.push('  readonly title: string;');
  lines.push('  readonly subtitle: string;');
  lines.push('  readonly detail: string;');
  lines.push('}');
  lines.push('');
  lines.push('export interface CanonicalCapabilityDescriptor {');
  lines.push('  readonly capabilityId: string;');
  lines.push('  readonly section: CanonicalCapabilitySectionId;');
  lines.push('  readonly editorKind: CanonicalCapabilityEditorKind;');
  lines.push('  readonly sourceRef: CanonicalCapabilitySourceRef;');
  lines.push('  readonly additionalRuntimeTables: ReadonlyArray<CanonicalCapabilitySourceRef>;');
  lines.push('  readonly i18nKeys: CanonicalCapabilityI18nKeys;');
  lines.push('  readonly runtimeEvidenceClass: CanonicalCapabilityRuntimeEvidenceClass;');
  lines.push('}');
  lines.push('');
  lines.push('export interface CanonicalCapabilityDeferredEntry {');
  lines.push('  readonly capability: string;');
  lines.push('  readonly table: CanonicalCapabilitySourceTable;');
  lines.push('  readonly reason: string;');
  lines.push('  readonly sourceRule: string;');
  lines.push('}');
  lines.push('');
  lines.push('export const CANONICAL_CAPABILITY_CATALOG: ReadonlyArray<CanonicalCapabilityDescriptor> = Object.freeze([');
  for (const row of sortedCaps) {
    lines.push('  Object.freeze({');
    lines.push(`    capabilityId: ${tsStringLiteral(row.capabilityId)},`);
    lines.push(`    section: ${tsStringLiteral(row.section)},`);
    lines.push(`    editorKind: ${renderEditorKind(row.editorKind ?? null)},`);
    lines.push('    sourceRef: Object.freeze({');
    lines.push(`      table: ${tsStringLiteral(row.sourceRef.table)},`);
    lines.push(`      capability: ${tsStringLiteral(row.sourceRef.capability)},`);
    lines.push('    }),');
    const addList = Array.isArray(row.additionalRuntimeTables) ? row.additionalRuntimeTables : [];
    if (addList.length > 0) {
      lines.push('    additionalRuntimeTables: Object.freeze([');
      for (const add of addList) {
        lines.push('      Object.freeze({');
        lines.push(`        table: ${tsStringLiteral(add.table)},`);
        lines.push(`        capability: ${tsStringLiteral(add.capability)},`);
        lines.push('      }),');
      }
      lines.push('    ]),');
    } else {
      lines.push('    additionalRuntimeTables: Object.freeze([]),');
    }
    lines.push('    i18nKeys: Object.freeze({');
    lines.push(`      title: ${tsStringLiteral(row.i18nKeys.title)},`);
    lines.push(`      subtitle: ${tsStringLiteral(row.i18nKeys.subtitle)},`);
    lines.push(`      detail: ${tsStringLiteral(row.i18nKeys.detail)},`);
    lines.push('    }),');
    lines.push(`    runtimeEvidenceClass: ${tsStringLiteral(row.runtimeEvidenceClass)},`);
    lines.push('  }),');
  }
  lines.push(']);');
  lines.push('');
  lines.push('export const CANONICAL_CAPABILITY_CATALOG_BY_ID: Readonly<Record<string, CanonicalCapabilityDescriptor>> = Object.freeze(');
  lines.push('  CANONICAL_CAPABILITY_CATALOG.reduce<Record<string, CanonicalCapabilityDescriptor>>((acc, row) => {');
  lines.push('    acc[row.capabilityId] = row;');
  lines.push('    return acc;');
  lines.push('  }, {}),');
  lines.push(');');
  lines.push('');
  lines.push('export const CANONICAL_CAPABILITY_IDS: ReadonlyArray<string> = Object.freeze(');
  lines.push('  CANONICAL_CAPABILITY_CATALOG.map((row) => row.capabilityId),');
  lines.push(');');
  lines.push('');
  lines.push('export const CANONICAL_CAPABILITY_DEFERRED: ReadonlyArray<CanonicalCapabilityDeferredEntry> = Object.freeze([');
  for (const entry of sortedDeferred) {
    lines.push('  Object.freeze({');
    lines.push(`    capability: ${tsStringLiteral(entry.capability)},`);
    lines.push(`    table: ${tsStringLiteral(entry.table)},`);
    lines.push(`    reason: ${tsStringLiteral(entry.reason)},`);
    lines.push(`    sourceRule: ${tsStringLiteral(entry.source_rule)},`);
    lines.push('  }),');
  }
  lines.push(']);');
  lines.push('');
  return lines.join('\n');
}
