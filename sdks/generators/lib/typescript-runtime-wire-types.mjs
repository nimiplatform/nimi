import { generatedBy, readText, writeText } from './context.mjs';
import { quote, runtimeEnumSchemas, runtimeMessageSchemas } from './types.mjs';

function runtimeSchemaSources(runtime) {
  const sources = new Map();
  for (const schema of runtime.schema_types.message_schemas || []) {
    sources.set(schema.name, schema.source_file);
  }
  for (const schema of runtime.schema_types.enum_schemas || []) {
    sources.set(schema.name, schema.source_file);
  }
  return sources;
}

function tsRuntimePublicWireImportPath(sourceFile) {
  return `../../core-generated/runtime-protobuf/${String(sourceFile).replace(/^proto\//, '').replace(/\.proto$/, '')}`;
}

function tsIdentifier(value) {
  const identifier = String(value || '').replace(/[^A-Za-z0-9_$]/g, '_');
  if (/^[A-Za-z_$]/.test(identifier)) {
    return identifier;
  }
  return `_${identifier}`;
}

function groupRuntimeTypesByImport(runtime, typeNames, importPathForSource = tsRuntimePublicWireImportPath) {
  const sources = runtimeSchemaSources(runtime);
  const grouped = new Map();
  for (const typeName of [...new Set(typeNames)].sort()) {
    const sourceFile = sources.get(typeName);
    if (!sourceFile) {
      throw new Error(`Runtime proto schema source missing for TypeScript type: ${typeName}`);
    }
    const importPath = importPathForSource(sourceFile);
    const values = grouped.get(importPath) || [];
    values.push(typeName);
    grouped.set(importPath, values);
  }
  return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b));
}

const runtimeWireTypeShardDefinitions = [
  {
    id: 'identity-app',
    path: 'sdks/typescript/runtime/wire-types/identity-app-types.ts',
    exportPath: './identity-app-types',
    matches: (importPath) => [
      '/account',
      '/app',
      '/artifact_service',
      '/audit',
      '/auth',
      '/common',
      '/connector',
      '/external_agent',
      '/grant',
      '/knowledge',
    ].some((segment) => importPath.includes(segment)),
  },
  {
    id: 'agent-participation',
    path: 'sdks/typescript/runtime/wire-types/agent-participation-types.ts',
    exportPath: './agent-participation-types',
    matches: (importPath) => importPath.includes('/agent_'),
  },
  {
    id: 'local-memory',
    path: 'sdks/typescript/runtime/wire-types/local-memory-types.ts',
    exportPath: './local-memory-types',
    matches: (importPath) => [
      '/local_runtime',
      '/memory',
      '/model',
      '/runtime_target_identity',
    ].some((segment) => importPath.includes(segment)),
  },
  {
    id: 'ai-scenario',
    path: 'sdks/typescript/runtime/wire-types/ai-scenario-types.ts',
    exportPath: './ai-scenario-types',
    matches: () => true,
  },
];

function runtimeWireTypeShard(importPath) {
  const shard = runtimeWireTypeShardDefinitions.find((definition) => definition.matches(importPath));
  if (!shard) {
    throw new Error(`Runtime wire type shard missing for ${importPath}`);
  }
  return shard;
}

function runtimeWireTypeShardGroups(runtime) {
  const groups = runtimeWireTypeShardDefinitions.map((definition) => ({
    ...definition,
    imports: [],
  }));
  const groupById = new Map(groups.map((group) => [group.id, group]));
  for (const [importPath, names] of groupRuntimeTypesByImport(
    runtime,
    runtimeMessageSchemas(runtime).map((schema) => schema.name),
  )) {
    const shard = runtimeWireTypeShard(importPath);
    groupById.get(shard.id).imports.push({ importPath, names });
  }
  return groups.filter((group) => group.imports.length > 0);
}

function renderRuntimeWireTypeImportExport(importPath, names) {
  const members = names.map((name) => `  ${name},`).join('\n');
  return `import type {\n${members}\n} from ${quote(importPath)};\n\nexport type {\n${members}\n};`;
}

function upperSnakeCase(value) {
  return String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
}

