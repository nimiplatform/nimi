export const CI_LANES = {
  'docs-contract': 'docs_changed',
  'core-static': 'core_changed',
  'workspace-regression': 'workspace_changed',
  'kit-native-tests': 'kit_native_changed',
  'sdk-quality': 'sdk_changed',
  'runtime-quality': 'runtime_changed',
  'proto-quality': 'proto_changed',
  'desktop-web-quality': 'desktop_changed',
};

export function selectCiScope(files, { full = false } = {}) {
  const paths = files.map((file) => file.replaceAll('\\', '/'));
  const codePaths = paths.filter((file) => !/\.(?:md|mdx)$/u.test(file) || file.endsWith('.authority.md'));
  const touches = (pattern) => full || codePaths.some((file) => pattern.test(file));
  const shared = touches(/^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|\.github\/workflows\/ci\.yml)$/u);
  const scripts = touches(/^scripts\//u);
  const config = touches(/^config\//u);
  const authority = touches(/^\.nimi\/(?:spec\/|config\/|methodology\/)/u);
  const proto = shared || touches(/^(?:proto\/|runtime\/(?:gen|proto)\/|scripts\/(?:proto-breaking|check-proto-drift|run-buf)[^/]*\.mjs$)/u);
  const sdk = shared || config || proto || touches(/^(?:sdks\/|\.nimi\/spec\/sdks\/)/u);
  const kit = shared || config || sdk || touches(/^(?:kit\/|\.nimi\/spec\/platform\/ui-design-system\.authority\.)/u);
  const cognition = shared || touches(/^(?:nimi-cognition\/|go\.work(?:\.sum)?$)/u);
  const runtime = cognition || config || proto || touches(/^(?:runtime\/|npm-packages\/|\.goreleaser\.yml$|\.nimi\/spec\/runtime\/|scripts\/(?:build-runtime|dev-runtime)\.mjs$)/u);
  const kitNative = shared || proto || touches(/^kit\/shell\/(?:capabilities|protected-local|protected-local-node|tauri)\//u);
  const desktopNative = shared || proto || touches(/^(?:apps\/desktop\/product-control-|kit\/shell\/protected-local\/)/u);
  const desktop = desktopNative || touches(/^apps\/desktop\/(?!AGENTS\.md$)/u);
  const filters = new Set();

  // pnpm resolves transitive workspace consumers; only source-copy dependencies
  // that are not package dependencies need an explicit edge here.
  if (shared || scripts || config || authority) filters.add('*');
  if (sdk) filters.add('...@nimiplatform/sdk');
  else if (kit) filters.add('...@nimiplatform/kit');
  if (sdk || kit) filters.add('@nimiplatform/app-tools');
  for (const file of paths) {
    if (/\.(?:md|mdx)$/u.test(file)) continue;
    const app = file.match(/^(apps\/[^/]+)\//u);
    if (app) filters.add(`./${app[1]}`);
    const gateway = file.match(/^(gateways\/[^/]+)\//u);
    if (gateway) filters.add(`./${gateway[1]}`);
    if (file.startsWith('apps/lab/')) filters.add('@nimiplatform/app-tools');
    if (file.startsWith('app-tools/')) filters.add('@nimiplatform/app-tools');
    if (file.startsWith('nimi2d/')) filters.add('./nimi2d');
  }

  return {
    docs_changed: full || paths.some((file) => /^(?:docs\/|examples\/)|\.(?:md|mdx)$/u.test(file)),
    core_changed: shared || scripts || config || authority || filters.size > 0
      || touches(/^(?:\.github\/|licenses\/|LICENSE$|\.gitignore$|\.gitattributes$|\.editorconfig$)/u),
    workspace_changed: filters.size > 0,
    workspace_filters: [...filters],
    scripts_changed: scripts || shared,
    authority_changed: authority || shared,
    kit_changed: kit,
    sdk_changed: sdk,
    sdk_adapter_upstream_changed: shared || touches(/^sdks\/typescript\//u),
    sdk_conformance_changed: config || proto || touches(/^(?:sdks\/(?:conformance|generators)\/|\.nimi\/spec\/sdks\/)/u),
    proto_changed: proto,
    runtime_changed: runtime,
    cognition_changed: cognition,
    desktop_changed: desktop,
    desktop_native_changed: desktopNative,
    kit_native_changed: kitNative,
  };
}

export function assertCiResults(needs) {
  if (needs.changes?.result !== 'success') throw new Error('CI path selection did not pass');
  const failures = [];
  for (const [lane, flag] of Object.entries(CI_LANES)) {
    const selected = needs.changes.outputs[flag];
    if (!['true', 'false'].includes(selected)) throw new Error(`missing CI selection: ${flag}`);
    const result = needs[lane]?.result;
    const expected = selected === 'true' ? ['success'] : ['skipped'];
    if (!expected.includes(result)) failures.push(`${lane}=${result} (selected=${selected})`);
  }
  if (failures.length > 0) throw new Error(`CI lanes did not pass: ${failures.join(', ')}`);
}
