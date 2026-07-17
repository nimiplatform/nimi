#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function collectLocalDevelopmentSupervisorParityViolations(sources) {
  const violations = [];
  requireBoth(sources.tsAuthoritySummary, /LOCAL_DEVELOPMENT_HEARTBEAT_INTERVAL_MS = 3_000/u, sources.rustAuthoritySummary, /PRESENCE_HEARTBEAT_INTERVAL: Duration = Duration::from_millis\(3_000\)/u, 'heartbeat must remain 3000ms', violations);
  requireBoth(sources.tsHost, /REBUILD_DEBOUNCE_MS = 450/u, sources.rustSupervisor, /SOURCE_REBUILD_DEBOUNCE: Duration = Duration::from_millis\(450\)/u, 'rebuild debounce must remain 450ms', violations);
  requireBoth(sources.tsHost, /Date\.now\(\) \+ 60_000/u, sources.rustSupervisor, /RENDERER_READY_TIMEOUT: Duration = Duration::from_secs\(60\)/u, 'renderer readiness must remain 60s', violations);
  for (const route of ['/v1/start', '/v1/status', '/v1/cancel']) {
    if (!sources.tsHost.includes(`'${route}'`) || !sources.rustHttp.includes(`"${route}"`)) {
      violations.push(`route parity missing for ${route}`);
    }
  }
  for (const [tsField, rustField] of [
    ['schemaVersion: 1', 'schema_version: 1'],
    ["desktopAppId: 'nimi.desktop'", 'desktop_app_id: "nimi.desktop".to_string()'],
    ['desktopPid: this.processId', 'desktop_pid: std::process::id()'],
    ['endpoint: this.endpoint', 'endpoint: endpoint.to_string()'],
    ['startedAt: this.startedAt', 'started_at: started_at.to_string()'],
    ['lastHeartbeatAt: this.now().toISOString()', 'last_heartbeat_at:'],
  ]) {
    if (!sources.tsAuthoritySummary.includes(tsField) || !sources.rustDomain.includes(rustField)) {
      violations.push(`presence schema parity missing for ${tsField}`);
    }
  }
  requireBoth(
    sources.tsHost,
    /createDesktopElectronLocalDevelopmentProjectionPublisher/u,
    sources.rustMod,
    /authority_summary::spawn_heartbeat/u,
    'authority summary publisher parity missing',
    violations,
  );
  requireBoth(
    sources.tsAuthoritySummary,
    /'authority-summary\.v1\.json'/u,
    sources.rustMod,
    /"authority-summary\.v1\.json"/u,
    'authority summary path parity missing',
    violations,
  );
  requireBoth(
    sources.tsAuthoritySummary,
    /this\.control\.getAuthoritySummary\(\)/u,
    sources.rustAuthoritySummary,
    /runtime_bridge::get_local_development_authority_summary\(\)/u,
    'authority summary protected RPC parity missing',
    violations,
  );
  requireBoth(
    sources.tsAuthoritySummary,
    /this\.removeAuthoritySummary\(\)/u,
    sources.rustAuthoritySummary,
    /fs::remove_file\(&authority_summary_path\)/u,
    'authority summary failure cleanup parity missing',
    violations,
  );
  for (const [tsField, rustField] of [
    ['schemaVersion: 1', 'schema_version: 1'],
    ["desktopAppId: 'nimi.desktop'", 'desktop_app_id: "nimi.desktop".to_string()'],
    ['desktopPid: processId', 'desktop_pid: std::process::id()'],
    ['capturedAt', 'captured_at'],
    ['developerMode', 'developer_mode'],
    ['projectAuthorization', 'project_authorization'],
    ['grantSummary', 'grant_summary'],
    ['activeCount', 'active_count'],
    ['dormantCount', 'dormant_count'],
    ['pendingCount', 'pending_count'],
    ['supersededCount', 'superseded_count'],
    ['reasonCode', 'reason_code'],
  ]) {
    if (!sources.tsAuthoritySummary.includes(tsField)
      || !sources.rustAuthoritySummary.includes(rustField)) {
      violations.push(`authority summary schema parity missing for ${tsField}`);
    }
  }
  if (!/AUTHORITY_SUMMARY_MAX_AGE_MS = 12_000/u.test(sources.doctor)) {
    violations.push('authority summary TTL must remain 12000ms');
  }
  for (const scriptContract of [
    "scripts.dev !== 'nimi-app dev --shell electron'",
    "scripts['dev:shell'] !== 'nimi-app dev'",
    "scripts['dev:renderer'] !== `vite --host 127.0.0.1 --port ${new URL(rendererOrigin).port} --strictPort`",
    "typeof scripts['build:electron'] !== 'string'",
  ]) {
    if (!sources.tsPlan.includes(scriptContract)) violations.push(`TS package-script contract missing: ${scriptContract}`);
  }
  for (const rustContract of [
    'require_exact_package_script(&package, "dev", &format!("nimi-app dev --shell {shell}"))',
    'require_exact_package_script(&package, "dev:shell", "nimi-app dev")',
    'require_renderer_script(&package, &renderer_origin)',
    'require_package_script(&package, "build:electron")',
  ]) {
    if (!sources.rustPlan.includes(rustContract)) violations.push(`Rust package-script contract missing: ${rustContract}`);
  }
  return violations;
}

async function readSources() {
  const files = {
    tsHost: 'apps/desktop/src-electron/local-development-host.ts',
    tsAuthoritySummary: 'apps/desktop/src-electron/local-development-authority-summary.ts',
    tsPlan: 'apps/desktop/src-electron/local-development-plan.ts',
    rustSupervisor: 'apps/desktop/src-tauri/src/desktop_local_development/supervisor.rs',
    rustMod: 'apps/desktop/src-tauri/src/desktop_local_development/mod.rs',
    rustHttp: 'apps/desktop/src-tauri/src/desktop_local_development/http.rs',
    rustPlan: 'apps/desktop/src-tauri/src/desktop_local_development/plan.rs',
    rustDomain: 'apps/desktop/src-tauri/src/desktop_local_development/domain.rs',
    rustAuthoritySummary: 'apps/desktop/src-tauri/src/desktop_local_development/authority_summary.rs',
    doctor: 'scripts/doctor-dev.mjs',
  };
  return Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, relativePath]) => [
    key,
    await readFile(path.join(repoRoot, relativePath), 'utf8'),
  ])));
}

function requireBoth(left, leftPattern, right, rightPattern, message, violations) {
  if (!leftPattern.test(left) || !rightPattern.test(right)) violations.push(message);
}

function isMainModule() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  const violations = collectLocalDevelopmentSupervisorParityViolations(await readSources());
  if (violations.length > 0) {
    process.stderr.write(`Local-development supervisor parity violations:\n- ${violations.join('\n- ')}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write('Local-development supervisor parity check passed\n');
  }
}
