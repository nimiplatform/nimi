#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RendererEntryProbeScriptConfig {
    pub started_flag: String,
    pub ping_command: String,
    pub report_command: String,
    pub context_command: String,
    pub reset_local_storage_scenario_ids: Vec<String>,
}

pub fn build_renderer_entry_probe_script(
    config: &RendererEntryProbeScriptConfig,
) -> Result<String, String> {
    require_non_empty("started_flag", &config.started_flag)?;
    require_non_empty("ping_command", &config.ping_command)?;
    require_non_empty("report_command", &config.report_command)?;
    require_non_empty("context_command", &config.context_command)?;

    let started_flag = json_string(&config.started_flag)?;
    let ping_command = json_string(&config.ping_command)?;
    let report_command = json_string(&config.report_command)?;
    let context_command = json_string(&config.context_command)?;
    let reset_local_storage_scenario_ids =
        serde_json::to_string(&config.reset_local_storage_scenario_ids)
            .map_err(|error| format!("serialize reset_local_storage_scenario_ids: {error}"))?;

    Ok(format!(
        r#"
(() => {{
  try {{
    const globalRecord = globalThis;
    const startedFlag = {started_flag};
    if (globalRecord[startedFlag]) {{
      return;
    }}
    globalRecord[startedFlag] = true;
    const pingCommand = {ping_command};
    const reportCommand = {report_command};
    const contextCommand = {context_command};
    const resetLocalStorageScenarioIds = new Set({reset_local_storage_scenario_ids});
    const invoke =
      globalRecord.__TAURI__?.core?.invoke
      || globalRecord.__TAURI_INTERNALS__?.invoke
      || globalRecord.__TAURI_IPC__?.invoke
      || globalRecord.window?.__TAURI__?.core?.invoke
      || globalRecord.window?.__TAURI_INTERNALS__?.invoke
      || globalRecord.window?.__TAURI_IPC__?.invoke;
    const invokeSafe = (command, payload) => {{
      if (typeof invoke !== 'function') {{
        return Promise.resolve(undefined);
      }}
      return Promise.resolve(invoke(command, payload)).catch(() => undefined);
    }};
    const commandCheckPayload = (check) => {{
      if (Object.prototype.hasOwnProperty.call(check, 'payload')) {{
        return check.payload;
      }}
      return undefined;
    }};
    const commandValueKind = (value) => {{
      if (value === null) {{
        return 'null';
      }}
      if (Array.isArray(value)) {{
        return 'array';
      }}
      return typeof value;
    }};
    const commandErrorMessage = (error) => {{
      if (error?.message) {{
        return error.message;
      }}
      return String(error || 'command failed');
    }};
    const runCommandChecks = async (context, details) => {{
      const checks = Array.isArray(context?.commandChecks)
        ? context.commandChecks.filter((check) => check && typeof check.command === 'string' && check.command.trim())
        : [];
      const commandChecks = [];
      for (const check of checks) {{
        const command = String(check.command).trim();
        const id = String(check.id || command).trim();
        const expectError = Boolean(check.expectError);
        try {{
          const value = await Promise.resolve(invoke(command, commandCheckPayload(check)));
          const result = {{
            id,
            command,
            expectError,
            ok: !expectError,
            valueKind: commandValueKind(value),
          }};
          if (expectError) {{
            result.errorMessage = 'expected command to fail, but it resolved';
          }}
          commandChecks.push(result);
        }} catch (error) {{
          commandChecks.push({{
            id,
            command,
            expectError,
            ok: expectError,
            errorMessage: commandErrorMessage(error),
          }});
        }}
      }}
      const failed = commandChecks.filter((result) => !result.ok);
      if (failed.length > 0) {{
        await invokeSafe(reportCommand, {{
          payload: {{
            ok: false,
            failedStep: 'renderer-command-checks-failed',
            steps: ['window-eval-probe', 'renderer-module-import', 'renderer-command-checks'],
            details,
            commandChecks,
            route: globalRecord.location?.href || '',
            htmlSnapshot: globalRecord.document?.documentElement?.outerHTML || '',
          }},
        }});
        return;
      }}
      await invokeSafe(pingCommand, {{
        payload: {{
          stage: 'command-checks-ok',
          commandChecks,
          details,
        }},
      }});
    }};
    const moduleScripts = Array.from(globalRecord.document?.querySelectorAll('script[type="module"][src]') || []);
    const scriptSrc = moduleScripts.map((script) => script?.src || '').find(Boolean) || '';
    const readDetails = () => ({{
      href: globalRecord.location?.href || '',
      readyState: globalRecord.document?.readyState || '',
      hasRoot: Boolean(globalRecord.document?.getElementById('root')),
      rootChildCount: globalRecord.document?.getElementById('root')?.childElementCount || 0,
      rootText: String(globalRecord.document?.getElementById('root')?.textContent || '').slice(0, 500),
      hasInvoke: typeof invoke === 'function',
      hasNimiTauriRuntime: typeof globalRecord.__NIMI_TAURI_RUNTIME__?.invoke === 'function',
      hasNimiElectronRuntime: typeof globalRecord.__NIMI_ELECTRON_RUNTIME__?.invoke === 'function',
      scriptSrc,
    }});
    const details = readDetails();
    if (typeof invoke === 'function') {{
      void invokeSafe(pingCommand, {{
        payload: {{
          stage: 'window-eval-probe',
          details,
        }},
      }});
      if (!scriptSrc) {{
        void invokeSafe(reportCommand, {{
          payload: {{
            ok: false,
            failedStep: 'renderer-module-script-missing',
            steps: ['window-eval-probe'],
            errorMessage: 'main module script src is missing',
            route: globalRecord.location?.href || '',
            htmlSnapshot: globalRecord.document?.documentElement?.outerHTML || '',
          }},
        }});
        return;
      }}
      void invokeSafe(contextCommand)
        .then(async (context) => {{
          if (!context?.enabled) {{
            return undefined;
          }}
          if (resetLocalStorageScenarioIds.has(String(context?.scenarioId || ''))) {{
            globalRecord.localStorage?.clear?.();
          }}
          await import(scriptSrc);
          await invokeSafe(pingCommand, {{
            payload: {{
              stage: 'window-dynamic-import-ok',
              details: {{
                scriptSrc,
              }},
            }},
          }});
          globalRecord.setTimeout?.(() => {{
            void invokeSafe(pingCommand, {{
              payload: {{
                stage: 'window-post-import-state',
                details: readDetails(),
              }},
            }});
          }}, 1_000);
          await runCommandChecks(context, {{
            ...details,
            scriptSrc,
          }});
          return undefined;
        }})
        .catch((error) => invokeSafe(reportCommand, {{
          payload: {{
            ok: false,
            failedStep: 'renderer-module-import-failed',
            steps: ['window-eval-probe', 'renderer-module-import'],
            errorName: error?.name || '',
            errorMessage: error?.message || String(error || 'dynamic import failed'),
            errorStack: error?.stack || '',
            errorCause: error?.cause ? String(error.cause) : '',
            route: globalRecord.location?.href || '',
            htmlSnapshot: globalRecord.document?.documentElement?.outerHTML || '',
          }},
        }}));
    }}
  }} catch (_) {{
    // no-op
  }}
}})();
"#
    ))
}

