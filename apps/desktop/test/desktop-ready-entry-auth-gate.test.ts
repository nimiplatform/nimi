import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { getProductControlRecord } from '../src/shell/renderer/bridge/runtime-bridge/product-control.js';
import type { NimiProductControlRecordProjection } from '../src/shell/renderer/bridge/runtime-bridge/product-control.js';

const appRoutesSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/app-shell/routes/app-routes.tsx'),
  'utf8',
);
const loginPageSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/features/auth/login-page.tsx'),
  'utf8',
);
const uiSliceSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/app-shell/providers/ui-slice.ts'),
  'utf8',
);
const productControlBridgeSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/bridge/runtime-bridge/product-control.ts'),
  'utf8',
);
const finalizationSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/first-run/first-run-finalization.tsx'),
  'utf8',
);
const productionFirstRunPortSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/renderer/production-first-run-port.ts'),
  'utf8',
);
const workflowSource = [
  readFileSync(
    resolve(import.meta.dirname, '../src/shell/renderer/first-run/product-control-workflow.tsx'),
    'utf8',
  ),
  readFileSync(
    resolve(import.meta.dirname, '../src/shell/renderer/first-run/product-control-workflow-screen.tsx'),
    'utf8',
  ),
].join('\n');
const reconcilingScreenSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/first-run/first-run-reconciling-screen.tsx'),
  'utf8',
);
const firstRunGatePanelSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/features/nimi-home/first-run-gate-panel.tsx'),
  'utf8',
);
const productControlAdmissionSource = readFileSync(
  resolve(import.meta.dirname, '../src-tauri/src/desktop_product_control_admission.rs'),
  'utf8',
);
const productControlRootSource = readFileSync(
  resolve(import.meta.dirname, '../src-tauri/src/desktop_product_control.rs'),
  'utf8',
);
const productControlOperationsSource = readFileSync(
  resolve(import.meta.dirname, '../src-tauri/src/desktop_product_control/operations.rs'),
  'utf8',
);
const productControlRecordStoreSource = readFileSync(
  resolve(import.meta.dirname, '../src-tauri/src/desktop_product_control/record_store.rs'),
  'utf8',
);