function runtimeEnumMemberName(schema, entries, protoValueName) {
  const protobufTsPrefix = `${upperSnakeCase(schema.name)}_`;
  const stripsTypePrefix = entries.length > 0
    && entries.every((entry) => String(entry.name).startsWith(protobufTsPrefix));
  const stripped = stripsTypePrefix
    ? String(protoValueName).slice(protobufTsPrefix.length)
    : String(protoValueName);
  return tsIdentifier(stripped || protoValueName);
}

function runtimeEnumValueEntries(schema) {
  const source = readText(schema.source_file);
  const match = source.match(new RegExp(`\\benum\\s+${schema.name}\\s*\\{([\\s\\S]*?)\\}`));
  if (!match) {
    throw new Error(`Runtime proto enum block missing for ${schema.name} in ${schema.source_file}`);
  }
  return [...match[1].matchAll(/\b([A-Z][A-Z0-9_]*)\s*=\s*(\d+)\s*;/g)]
    .map((entry) => ({ name: entry[1], number: Number(entry[2]) }));
}

const failClosedRuntimeWireEnumNames = new Set([
  'AgentSourceMaterializationSourceKind',
  'AgentSourceMaterializationChallengeState',
  'AgentSourceMaterializationUploadState',
  'AgentSourceMaterializationComponentKind',
  'AgentSourceMaterializationProofAlgorithm',
  'AgentSourceMaterializationKeyUse',
  'AgentSourceMaterializationPacketSchemaVersion',
  'AgentSourceMaterializationBundleManifestSchemaVersion',
  'AgentSourceMaterializationPayloadAssemblyVersion',
  'AgentSourceMaterializationReasonCode',
  'AgentLocalSourceContextState',
  'AgentLocalSourceCoverageSection',
  'AgentLocalSourceCoverageState',
  'AgentTurnContextState',
  'AgentTurnContextLaneId',
  'AgentTurnContextLaneState',
  'AgentTurnContextTruncationReason',
  'AgentContextProjectionReasonCode',
  'AgentLocalSourceContextSchemaVersion',
  'AgentLocalSourceSnapshotSchemaVersion',
  'AgentTurnContextSummarySchemaVersion',
  'AgentTurnContextManifestSchemaVersion',
  'AgentTurnContextCompilerSchemaVersion',
]);

function renderRuntimeWireEnum(schema) {
  const entries = runtimeEnumValueEntries(schema);
  const used = new Set();
  const members = entries.map((entry) => {
    const memberName = runtimeEnumMemberName(schema, entries, entry.name);
    if (used.has(memberName)) {
      throw new Error(`Runtime proto enum ${schema.name} has duplicate TypeScript member ${memberName}`);
    }
    used.add(memberName);
    return `  ${memberName} = ${entry.number},`;
  }).join('\n');
  const enumDeclaration = `export enum ${schema.name} {\n${members}\n}`;
  if (!failClosedRuntimeWireEnumNames.has(schema.name)) {
    return enumDeclaration;
  }
  const knownValues = entries.map((entry) => entry.number).join(', ');
  return `${enumDeclaration}\n\nconst KNOWN_${upperSnakeCase(schema.name)}_VALUES: ReadonlySet<number> = new Set([${knownValues}]);\n\nexport function isKnown${schema.name}(value: unknown): value is ${schema.name} {\n  return typeof value === 'number' && Number.isInteger(value) && KNOWN_${upperSnakeCase(schema.name)}_VALUES.has(value);\n}\n\nexport function assertKnown${schema.name}(value: unknown): ${schema.name} {\n  if (!isKnown${schema.name}(value)) {\n    throw new TypeError(${quote(`Unknown ${schema.name} numeric value`)} + ': ' + String(value));\n  }\n  return value;\n}`;
}

