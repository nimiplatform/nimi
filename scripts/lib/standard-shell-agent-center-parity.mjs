import YAML from 'yaml';

export function verifyAgentCenterParity(sources) {
  const failures = [];
  const catalog = YAML.parse(sources.canonical);
  const capability = catalog?.capabilities?.find((entry) => entry?.id === 'agent-center');
  const canonical = (capability?.operations ?? []).map((operation) => ({
    id: operation.id,
    command: operation.command,
    negativeStates: operation.negative_states ?? [],
  }));
  const canonicalRefs = canonical.map((operation) => `agent-center.${operation.id}`);

  const tsBlock = between(sources.typescriptCatalog, "    id: 'agent-center',", "    id: 'platform-projection',");
  const typescript = [...tsBlock.matchAll(/\{\s*id:\s*'([^']+)',\s*command:\s*'([^']+)',\s*negativeStates:\s*\[([^\]]*)\]/gu)]
    .map((match) => ({ id: match[1], command: match[2], negativeStates: quoted(match[3]) }));

  const rustBlock = between(sources.rustCatalog, 'id: "agent-center",', 'id: "platform-projection",');
  const rust = [...rustBlock.matchAll(/StandardShellOperation\s*\{([\s\S]*?)\n\s*\},/gu)]
    .map((match) => ({
      id: first(match[1], /id:\s*"([^"]+)"/u),
      command: first(match[1], /command:\s*"([^"]+)"/u),
      negativeStates: quoted(first(match[1], /negative_states:\s*&\[([\s\S]*?)\]/u)),
    }));

  const rendererRefs = refs(sources.rendererAliases);
  const rendererAliasValues = [...sources.rendererAliases.matchAll(
    /NIMI_STANDARD_SHELL_COMMANDS\['agent-center\.[^']+'\]\]:\s*'([^']+)'/gu,
  )].map((match) => match[1]);

  const registrationBlock = between(
    sources.tauriRegistration,
    'pub const STANDARD_AGENT_CENTER_COMMANDS',
    'pub const STANDARD_PLATFORM_PROJECTION_COMMANDS',
  );
  const tauriRegistration = [...registrationBlock.matchAll(/command_name:\s*"([^"]+)"/gu)]
    .map((match) => match[1]);

  const electronBlock = between(
    sources.electronHost,
    'const AGENT_CENTER_DISPATCH',
    '} as const satisfies Readonly<Record<string, AgentCenterDispatchHandler>>;',
  );
  const electronRefs = refs(electronBlock);

  compare(failures, 'TS capability catalog tuple', typescript, canonical);
  compare(failures, 'Rust capability catalog tuple', rust, canonical);
  compare(failures, 'renderer Tauri aliases', rendererRefs, canonicalRefs);
  compare(failures, 'Electron actual dispatch table', electronRefs, canonicalRefs);
  compare(failures, 'Tauri command registration', tauriRegistration, rendererAliasValues);

  for (const retired of ['agent-center.configGet', 'agent-center.configSet']) {
    if ([...canonicalRefs, ...rendererRefs, ...electronRefs].includes(retired)) {
      failures.push(`standard Agent Center surfaces must not expose retired ${retired}`);
    }
  }
  return failures;
}

function refs(content) {
  return [...content.matchAll(/NIMI_STANDARD_SHELL_COMMANDS\['(agent-center\.[^']+)'\]/gu)]
    .map((match) => match[1]);
}

function quoted(content = '') {
  return [...content.matchAll(/["']([^"']+)["']/gu)].map((match) => match[1]);
}

function first(content, pattern) {
  return content.match(pattern)?.[1] ?? '';
}

function between(content, startMarker, endMarker) {
  const start = content.indexOf(startMarker);
  if (start < 0) return '';
  const end = content.indexOf(endMarker, start + startMarker.length);
  return end < 0 ? content.slice(start) : content.slice(start, end);
}

function compare(failures, label, actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures.push(`${label}: Agent Center parity drift; expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}