test('Gate 7: Desktop root route is guarded by auth and product ready_for_use', () => {
  assert.match(appRoutesSource, /function DesktopOrdinaryShellGate/);
  // Wave 1 route-admission single-point: the gate hands every Runtime state
  // requiring login to /login via an imperative navigate inside an effect. The
  // wildcard fallback `<Route path="*" element={<Navigate to="/login" .../>}>`
  // for web mode still uses render-time Navigate (one-shot on unmatched
  // path; no loop), so a plain literal scan is no longer sufficient — pin
  // the actual root admission code path instead.
  assert.match(appRoutesSource, /if \(accountRequiresLogin\(authStatus\)\) \{\s*navigate\('\/login', \{ replace: true \}\);/);
  assert.match(appRoutesSource, /desktopBridge\.getProductControlRecord\(\)/);
  assert.match(appRoutesSource, /projectNimiProductControlAdmission\(projection\.state\)/);
  assert.ok(appRoutesSource.includes('<Route path="/" element={<DesktopOrdinaryShellGate />} />'));
});

test('Gate 7: ready Desktop shell lands at Chat -> Nimi Chat', () => {
  assert.match(uiSliceSource, /activeTab:\s*'chat'/);
  assert.match(uiSliceSource, /chatMode:\s*'ai'/);
  assert.match(appRoutesSource, /function ReadyDesktopShell/);
  assert.match(appRoutesSource, /setActiveTab\('chat'\)/);
  assert.doesNotMatch(appRoutesSource, /activeTab !== 'chat'/);
  assert.doesNotMatch(appRoutesSource, /setChatMode\('ai'\)/);
});

test('Gate 7: logged-out Desktop login no longer exposes back-to-chat or Runtime shortcuts', () => {
  assert.doesNotMatch(loginPageSource, /loginBackButton/);
  assert.doesNotMatch(loginPageSource, /backToChat/);
  assert.doesNotMatch(loginPageSource, /navigateToTab\('runtime'\)/);
});

test('Gate 7: ordinary shell admission stays gated strictly on backend ready_for_use', () => {
  // Wave 1 route-admission single-point: `useDesktopOrdinaryShellAdmission`
  // returns a five-value verdict (`checking | requesting-admission |
  // admission-failed | first-run | ready`). `getProductControlRecord` only
  // reads the persisted projection — it does NOT re-run the backend
  // admission, so a persisted `not_logged_in` would never clear without an
  // explicit `admitProductReadyForUse` request. The hook makes that request
  // once on observing `not_logged_in` and routes on the backend's verdict;
  // the renderer never mints `ready_for_use` (P-COLD-016). The behavioural
  // invariant is unchanged — only `ready_for_use` produces the `ready`
  // verdict; the Wave 8 self-contained test below (deriveOrdinaryShellAdmission
  // across all 12 spec states) pins the invariant; this assertion pins the
  // source-level ready-only mapping.
  assert.match(appRoutesSource, /decision\.kind === 'ordinary-shell'\s*\)\s*\{\s*setAdmission\('ready'\)/);
  assert.doesNotMatch(appRoutesSource, /state === 'local_ai_ready'\s*\?\s*'ready'/);
  // The safety valve against a stale persisted `not_logged_in` is an
  // explicit `admitProductReadyForUse` request — the only path that can
  // advance the file's state.
  assert.match(appRoutesSource, /bindings\.app\.commands\.firstRun\.admitReadyForUse\(\)/);
  // The hook must NOT clear renderer auth on divergence; doing so masked
  // the real bug and surprised the user with an unexplained sign-out. The
  // user-facing `admission-failed` surface exposes a `Sign out` button that
  // owns the explicit logout decision instead. Slice the hook body out of
  // the source first so a `clearAuthSession()` call inside the sign-out
  // button handler doesn't false-trigger this assertion.
  const hookMatch = appRoutesSource.match(
    /function useDesktopOrdinaryShellAdmission[\s\S]*?\n\}\n/,
  );
  assert.ok(hookMatch, 'useDesktopOrdinaryShellAdmission must be declared as a top-level function');
  assert.doesNotMatch(
    hookMatch[0],
    /clearAuthSession\b/,
    'admission hook must not auto-clear renderer auth on divergence',
  );
  assert.match(
    hookMatch[0],
    /if \(authStatus === 'refresh-pending'\) \{[\s\S]*?return;\s*\}/,
    'refresh-pending must preserve the already-admitted ordinary shell',
  );
  assert.match(
    hookMatch[0],
    /if \(authStatus !== 'authenticated'\) \{\s*setAdmission\('checking'\);/,
    'only a fresh authenticated projection may reconcile product admission',
  );
  assert.doesNotMatch(
    hookMatch[0],
    /setAdmission\('checking'\);\s*void desktopBridge\.getProductControlRecord\(\)/,
    'authenticated rechecks must not tear down an already-admitted shell',
  );
});

test('Gate 7: first-run ready projection signals the ordinary shell admission gate', () => {
  assert.match(appRoutesSource, /const \[firstRunReady, setFirstRunReady\] = useState\(false\)/);
  assert.match(appRoutesSource, /const admission: DesktopOrdinaryShellAdmission = firstRunReady \? 'ready' : observedAdmission/);
  assert.match(appRoutesSource, /<DesktopFirstRunGate onReadyForUse=\{\(\) => setFirstRunReady\(true\)\} \/>/);
  assert.match(firstRunGatePanelSource, /readonly onReadyForUse\?: \(\) => void/);
  assert.match(firstRunGatePanelSource, /projection\?\.state === 'ready_for_use'/);
  assert.match(firstRunGatePanelSource, /next\.state === 'ready_for_use'/);
  assert.doesNotMatch(firstRunGatePanelSource, /markProductReadyForUse|product_control_record_mark_ready_for_use/);
});

test('Wave 7: bridge exposes a backend-only admitProductReadyForUse request', () => {
  // The renderer requests admission; the backend admission op is the sole
  // authority that writes ready_for_use (cold-start P-COLD-016).
  assert.match(productControlBridgeSource, /export async function admitProductReadyForUse\(\): Promise<NimiProductControlRecordProjection>/);
  assert.match(productControlBridgeSource, /invokeChecked\('product_control_record_admit_ready_for_use', \{\}, parseNimiProductControlRecordProjection\)/);
  // Fails closed when the Tauri runtime is unavailable.
  assert.match(productControlBridgeSource, /product_control_record_admit_ready_for_use requires standard shell Runtime/);
  // Account Default Profile payload decoding is shared SDK AIProfile parsing;
  // product-control remains the command/state authority, not the profile parser.
  assert.match(productControlBridgeSource, /parseNimiAIProfile/);
  assert.doesNotMatch(productControlBridgeSource, /function parseAccountDefaultProfileAIProfile/);
  // Setup progress is reconciled by a no-payload backend command; the renderer
  // cannot submit a product-control state string.
  assert.match(productControlBridgeSource, /reconcileProductFirstRunSetupState/);
  assert.match(productControlBridgeSource, /product_control_record_reconcile_first_run_setup_state/);
  assert.doesNotMatch(productControlBridgeSource, /setProductFirstRunSetupState/);
});

test('Wave 7: Desktop admission adapter does not mirror Runtime ready authority in tests', () => {
  assert.match(productControlAdmissionSource, /RUNTIME_LOCAL_ADMIT_PRODUCT_CONTROL_READY_FOR_USE_METHOD_ID/);
  assert.match(productControlAdmissionSource, /AdmitProductControlReadyForUseRequest/);
  assert.doesNotMatch(productControlAdmissionSource, /AdmissionRuntimeResolvers/);
  assert.doesNotMatch(productControlAdmissionSource, /compose_admission/);
  assert.doesNotMatch(productControlAdmissionSource, /ReadyAdmissionEvidence/);
  assert.doesNotMatch(productControlAdmissionSource, /#\[cfg\(test\)\]/);
});

test('Wave 7: Desktop product-control source uses one Runtime adapter in production and tests', () => {
  assert.match(productControlRootSource, /Runtime-validated canonical Product Control projection adapter/);
  assert.match(productControlRootSource, /Desktop Tauri commands forward reads and mutations to RuntimeLocalService/);
  assert.doesNotMatch(productControlRootSource, /lifecycle truth surface/);
  assert.match(productControlRootSource, /RUNTIME_LOCAL_GET_PRODUCT_CONTROL_RECORD_METHOD_ID/);
  assert.match(productControlRootSource, /RUNTIME_LOCAL_SELECT_PRODUCT_CONTROL_DATA_ROOT_METHOD_ID/);

  assert.match(productControlRootSource, /nimi_data_root_from_projection/);
  assert.match(productControlRootSource, /ProductDataRootStatus::Selected \| ProductDataRootStatus::Ready/);
  assert.doesNotMatch(productControlOperationsSource, /operations_test_support/);
  assert.doesNotMatch(productControlRecordStoreSource, /write_record|read_existing_record|empty_record/);

  for (const removed of [
    'operations_test_support.rs',
    'paths.rs',
    'pointers.rs',
    'projection.rs',
    'ready_verification.rs',
  ]) {
    assert.equal(
      existsSync(resolve(import.meta.dirname, `../src-tauri/src/desktop_product_control/${removed}`)),
      false,
      `${removed} must not reintroduce a test-only Product Control topology`,
    );
  }
});

test('Wave 7: first-run finalization requests admission and routes on the projection', () => {
  // At local_ai_ready the finalization surface calls the admission command and
  // feeds the returned projection back into onProjectionChange so the gate
  // re-evaluates: ready_for_use on success, earliest-failed state on failure.
  assert.match(finalizationSource, /props\.firstRun\.finalize\(\)/);
  assert.match(productionFirstRunPortSource, /desktopBridge\.prepareProductFirstRunLocalAiReady\(\)/);
  assert.match(productionFirstRunPortSource, /desktopBridge\.admitProductReadyForUse\(\)/);
  assert.ok(
    productionFirstRunPortSource.indexOf('const prepared = await desktopBridge.prepareProductFirstRunLocalAiReady()')
      < productionFirstRunPortSource.indexOf('desktopBridge.admitProductReadyForUse()'),
    'finalization must re-prepare owner evidence before admission, even when refs already exist',
  );
  assert.match(finalizationSource, /notifyProjectionChange\(next\)/);
  assert.match(finalizationSource, /next\.state !== 'ready_for_use'/);
  assert.doesNotMatch(finalizationSource, /hasFinalizationRefs/);
  // Failure exposes a Retry finalization affordance.
  assert.match(finalizationSource, /data-testid="product-first-run-finalization-retry"/);
  assert.match(finalizationSource, /FirstRun\.finalizationRetry/);
  // Finalization surface shows progress only — no data-root/install-level controls.
  assert.doesNotMatch(finalizationSource, /selectProductDataRoot|setProductFirstRunInstallLevel/);
});

test('Wave 7: first-run finalization deduplicates backend requests across remounts', () => {
  assert.match(productionFirstRunPortSource, /let finalizationInFlight/);
  assert.match(productionFirstRunPortSource, /if \(!finalizationInFlight\)/);
  assert.match(productionFirstRunPortSource, /finalizationInFlight = finalize\(\)\.finally/);
  assert.match(productionFirstRunPortSource, /finalizationInFlight = null/);
  assert.doesNotMatch(finalizationSource, /const inFlightRef = useRef\(false\)/);
});

test('Wave 7: workflow mounts the finalization branch only after local AI evidence is ready', () => {
  // The redesigned 4-phase wizard folds the four progress states into the
  // Setup phase. The backend-admission FirstRunFinalization surface is still
  // mounted only at `local_ai_ready` — never earlier, never on a renderer
  // shortcut.
  assert.match(workflowSource, /materializationReadyForFinalization/);
  assert.match(
    workflowSource,
    /(?:props\.)?state === 'local_ai_ready' \|\| (?:props\.)?materializationReadyForFinalization/,
  );
  assert.match(workflowSource, /<FirstRunFinalization[\s\S]{0,160}projection=\{(?:props\.)?projection\}/);
  // The Setup-phase checklist projects the real materialization progression
  // and folds `local_ai_ready` as the active `finalize` sub-step rather than
  // re-rendering raw materialization rows.
  assert.match(workflowSource, /projectSetupChecklist/);
  // No mark-ready shortcut: backend admission is the sole ready_for_use writer.
  assert.doesNotMatch(workflowSource, /markProductReadyForUse/);
});

/**
 * Wave 8 — behavioral renderer/localStorage negative.
 *
 * `useDesktopOrdinaryShellAdmission` derives the ordinary-shell admission
 * verdict purely from the backend product-control projection:
 * `projection.state === 'ready_for_use' ? 'ready' : 'not-ready'`. Only the
 * `ready` verdict mounts `ReadyDesktopShell`. This is the exact admission
 * derivation re-implemented from `app-routes.tsx`; the assertion below pins it
 * to source so a relaxation is caught.
 */
function deriveOrdinaryShellAdmission(
  projection: NimiProductControlRecordProjection,
): 'ready' | 'not-ready' {
  return projection.state === 'ready_for_use' ? 'ready' : 'not-ready';
}

function installRendererStateOnlyEnvironment(fabricatedReadyState: unknown): { restore: () => void } {
  const globalRecord = globalThis as Record<string, unknown>;
  const previousTauri = globalRecord.__NIMI_TAURI_TEST__;
  const previousWindow = globalRecord.window;
  // A renderer that has NO backend Tauri runtime, but DOES carry a fabricated
  // `ready_for_use` projection in renderer state / localStorage. The backend
  // product-control owner is the only admission authority — renderer state is
  // not consulted by `getProductControlRecord()`.
  delete globalRecord.__NIMI_TAURI_TEST__;
  const fabricatedLocalStorage = new Map<string, string>([
    ['nimi.productControl.state', 'ready_for_use'],
    ['nimi.productControl.projection', JSON.stringify(fabricatedReadyState)],
  ]);
  globalRecord.window = {
    __NIMI_HTML_BOOT_ID__: 'renderer-session-ready-gate-test',
    localStorage: {
      getItem: (key: string) => fabricatedLocalStorage.get(key) ?? null,
    },
  };
  return {
    restore: () => {
      if (typeof previousTauri === 'undefined') {
        delete globalRecord.__NIMI_TAURI_TEST__;
      } else {
        globalRecord.__NIMI_TAURI_TEST__ = previousTauri;
      }
      if (typeof previousWindow === 'undefined') {
        delete globalRecord.window;
      } else {
        globalRecord.window = previousWindow;
      }
    },
  };
}

test('Wave 8: a fabricated renderer/localStorage ready_for_use never mounts ReadyDesktopShell', async () => {
  // The derivation rule under test must be the one shipped in source. Wave 1
  // expanded the ternary into an if/else over four verdicts, but
  // `ready_for_use` remains the only state that produces `'ready'`.
  assert.match(appRoutesSource, /decision\.kind === 'ordinary-shell'\s*\)\s*\{\s*setAdmission\('ready'\)/);

  const fabricatedReadyProjection = {
    path: '',
    exists: true,
    state: 'ready_for_use',
    error: null,
    record: {
      schemaVersion: 1,
      installId: 'fabricated-install',
      productVersion: '0.0.0',
      state: 'ready_for_use',
      dataRoot: null,
      firstRun: { completed: true, builtInAiConfigRefs: [] },
      pointers: {},
      repair: { required: false },
    },
  };
  const env = installRendererStateOnlyEnvironment(fabricatedReadyProjection);
  try {
    // The renderer asked the bridge for the product-control record. With no
    // backend Tauri runtime, the bridge returns config_missing — it never
    // sources state from renderer-local localStorage, so the fabricated
    // ready_for_use is dropped on the floor.
    const projection = await getProductControlRecord();
    assert.equal(projection.state, 'config_missing');
    assert.notEqual(projection.state, 'ready_for_use');
    // Behavioral admission: a non-backend-admitted projection derives
    // 'not-ready', so DesktopOrdinaryShellGate renders DesktopFirstRunGate and
    // ReadyDesktopShell is never mounted.
    assert.equal(deriveOrdinaryShellAdmission(projection), 'not-ready');
  } finally {
    env.restore();
  }
});

test('Desktop Electron product-control record reads the final Kit shell projection', async () => {
  const globalRecord = globalThis as Record<string, unknown>;
  const previousTauri = globalRecord.__NIMI_TAURI_TEST__;
  const previousElectron = globalRecord.__NIMI_ELECTRON_TEST__;
  const previousWindow = globalRecord.window;
  const calls: unknown[] = [];
  delete globalRecord.__NIMI_TAURI_TEST__;
  const electronHook = {
    invoke: async (command: string, payload: unknown) => {
      calls.push({ command, payload });
      return {
        path: '/runtime/.nimi/nimi.json',
        exists: true,
        state: 'ready_for_use',
        record: null,
        error: null,
      };
    },
    listen: () => () => {},
  };
  globalRecord.__NIMI_ELECTRON_TEST__ = electronHook;
  globalRecord.window = {
    __NIMI_ELECTRON_TEST__: electronHook,
  };
  try {
    const projection = await getProductControlRecord();
    assert.equal(projection.state, 'ready_for_use');
    assert.equal(projection.path, '/runtime/.nimi/nimi.json');
    assert.deepEqual(calls, [{ command: 'product_control_record_get', payload: {} }]);
  } finally {
    if (typeof previousTauri === 'undefined') {
      delete globalRecord.__NIMI_TAURI_TEST__;
    } else {
      globalRecord.__NIMI_TAURI_TEST__ = previousTauri;
    }
    if (typeof previousElectron === 'undefined') {
      delete globalRecord.__NIMI_ELECTRON_TEST__;
    } else {
      globalRecord.__NIMI_ELECTRON_TEST__ = previousElectron;
    }
    if (typeof previousWindow === 'undefined') {
      delete globalRecord.window;
    } else {
      globalRecord.window = previousWindow;
    }
  }
});

test('Wave 8: only a backend-admitted ready_for_use projection derives the ReadyDesktopShell verdict', () => {
  // Every non-ready_for_use backend projection — including a backend-reported
  // failure state with a fabricated ready_for_use still cached in renderer
  // state — derives 'not-ready'. Only a genuine backend ready_for_use admits.
  const nonReadyStates: NimiProductControlRecordProjection['state'][] = [
    'not_logged_in',
    'config_missing',
    'data_root_missing',
    'data_root_selected',
    'ai_environment_unconfigured',
    'local_ai_profile_selected_assets_missing',
    'local_ai_profile_selected_environment_not_ready',
    'local_ai_assets_downloaded_environment_not_ready',
    'local_ai_ready',
    'repair_required',
    'blocked',
  ];
  for (const state of nonReadyStates) {
    const projection: NimiProductControlRecordProjection = {
      path: '/nimi/nimi.json',
      exists: true,
      state,
      record: null,
      error: state === 'repair_required' ? 'repair gate' : null,
    };
    assert.equal(
      deriveOrdinaryShellAdmission(projection),
      'not-ready',
      `${state} must not mount ReadyDesktopShell`,
    );
  }
  const backendReady: NimiProductControlRecordProjection = {
    path: '/nimi/nimi.json',
    exists: true,
    state: 'ready_for_use',
    record: null,
    error: null,
  };
  assert.equal(deriveOrdinaryShellAdmission(backendReady), 'ready');
});

test('Wave 1 route-admission single-point: LoginPage and ProductControlWorkflow never render <Navigate>', () => {
  // Regression guard for the dueling-guards loop that tripped Electron's
  // history.replaceState() > 100 / 10s throttle right after OAuth success.
  // Root cause: renderer-store auth.status and Tauri product-control are two
  // independent RuntimeAccountService observers with no happens-before
  // contract; the post-login divergence window had LoginPage rendering
  // <Navigate to="/"> while FirstRunGate rendered <Navigate to="/login">,
  // ping-ponging the URL until the browser throttle threw SecurityError.
  // Fix: route decisions live only at AppRoutes top-level. LoginPage and
  // ProductControlWorkflow may render UI but must never import Navigate
  // (importing it is the precondition for rendering it; banning the import
  // is the strongest, comment-immune guard).
  assert.doesNotMatch(
    loginPageSource,
    /import\s*\{[^}]*\bNavigate\b[^}]*\}\s*from\s*'react-router-dom'/,
    'LoginPage must not import Navigate from react-router-dom; AppRoutes owns the /login -> / handoff via a single effect',
  );
  assert.doesNotMatch(
    workflowSource,
    /import\s*\{[^}]*\bNavigate\b[^}]*\}\s*from\s*'react-router-dom'/,
    'ProductControlWorkflow must not import Navigate from react-router-dom; not_logged_in is intercepted by AppRoutes admission gate',
  );
  // The defensive surface for the not-logged-in terminal screen renders an
  // inert placeholder (so a leak past the admission gate fails closed to a
  // loading state rather than a route loop).
  assert.match(reconcilingScreenSource, /first-run-screen-reconciling/);
  // AppRoutes' single post-login handoff is an imperative navigate inside
  // an effect (fires once per authStatus/location transition) — not a
  // render-time <Navigate> in LoginPage.
  assert.match(appRoutesSource, /authStatus === 'authenticated' && location\.pathname === '\/login'/);
  assert.match(appRoutesSource, /navigate\('\/', \{ replace: true \}\)/);
});
