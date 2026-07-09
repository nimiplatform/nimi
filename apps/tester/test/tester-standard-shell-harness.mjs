const AI_CONFIG_GET_COMMAND = 'nimi.shell.aiConfig.get';
const AI_CONFIG_SET_COMMAND = 'nimi.shell.aiConfig.set';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function payloadRecord(payload) {
  const record = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const nested = record.payload;
  return nested && typeof nested === 'object' && !Array.isArray(nested) ? nested : record;
}

function standardShellError(code, reasonCode, actionHint, details) {
  const error = new Error(reasonCode);
  error.code = code;
  error.reasonCode = reasonCode;
  error.actionHint = actionHint;
  error.source = 'host';
  error.details = details;
  return error;
}

export function installStandardShellAIConfigHarness(t, initialConfigs = {}) {
  const previousElectronTest = globalThis.__NIMI_ELECTRON_TEST__;
  const configs = new Map(Object.entries(initialConfigs).map(([key, value]) => [key, clone(value)]));
  globalThis.__NIMI_ELECTRON_TEST__ = {
    async invoke(command, payload = {}) {
      const body = payloadRecord(payload);
      if (command === AI_CONFIG_GET_COMMAND) {
        const scopeRef = String(body.scopeRef || '').trim();
        if (!scopeRef || !configs.has(scopeRef)) {
          throw standardShellError(
            'not-found',
            'electron-ai-config-scope-not-found',
            'initialize_ai_config_for_scope_before_reading',
            { command, scopeRef },
          );
        }
        return { scopeRef, config: clone(configs.get(scopeRef)) };
      }
      if (command === AI_CONFIG_SET_COMMAND) {
        const scopeRef = String(body.scopeRef || '').trim();
        if (!scopeRef || !body.config || typeof body.config !== 'object' || Array.isArray(body.config)) {
          throw standardShellError(
            'invalid-payload',
            'electron-ai-config-payload-invalid',
            'send_object_ai_config_payload',
            { command, scopeRef },
          );
        }
        configs.set(scopeRef, clone(body.config));
        return { scopeRef, config: clone(body.config) };
      }
      throw standardShellError(
        'forbidden-renderer-access',
        'tester-standard-shell-harness-command-forbidden',
        'use_installed_app_standard_shell_commands',
        { command },
      );
    },
    listen() {
      return () => {};
    },
  };
  t.after(() => {
    if (previousElectronTest === undefined) {
      delete globalThis.__NIMI_ELECTRON_TEST__;
    } else {
      globalThis.__NIMI_ELECTRON_TEST__ = previousElectronTest;
    }
  });
  return { configs };
}