fn require_non_empty(field: &str, value: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        return Err(format!("{field} is required"));
    }
    Ok(())
}

fn json_string(value: &str) -> Result<String, String> {
    serde_json::to_string(value).map_err(|error| format!("serialize script string: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renderer_entry_probe_script_is_configured_by_app_owned_commands() {
        let script = build_renderer_entry_probe_script(&RendererEntryProbeScriptConfig {
            started_flag: "__NIMI_TEST_PROBE_STARTED__".to_string(),
            ping_command: "tester_probe_ping".to_string(),
            report_command: "tester_probe_report".to_string(),
            context_command: "tester_probe_context".to_string(),
            reset_local_storage_scenario_ids: vec!["boot.reset".to_string()],
        })
        .expect("script");

        assert!(script.contains(r#"const startedFlag = "__NIMI_TEST_PROBE_STARTED__";"#));
        assert!(script.contains(r#"const pingCommand = "tester_probe_ping";"#));
        assert!(script.contains(r#"const reportCommand = "tester_probe_report";"#));
        assert!(script.contains(r#"const contextCommand = "tester_probe_context";"#));
        assert!(script.contains(r#"new Set(["boot.reset"])"#));
        assert!(script.contains("globalRecord.__TAURI__?.core?.invoke"));
        assert!(script.contains(r#"querySelectorAll('script[type="module"][src]')"#));
        assert!(script.contains("import(scriptSrc);"));
        assert!(script.contains("commandChecks"));
        assert!(script.contains("command-checks-ok"));
        assert!(script.contains("renderer-command-checks-failed"));
        assert!(!script.contains("desktop_macos_smoke_ping"));
    }

    #[test]
    fn renderer_entry_probe_script_escapes_config_values() {
        let script = build_renderer_entry_probe_script(&RendererEntryProbeScriptConfig {
            started_flag: "__NIMI_\"QUOTE__".to_string(),
            ping_command: "probe_ping".to_string(),
            report_command: "probe_report".to_string(),
            context_command: "probe_context".to_string(),
            reset_local_storage_scenario_ids: vec!["scenario\"quoted".to_string()],
        })
        .expect("script");

        assert!(script.contains(r#"__NIMI_\"QUOTE__"#));
        assert!(script.contains(r#"scenario\"quoted"#));
    }

    #[test]
    fn renderer_entry_probe_script_rejects_missing_commands() {
        let error = build_renderer_entry_probe_script(&RendererEntryProbeScriptConfig {
            started_flag: "__NIMI_TEST_PROBE_STARTED__".to_string(),
            ping_command: " ".to_string(),
            report_command: "tester_probe_report".to_string(),
            context_command: "tester_probe_context".to_string(),
            reset_local_storage_scenario_ids: Vec::new(),
        })
        .expect_err("missing command should fail");

        assert_eq!(error, "ping_command is required");
    }
}
