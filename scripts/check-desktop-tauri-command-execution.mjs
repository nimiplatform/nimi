#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const tableRel = '.nimi/spec/desktop/kernel/tables/command-execution-classification.yaml';
const tablePath = path.join(repoRoot, tableRel);

const allowedExecutionClasses = new Set([
  'ui_sync',
  'request_response_async',
  'background_job',
  'bounded_blocking_with_admission',
  'registered_disabled_stub',
]);
const allowedDormantClasses = new Set(['dormant_admitted', 'dead_for_removal']);

const riskPatterns = [
  { risk: 'blocking_http', pattern: /\b(?:reqwest::blocking|ureq::|attohttpc::|curl::|minreq::)\b/u },
  { risk: 'sync_dns_or_connect', pattern: /\b(?:ToSocketAddrs|TcpStream::connect|UdpSocket::connect)\b/u },
  { risk: 'runtime_bridge_block_on', pattern: /\bruntime_bridge::[a-zA-Z0-9_:]*block_on\b|\btauri::async_runtime::block_on\s*\(/u },
  { risk: 'block_on_variants', pattern: /\b(?:block_on\s*\(|Handle::current\(\)\.block_on|futures::executor::block_on|tokio::task::block_in_place)\b/u },
  { risk: 'process_command', pattern: /\b(?:std::process::Command|Command::new|sysinfo::System|which::which)\b/u },
  { risk: 'archive_or_compression', pattern: /\b(?:ZipArchive|tar::Archive|flate2::|zstd::|extract_archive|unpack_archive)\b/u },
  { risk: 'sqlite_sync', pattern: /\b(?:rusqlite::|Connection::open|\.execute\s*\(|\.query_row\s*\(|\.prepare\s*\()\b/u },
  { risk: 'std_fs', pattern: /\b(?:std::fs::|fs::(?:read|read_to_string|write|copy|rename|remove|remove_file|remove_dir|remove_dir_all|create_dir|create_dir_all|metadata|read_dir|canonicalize|File::open|OpenOptions::new))\b/u },
  { risk: 'native_dialog', pattern: /\b(?:rfd::|FileDialog|MessageDialog|blocking_show|blocking_pick)\b/u },
  { risk: 'thread_sleep', pattern: /\b(?:std::thread::sleep|thread::sleep)\s*\(/u },
  { risk: 'raw_thread_spawn', pattern: /\b(?:std::thread::spawn|thread::spawn)\s*\(/u },
  { risk: 'spawn_blocking', pattern: /\bspawn_blocking\s*\(/u },
  { risk: 'sync_lock_contention', pattern: /(?:\bstd::sync::(?:Mutex|RwLock)\b|\bparking_lot::(?:Mutex|RwLock)\b|[.]lock\s*\(|[.]read\s*\(|[.]write\s*\()/u },
  { risk: 'cpu_hash_or_codec', pattern: /\b(?:Sha256|sha2::|Digest::|blake3::|md5::|base64::|hex::encode|compute_hash|hash_file|verify_digest)\b/u },
  { risk: 'sync_socket_bind', pattern: /\b(?:TcpListener::bind|UdpSocket::bind)\b/u },
  { risk: 'os_browser_handoff', pattern: /\b(?:webbrowser::open|open::that|ShellExt::open|reveal_in_folder)\b/u },
  { risk: 'window_handoff', pattern: /\b(?:get_webview_window|set_focus|start_dragging|emit_to|app\.emit|window\.emit)\b/u },
  { risk: 'sync_keyring_dialog', pattern: /\b(?:keyring::|SecurityFramework|secret_service)\b/u },
];

const failures = [];

function fail(message) {
  failures.push(message);
}

function read(rel) {
  return fs.readFileSync(path.join(repoRoot, rel), 'utf8');
}

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'target' || entry.name === 'node_modules' || entry.name === '.git') continue;
      out.push(...walk(full));
    } else if (entry.name.endsWith('.rs')) {
      out.push(full);
    }
  }
  return out;
}

function lineOf(source, index) {
  return source.slice(0, index).split('\n').length;
}

function parseGenerateHandlerCommands(source, rel) {
  const marker = 'tauri::generate_handler!';
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) {
    throw new Error(`${rel} missing ${marker}`);
  }
  const openIndex = source.indexOf('[', markerIndex + marker.length);
  if (openIndex < 0) {
    throw new Error(`${rel} missing generate_handler opening bracket`);
  }

  let depth = 0;
  let closeIndex = -1;
  let state = 'code';
  for (let i = openIndex; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];

    if (state === 'line_comment') {
      if (ch === '\n') state = 'code';
      continue;
    }
    if (state === 'block_comment') {
      if (ch === '*' && next === '/') {
        state = 'code';
        i += 1;
      }
      continue;
    }
    if (state === 'string') {
      if (ch === '\\') {
        i += 1;
      } else if (ch === '"') {
        state = 'code';
      }
      continue;
    }
    if (state === 'char') {
      if (ch === '\\') {
        i += 1;
      } else if (ch === "'") {
        state = 'code';
      }
      continue;
    }

    if (ch === '/' && next === '/') {
      state = 'line_comment';
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      state = 'block_comment';
      i += 1;
      continue;
    }
    if (ch === '"') {
      state = 'string';
      continue;
    }
    if (ch === "'") {
      state = 'char';
      continue;
    }

    if (ch === '[') depth += 1;
    if (ch === ']') {
      depth -= 1;
      if (depth === 0) {
        closeIndex = i;
        break;
      }
    }
  }

  if (closeIndex < 0) {
    throw new Error(`${rel} generate_handler bracket parse did not close`);
  }

  const body = source.slice(openIndex + 1, closeIndex);
  const withoutComments = body
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/\/\/.*$/gmu, '');
  const commands = [];
  for (const raw of withoutComments.split(',')) {
    const ref = raw.trim();
    if (!ref) continue;
    const match = ref.match(/(?:^|::)([a-z][a-z0-9_]*)$/u);
    if (!match) {
      throw new Error(`${rel} contains unparsable generate_handler entry: ${ref}`);
    }
    commands.push({ name: match[1], ref });
  }
  return commands;
}

function extractFunctionBody(source, fnIndex) {
  const openIndex = source.indexOf('{', fnIndex);
  if (openIndex < 0) return '';
  let depth = 0;
  let state = 'code';
  for (let i = openIndex; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];
    if (state === 'line_comment') {
      if (ch === '\n') state = 'code';
      continue;
    }
    if (state === 'block_comment') {
      if (ch === '*' && next === '/') {
        state = 'code';
        i += 1;
      }
      continue;
    }
    if (state === 'string') {
      if (ch === '\\') i += 1;
      else if (ch === '"') state = 'code';
      continue;
    }
    if (state === 'char') {
      if (ch === '\\') i += 1;
      else if (ch === "'") state = 'code';
      continue;
    }
    if (ch === '/' && next === '/') {
      state = 'line_comment';
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      state = 'block_comment';
      i += 1;
      continue;
    }
    if (ch === '"') {
      state = 'string';
      continue;
    }
    if (ch === "'") {
      state = 'char';
      continue;
    }
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(openIndex, i + 1);
    }
  }
  return source.slice(openIndex);
}

function scanAnnotatedCommands(scanRoots) {
  const commands = [];
  const commandPattern = /#\s*\[\s*tauri::command[^\]]*\]\s*(?:pub(?:\([^)]*\))?\s+)?(?:(async)\s+)?fn\s+([a-zA-Z0-9_]+)/gu;
  for (const rootRel of scanRoots) {
    const rootAbs = path.join(repoRoot, rootRel);
    for (const fileAbs of walk(rootAbs)) {
      const rel = path.relative(repoRoot, fileAbs).split(path.sep).join('/');
      const source = fs.readFileSync(fileAbs, 'utf8');
      let match;
      while ((match = commandPattern.exec(source)) !== null) {
        const body = extractFunctionBody(source, match.index);
        commands.push({
          name: match[2],
          kind: match[1] ? 'async' : 'sync',
          rel,
          line: lineOf(source, match.index),
          body,
        });
      }
    }
  }
  return commands;
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  const single = String(value || '').trim();
  return single ? [single] : [];
}

function matchSpec(commandName, entries) {
  for (const entry of entries) {
    const match = entry?.match || {};
    const exacts = normalizeArray(match.exact);
    if (exacts.includes(commandName)) return entry;
    const prefix = String(match.prefix || '').trim();
    if (prefix && commandName.startsWith(prefix)) return entry;
    const regex = String(match.regex || '').trim();
    if (regex && new RegExp(regex, 'u').test(commandName)) return entry;
  }
  return null;
}

function directRisks(command) {
  const risks = [];
  for (const item of riskPatterns) {
    if (item.pattern.test(command.body)) risks.push(item.risk);
  }
  return [...new Set(risks)].sort();
}

function validateTable(table) {
  const risks = new Set((Array.isArray(table?.risk_catalog) ? table.risk_catalog : []).map((item) => String(item?.risk || '').trim()).filter(Boolean));
  if (risks.size === 0) fail(`${tableRel} risk_catalog must not be empty`);
  for (const item of riskPatterns) {
    if (!risks.has(item.risk)) fail(`${tableRel} risk_catalog missing required risk: ${item.risk}`);
  }

  const families = Array.isArray(table?.registered_command_families) ? table.registered_command_families : [];
  if (families.length === 0) fail(`${tableRel} registered_command_families must not be empty`);
  const dormant = Array.isArray(table?.dormant_command_families) ? table.dormant_command_families : [];
  if (dormant.length === 0) fail(`${tableRel} dormant_command_families must not be empty`);

  for (const entry of families) {
    const family = String(entry?.family || '').trim() || '<unnamed>';
    if (!allowedExecutionClasses.has(String(entry?.execution_class || ''))) {
      fail(`${tableRel} ${family} has invalid execution_class: ${entry?.execution_class || '<empty>'}`);
    }
    for (const risk of normalizeArray(entry?.admitted_risks)) {
      if (!risks.has(risk)) fail(`${tableRel} ${family} admits unknown risk: ${risk}`);
    }
  }
  for (const entry of dormant) {
    const family = String(entry?.family || '').trim() || '<unnamed>';
    if (!allowedDormantClasses.has(String(entry?.dormant_class || ''))) {
      fail(`${tableRel} ${family} has invalid dormant_class: ${entry?.dormant_class || '<empty>'}`);
    }
  }
}

function main() {
  if (!fs.existsSync(tablePath)) {
    fail(`missing ${tableRel}`);
    return;
  }
  const table = YAML.parse(fs.readFileSync(tablePath, 'utf8')) || {};
  validateTable(table);

  const surfaceRel = String(table?.registered_surface?.generate_handler || '').trim();
  if (!surfaceRel) {
    fail(`${tableRel} missing registered_surface.generate_handler`);
    return;
  }
  const registered = parseGenerateHandlerCommands(read(surfaceRel), surfaceRel);
  const minimumRegisteredCount = Number(table?.registered_surface?.minimum_registered_count || 1);
  if (registered.length < minimumRegisteredCount) {
    fail(`${surfaceRel} registered command count ${registered.length} is below minimum ${minimumRegisteredCount}`);
  }
  if (registered.length === 0) {
    fail(`${surfaceRel} parsed zero registered commands`);
  }

  const scanRoots = normalizeArray(table?.scan_roots);
  if (scanRoots.length === 0) fail(`${tableRel} scan_roots must not be empty`);
  for (const root of scanRoots) {
    if (!fs.existsSync(path.join(repoRoot, root))) fail(`${tableRel} scan root does not exist: ${root}`);
  }

  const annotated = scanAnnotatedCommands(scanRoots);
  if (annotated.length === 0) fail(`${tableRel} scan roots produced zero annotated commands`);
  const annotatedByName = new Map();
  for (const command of annotated) {
    if (!annotatedByName.has(command.name)) annotatedByName.set(command.name, []);
    annotatedByName.get(command.name).push(command);
  }

  const registeredNames = new Set(registered.map((item) => item.name));
  const registeredFamilies = Array.isArray(table?.registered_command_families) ? table.registered_command_families : [];
  const dormantFamilies = Array.isArray(table?.dormant_command_families) ? table.dormant_command_families : [];
  const remediationFamilies = new Set();
  const dormantRemediationFamilies = new Set();

  for (const command of registered) {
    const definitions = annotatedByName.get(command.name) || [];
    if (definitions.length === 0) {
      fail(`registered command ${command.name} has no #[tauri::command] definition in scan roots`);
      continue;
    }
    const spec = matchSpec(command.name, registeredFamilies);
    if (!spec) {
      fail(`registered command ${command.name} has no execution classification`);
      continue;
    }
    if (matchSpec(command.name, dormantFamilies)) {
      fail(`registered command ${command.name} also matches dormant classification`);
    }
    if (spec.remediation_required) remediationFamilies.add(String(spec.family || command.name));
    if (spec.explicit_admission_required) {
      const admittedCommands = new Set(normalizeArray(spec.admitted_commands));
      if (!admittedCommands.has(command.name)) {
        fail(`registered command ${command.name} matched ${spec.family} but is missing from admitted_commands`);
      }
    }

    for (const definition of definitions) {
      const risks = directRisks(definition);
      if (risks.length === 0) continue;
      const admitted = new Set(normalizeArray(spec.admitted_risks));
      const missing = risks.filter((risk) => !admitted.has(risk));
      if (missing.length === 0) continue;
      if (spec.remediation_required) continue;
      fail(`registered command ${command.name} at ${definition.rel}:${definition.line} has unadmitted direct risks for ${spec.family}: ${missing.join(', ')}`);
    }
  }

  const dormantCandidates = annotated.filter((command) => !registeredNames.has(command.name));
  for (const command of dormantCandidates) {
    const spec = matchSpec(command.name, dormantFamilies);
    if (!spec) {
      fail(`annotated unregistered command ${command.name} at ${command.rel}:${command.line} has no dormant/dead classification`);
      continue;
    }
    if (matchSpec(command.name, registeredFamilies)) {
      fail(`annotated unregistered command ${command.name} at ${command.rel}:${command.line} also matches active registered classification`);
    }
    if (spec?.remediation_required) dormantRemediationFamilies.add(String(spec.family || command.name));
  }

  console.log(`[desktop-tauri-command-execution] registered=${registered.length} annotated=${annotated.length} dormant=${dormantCandidates.length} remediationFamilies=${remediationFamilies.size} dormantRemediationFamilies=${dormantRemediationFamilies.size}`);
  if (remediationFamilies.size > 0) {
    console.log(`[desktop-tauri-command-execution] remediation_required=${[...remediationFamilies].sort().join(', ')}`);
  }
  if (dormantRemediationFamilies.size > 0) {
    console.log(`[desktop-tauri-command-execution] dormant_remediation_required=${[...dormantRemediationFamilies].sort().join(', ')}`);
  }
}

try {
  main();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`[desktop-tauri-command-execution] ${failure}`);
  process.exit(1);
}