const runtimeWireEnumShardDefinitions = [
  {
    id: 'identity-app',
    path: 'sdks/typescript/runtime/wire-types/identity-app-enums.ts',
    exportPath: './identity-app-enums',
    matches: (name) => [
      'Account',
      'App',
      'Authorization',
      'Caller',
      'Catalog',
      'Connector',
      'External',
      'Knowledge',
      'Presence',
      'Scoped',
      'Workspace',
    ].some((prefix) => name.startsWith(prefix)),
  },
  {
    id: 'agent-participation',
    path: 'sdks/typescript/runtime/wire-types/agent-participation-enums.ts',
    exportPath: './agent-participation-enums',
    matches: (name) => name.startsWith('Agent'),
  },
  {
    id: 'agent-companion',
    path: 'sdks/typescript/runtime/wire-types/agent-companion-enums.ts',
    exportPath: './agent-companion-enums',
    matches: (name) => [
      'Avatar',
      'Companion',
      'Conversation',
    ].some((prefix) => name.startsWith(prefix)),
  },
  {
    id: 'agent-delegation',
    path: 'sdks/typescript/runtime/wire-types/agent-delegation-enums.ts',
    exportPath: './agent-delegation-enums',
    matches: (name) => name.startsWith('Delegated'),
  },
  {
    id: 'agent-participation-policy',
    path: 'sdks/typescript/runtime/wire-types/agent-participation-policy-enums.ts',
    exportPath: './agent-participation-policy-enums',
    matches: (name) => [
      'Hook',
      'Participation',
      'RealmGroup',
      'RuntimeAgent',
    ].some((prefix) => name.startsWith(prefix)),
  },
  {
    id: 'local-memory',
    path: 'sdks/typescript/runtime/wire-types/local-memory-enums.ts',
    exportPath: './local-memory-enums',
    matches: (name) => [
      'Gpu',
      'Local',
      'Memory',
      'Merge',
      'Model',
      'Policy',
      'RuntimeHealth',
    ].some((prefix) => name.startsWith(prefix)),
  },
  {
    id: 'reason-code',
    path: 'sdks/typescript/runtime/wire-types/reason-code-enums.ts',
    exportPath: './reason-code-enums',
    matches: (name) => name === 'ReasonCode',
  },
  {
    id: 'ai-scenario',
    path: 'sdks/typescript/runtime/wire-types/ai-scenario-enums.ts',
    exportPath: './ai-scenario-enums',
    matches: () => true,
  },
];

function runtimeWireEnumShard(schema) {
  const shard = runtimeWireEnumShardDefinitions.find((definition) => definition.matches(schema.name));
  if (!shard) {
    throw new Error(`Runtime wire enum shard missing for ${schema.name}`);
  }
  return shard;
}

function runtimeWireEnumShardGroups(runtime) {
  const groups = runtimeWireEnumShardDefinitions.map((definition) => ({
    ...definition,
    schemas: [],
  }));
  const groupById = new Map(groups.map((group) => [group.id, group]));
  for (const schema of runtimeEnumSchemas(runtime)) {
    const shard = runtimeWireEnumShard(schema);
    groupById.get(shard.id).schemas.push(schema);
  }
  return groups.filter((group) => group.schemas.length > 0);
}

function renderGeneratedHeader() {
  return `// @generated by ${generatedBy}
// DO NOT EDIT MANUALLY.`;
}

export function writeTypescriptRuntimeWireTypes(runtime) {
  const runtimeWireTypeGroups = runtimeWireTypeShardGroups(runtime);
  for (const group of runtimeWireTypeGroups) {
    writeText(group.path, `${renderGeneratedHeader()}

${group.imports.map(({ importPath, names }) => renderRuntimeWireTypeImportExport(importPath, names)).join('\n\n')}
`);
  }

  const runtimeWireEnumGroups = runtimeWireEnumShardGroups(runtime);
  for (const group of runtimeWireEnumGroups) {
    writeText(group.path, `${renderGeneratedHeader()}

${group.schemas.map(renderRuntimeWireEnum).join('\n\n')}
`);
  }

  writeText('sdks/typescript/runtime/wire-types/index.ts', `${renderGeneratedHeader()}

${runtimeWireTypeGroups.map((group) => `export type * from ${quote(group.exportPath)};`).join('\n')}

${runtimeWireEnumGroups.map((group) => `export * from ${quote(group.exportPath)};`).join('\n')}
`);
}
