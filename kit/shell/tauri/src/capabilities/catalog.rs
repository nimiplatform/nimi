use serde::Serialize;
use serde_json::Value;

pub const STANDARD_SHELL_CAPABILITY_IDS: &[&str] = &[
    "runtime",
    "runtime-lifecycle",
    "runtime-defaults",
    "auth",
    "oauth",
    "desktop-open",
    "shell-ui",
    "diagnostics",
    "data",
    "storage",
    "config",
    "local-assets",
    "local-agent",
    "ai-profile",
    "ai-config",
    "avatar",
    "platform-projection",
    "file-dialog",
    "file-reveal",
    "export",
    "artifacts",
    "floating-window",
];

pub const STANDARD_SHELL_ERROR_CODES: &[&str] = &[
    "capability-unavailable",
    "external-daemon-required",
    "runtime-permission-denied",
    "runtime-unauthenticated",
    "forbidden-renderer-access",
    "invalid-path",
    "not-found",
    "invalid-payload",
    "host-internal-error",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StandardShellOperation {
    pub id: &'static str,
    pub command: &'static str,
    pub negative_states: &'static [&'static str],
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StandardShellCapability {
    pub id: &'static str,
    pub operations: &'static [StandardShellOperation],
}

pub const STANDARD_SHELL_CAPABILITIES: &[StandardShellCapability] = &[
    StandardShellCapability {
        id: "runtime",
        operations: &[
            StandardShellOperation {
                id: "unary",
                command: "nimi.shell.runtime.unary",
                negative_states: &[
                    "capability-unavailable",
                    "external-daemon-required",
                    "runtime-permission-denied",
                    "runtime-unauthenticated",
                    "invalid-payload",
                    "host-internal-error",
                ],
            },
            StandardShellOperation {
                id: "streamOpen",
                command: "nimi.shell.runtime.stream.open",
                negative_states: &[
                    "capability-unavailable",
                    "external-daemon-required",
                    "runtime-permission-denied",
                    "runtime-unauthenticated",
                    "invalid-payload",
                    "host-internal-error",
                ],
            },
            StandardShellOperation {
                id: "streamClose",
                command: "nimi.shell.runtime.stream.close",
                negative_states: &[
                    "capability-unavailable",
                    "not-found",
                    "invalid-payload",
                    "host-internal-error",
                ],
            },
        ],
    },
    StandardShellCapability {
        id: "runtime-lifecycle",
        operations: &[
            StandardShellOperation {
                id: "status",
                command: "nimi.shell.runtimeLifecycle.status",
                negative_states: &[
                    "capability-unavailable",
                    "external-daemon-required",
                    "runtime-permission-denied",
                    "runtime-unauthenticated",
                ],
            },
            StandardShellOperation {
                id: "start",
                command: "nimi.shell.runtimeLifecycle.start",
                negative_states: &["external-daemon-required"],
            },
            StandardShellOperation {
                id: "stop",
                command: "nimi.shell.runtimeLifecycle.stop",
                negative_states: &["external-daemon-required"],
            },
            StandardShellOperation {
                id: "restart",
                command: "nimi.shell.runtimeLifecycle.restart",
                negative_states: &["external-daemon-required"],
            },
        ],
    },
    StandardShellCapability {
        id: "runtime-defaults",
        operations: &[StandardShellOperation {
            id: "get",
            command: "nimi.shell.runtimeDefaults.get",
            negative_states: &["capability-unavailable", "invalid-payload"],
        }],
    },
    StandardShellCapability {
        id: "auth",
        operations: &[
            StandardShellOperation {
                id: "sessionLoad",
                command: "nimi.shell.auth.session.load",
                negative_states: &["external-daemon-required", "capability-unavailable"],
            },
            StandardShellOperation {
                id: "sessionSave",
                command: "nimi.shell.auth.session.save",
                negative_states: &[
                    "external-daemon-required",
                    "capability-unavailable",
                    "invalid-payload",
                ],
            },
            StandardShellOperation {
                id: "sessionClear",
                command: "nimi.shell.auth.session.clear",
                negative_states: &["external-daemon-required", "capability-unavailable"],
            },
        ],
    },
    StandardShellCapability {
        id: "oauth",
        operations: &[
            StandardShellOperation {
                id: "openExternalUrl",
                command: "nimi.shell.oauth.openExternalUrl",
                negative_states: &[
                    "capability-unavailable",
                    "forbidden-renderer-access",
                    "invalid-payload",
                ],
            },
            StandardShellOperation {
                id: "tokenExchange",
                command: "nimi.shell.oauth.tokenExchange",
                negative_states: &[
                    "capability-unavailable",
                    "invalid-payload",
                    "host-internal-error",
                ],
            },
            StandardShellOperation {
                id: "listenForCode",
                command: "nimi.shell.oauth.listenForCode",
                negative_states: &[
                    "capability-unavailable",
                    "invalid-payload",
                    "host-internal-error",
                ],
            },
        ],
    },
    StandardShellCapability {
        id: "desktop-open",
        operations: &[StandardShellOperation {
            id: "openIntent",
            command: "nimi.shell.desktopOpen.openIntent",
            negative_states: &[
                "capability-unavailable",
                "forbidden-renderer-access",
                "invalid-payload",
                "host-internal-error",
            ],
        }],
    },
    StandardShellCapability {
        id: "shell-ui",
        operations: &[
            StandardShellOperation {
                id: "confirmDialog",
                command: "nimi.shell.ui.confirmDialog",
                negative_states: &[
                    "capability-unavailable",
                    "invalid-payload",
                    "host-internal-error",
                ],
            },
            StandardShellOperation {
                id: "startWindowDrag",
                command: "nimi.shell.ui.startWindowDrag",
                negative_states: &["capability-unavailable", "host-internal-error"],
            },
            StandardShellOperation {
                id: "focusMainWindow",
                command: "nimi.shell.ui.focusMainWindow",
                negative_states: &["capability-unavailable", "host-internal-error"],
            },
        ],
    },
    StandardShellCapability {
        id: "diagnostics",
        operations: &[StandardShellOperation {
            id: "rendererEntryProbe",
            command: "nimi.shell.diagnostics.rendererEntryProbe",
            negative_states: &["capability-unavailable", "invalid-payload"],
        }],
    },
    StandardShellCapability {
        id: "data",
        operations: &[StandardShellOperation {
            id: "pathResolve",
            command: "nimi.shell.data.pathResolve",
            negative_states: &["capability-unavailable", "invalid-path", "invalid-payload"],
        }],
    },
    StandardShellCapability {
        id: "storage",
        operations: &[
            StandardShellOperation {
                id: "readJson",
                command: "nimi.shell.storage.readJson",
                negative_states: &[
                    "capability-unavailable",
                    "invalid-path",
                    "not-found",
                    "invalid-payload",
                ],
            },
            StandardShellOperation {
                id: "writeJson",
                command: "nimi.shell.storage.writeJson",
                negative_states: &["capability-unavailable", "invalid-path", "invalid-payload"],
            },
            StandardShellOperation {
                id: "removeJson",
                command: "nimi.shell.storage.removeJson",
                negative_states: &["capability-unavailable", "invalid-path", "invalid-payload"],
            },
        ],
    },
    StandardShellCapability {
        id: "config",
        operations: &[
            StandardShellOperation {
                id: "get",
                command: "nimi.shell.config.get",
                negative_states: &["capability-unavailable", "not-found"],
            },
            StandardShellOperation {
                id: "set",
                command: "nimi.shell.config.set",
                negative_states: &[
                    "external-daemon-required",
                    "capability-unavailable",
                    "invalid-payload",
                ],
            },
        ],
    },
    StandardShellCapability {
        id: "local-assets",
        operations: &[StandardShellOperation {
            id: "resolveUrl",
            command: "nimi.shell.localAssets.resolveUrl",
            negative_states: &["capability-unavailable", "invalid-path", "not-found"],
        }],
    },
    StandardShellCapability {
        id: "local-agent",
        operations: &[
            StandardShellOperation {
                id: "identity",
                command: "nimi.shell.localAgent.identity",
                negative_states: &["capability-unavailable"],
            },
            StandardShellOperation {
                id: "runtimeTrustedCaller",
                command: "nimi.shell.localAgent.runtimeTrustedCaller",
                negative_states: &["capability-unavailable", "forbidden-renderer-access"],
            },
        ],
    },
    StandardShellCapability {
        id: "ai-profile",
        operations: &[StandardShellOperation {
            id: "get",
            command: "nimi.shell.aiProfile.get",
            negative_states: &["capability-unavailable", "not-found"],
        }],
    },
    StandardShellCapability {
        id: "ai-config",
        operations: &[
            StandardShellOperation {
                id: "get",
                command: "nimi.shell.aiConfig.get",
                negative_states: &["capability-unavailable", "not-found"],
            },
            StandardShellOperation {
                id: "set",
                command: "nimi.shell.aiConfig.set",
                negative_states: &["capability-unavailable", "invalid-payload"],
            },
        ],
    },
    StandardShellCapability {
        id: "avatar",
        operations: &[StandardShellOperation {
            id: "assetResolve",
            command: "nimi.shell.avatar.assetResolve",
            negative_states: &["capability-unavailable", "invalid-path", "not-found"],
        }],
    },
    StandardShellCapability {
        id: "platform-projection",
        operations: &[StandardShellOperation {
            id: "get",
            command: "nimi.shell.platformProjection.get",
            negative_states: &["capability-unavailable", "not-found"],
        }],
    },
    StandardShellCapability {
        id: "file-dialog",
        operations: &[StandardShellOperation {
            id: "open",
            command: "nimi.shell.fileDialog.open",
            negative_states: &[
                "capability-unavailable",
                "invalid-payload",
                "host-internal-error",
            ],
        }],
    },
    StandardShellCapability {
        id: "file-reveal",
        operations: &[StandardShellOperation {
            id: "reveal",
            command: "nimi.shell.fileReveal.reveal",
            negative_states: &[
                "capability-unavailable",
                "invalid-path",
                "not-found",
                "host-internal-error",
            ],
        }],
    },
    StandardShellCapability {
        id: "export",
        operations: &[StandardShellOperation {
            id: "saveFile",
            command: "nimi.shell.export.saveFile",
            negative_states: &[
                "capability-unavailable",
                "invalid-payload",
                "host-internal-error",
            ],
        }],
    },
    StandardShellCapability {
        id: "artifacts",
        operations: &[StandardShellOperation {
            id: "write",
            command: "nimi.shell.artifacts.write",
            negative_states: &[
                "capability-unavailable",
                "invalid-path",
                "invalid-payload",
                "host-internal-error",
            ],
        }],
    },
    StandardShellCapability {
        id: "floating-window",
        operations: &[
            StandardShellOperation {
                id: "setBounds",
                command: "nimi.shell.floatingWindow.setBounds",
                negative_states: &[
                    "capability-unavailable",
                    "invalid-payload",
                    "host-internal-error",
                ],
            },
            StandardShellOperation {
                id: "setIgnoreCursorEvents",
                command: "nimi.shell.floatingWindow.setIgnoreCursorEvents",
                negative_states: &[
                    "capability-unavailable",
                    "invalid-payload",
                    "host-internal-error",
                ],
            },
            StandardShellOperation {
                id: "setAlwaysOnTop",
                command: "nimi.shell.floatingWindow.setAlwaysOnTop",
                negative_states: &[
                    "capability-unavailable",
                    "invalid-payload",
                    "host-internal-error",
                ],
            },
            StandardShellOperation {
                id: "hide",
                command: "nimi.shell.floatingWindow.hide",
                negative_states: &["capability-unavailable", "host-internal-error"],
            },
            StandardShellOperation {
                id: "close",
                command: "nimi.shell.floatingWindow.close",
                negative_states: &["capability-unavailable", "host-internal-error"],
            },
            StandardShellOperation {
                id: "beginManualDrag",
                command: "nimi.shell.floatingWindow.beginManualDrag",
                negative_states: &["capability-unavailable", "host-internal-error"],
            },
            StandardShellOperation {
                id: "moveManualDrag",
                command: "nimi.shell.floatingWindow.moveManualDrag",
                negative_states: &[
                    "capability-unavailable",
                    "invalid-payload",
                    "host-internal-error",
                ],
            },
            StandardShellOperation {
                id: "constrainToVisibleArea",
                command: "nimi.shell.floatingWindow.constrainToVisibleArea",
                negative_states: &[
                    "capability-unavailable",
                    "invalid-payload",
                    "host-internal-error",
                ],
            },
        ],
    },
];

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StandardShellErrorEnvelope {
    pub code: String,
    pub reason_code: String,
    pub action_hint: String,
    pub source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<Value>,
}

pub fn standard_shell_error(
    code: &str,
    reason_code: &str,
    action_hint: &str,
    source: &str,
    details: Option<Value>,
) -> String {
    let envelope = StandardShellErrorEnvelope {
        code: code.trim().to_string(),
        reason_code: reason_code.trim().to_string(),
        action_hint: action_hint.trim().to_string(),
        source: source.trim().to_string(),
        details,
    };
    serde_json::to_string(&envelope).unwrap_or_else(|_| {
        "{\"code\":\"host-internal-error\",\"reasonCode\":\"standard-shell-error-serialization-failed\",\"actionHint\":\"Check host logs.\",\"source\":\"tauri\"}".to_string()
    })
}

#[cfg(test)]
mod tests {
    use super::{
        standard_shell_error, STANDARD_SHELL_CAPABILITIES, STANDARD_SHELL_CAPABILITY_IDS,
        STANDARD_SHELL_ERROR_CODES,
    };
    use serde_json::Value;

    #[test]
    fn catalog_contains_all_standard_capability_ids() {
        let ids = STANDARD_SHELL_CAPABILITIES
            .iter()
            .map(|capability| capability.id)
            .collect::<Vec<_>>();
        assert_eq!(ids, STANDARD_SHELL_CAPABILITY_IDS);
        assert!(STANDARD_SHELL_ERROR_CODES.contains(&"external-daemon-required"));
    }

    #[test]
    fn runtime_unary_and_stream_have_unavailable_negative_states() {
        let runtime = STANDARD_SHELL_CAPABILITIES
            .iter()
            .find(|capability| capability.id == "runtime")
            .expect("runtime capability");
        for operation_id in ["unary", "streamOpen"] {
            let operation = runtime
                .operations
                .iter()
                .find(|operation| operation.id == operation_id)
                .expect("runtime operation");
            assert!(operation
                .negative_states
                .contains(&"external-daemon-required"));
        }
    }

    #[test]
    fn storage_catalog_includes_idempotent_remove_json() {
        let storage = STANDARD_SHELL_CAPABILITIES
            .iter()
            .find(|capability| capability.id == "storage")
            .expect("storage capability");
        let remove = storage
            .operations
            .iter()
            .find(|operation| operation.id == "removeJson")
            .expect("removeJson operation");
        assert_eq!(remove.command, "nimi.shell.storage.removeJson");
        assert_eq!(
            remove.negative_states,
            &["capability-unavailable", "invalid-path", "invalid-payload"]
        );
    }

    #[test]
    fn standard_error_uses_required_envelope_shape() {
        let payload = standard_shell_error(
            "capability-unavailable",
            "host-missing-standard-capability",
            "Install or enable a standard shell host.",
            "tauri",
            None,
        );
        let parsed: Value = serde_json::from_str(payload.as_str()).expect("json");
        assert_eq!(
            parsed.get("code").and_then(Value::as_str),
            Some("capability-unavailable")
        );
        assert_eq!(
            parsed.get("reasonCode").and_then(Value::as_str),
            Some("host-missing-standard-capability")
        );
        assert_eq!(parsed.get("source").and_then(Value::as_str), Some("tauri"));
    }
}
