use super::*;

pub(super) fn checked_at() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

pub(super) fn operation_id(prefix: &str, seed: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(seed.as_bytes());
    hasher.update(Utc::now().timestamp_nanos_opt().unwrap_or(0).to_string());
    hasher.update(std::process::id().to_string());
    format!("{prefix}_{:.12}", format!("{:x}", hasher.finalize()))
}

pub(super) fn operations_path(account_id: &str, agent_id: &str) -> Result<PathBuf, String> {
    Ok(agent_center_dir(account_id, agent_id)?
        .join("operations")
        .join(OPERATIONS_FILE_NAME))
}

pub(super) fn account_dir(account_id: &str) -> Result<PathBuf, String> {
    Ok(crate::desktop_paths::resolve_nimi_data_dir()?
        .join("accounts")
        .join(local_scope_path_segment(account_id)))
}

pub(super) fn account_operations_path(account_id: &str) -> Result<PathBuf, String> {
    Ok(account_dir(account_id)?
        .join("operations")
        .join(OPERATIONS_FILE_NAME))
}

pub(super) fn should_keep_operation_line(line: &str, cutoff: chrono::DateTime<Utc>) -> bool {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
        return false;
    };
    let Some(occurred_at) = value.get("occurred_at").and_then(serde_json::Value::as_str) else {
        return false;
    };
    chrono::DateTime::parse_from_rfc3339(occurred_at)
        .map(|timestamp| timestamp.with_timezone(&Utc) >= cutoff)
        .unwrap_or(false)
}

pub(super) fn prune_operation_records(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    let raw = fs::read_to_string(path).map_err(|error| {
        format!(
            "failed to read Agent Center operation records ({}): {error}",
            path.display()
        )
    })?;
    let cutoff = Utc::now() - Duration::days(OPERATION_RETENTION_DAYS);
    let retained = raw
        .lines()
        .filter(|line| should_keep_operation_line(line, cutoff))
        .collect::<Vec<_>>();
    let next = if retained.is_empty() {
        String::new()
    } else {
        format!("{}\n", retained.join("\n"))
    };
    fs::write(path, next).map_err(|error| {
        format!(
            "failed to prune Agent Center operation records ({}): {error}",
            path.display()
        )
    })
}

pub(super) fn append_operation_record_to_path(
    path: &Path,
    record: &AgentCenterResourceOperationRecord,
) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "failed to create Agent Center operations directory ({}): {error}",
                parent.display()
            )
        })?;
    }
    prune_operation_records(&path)?;
    let line = serde_json::to_string(record)
        .map_err(|error| format!("failed to serialize Agent Center operation record: {error}"))?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|error| {
            format!(
                "failed to open Agent Center operation log ({}): {error}",
                path.display()
            )
        })?;
    file.write_all(line.as_bytes())
        .and_then(|_| file.write_all(b"\n"))
        .map_err(|error| {
            format!(
                "failed to append Agent Center operation log ({}): {error}",
                path.display()
            )
        })
}

pub(super) fn append_operation_record(
    account_id: &str,
    agent_id: &str,
    record: &AgentCenterResourceOperationRecord,
) -> Result<(), String> {
    let path = operations_path(account_id, agent_id)?;
    append_operation_record_to_path(&path, record)
}

pub(super) fn build_operation_record(
    seed: &str,
    operation_type: &str,
    resource_kind: &str,
    resource_id: &str,
    status: &str,
    reason_code: &str,
) -> AgentCenterResourceOperationRecord {
    let event_id = operation_id("op", seed);
    let transaction_id = operation_id("tx", &event_id);
    AgentCenterResourceOperationRecord {
        schema_version: 1,
        event_id,
        transaction_id,
        occurred_at: checked_at(),
        operation_type: operation_type.to_string(),
        resource_kind: resource_kind.to_string(),
        resource_id: resource_id.to_string(),
        status: status.to_string(),
        reason_code: reason_code.to_string(),
    }
}

pub(super) fn record_resource_operation(
    account_id: &str,
    agent_id: &str,
    operation_type: &str,
    resource_kind: &str,
    resource_id: &str,
    status: &str,
    reason_code: &str,
) -> Result<String, String> {
    let seed = format!("{account_id}:{agent_id}:{operation_type}:{resource_kind}:{resource_id}");
    let record = build_operation_record(
        &seed,
        operation_type,
        resource_kind,
        resource_id,
        status,
        reason_code,
    );
    let event_id = record.event_id.clone();
    append_operation_record(account_id, agent_id, &record)?;
    Ok(event_id)
}

pub(super) fn record_account_resource_operation(
    account_id: &str,
    operation_type: &str,
    resource_kind: &str,
    resource_id: &str,
    status: &str,
    reason_code: &str,
) -> Result<String, String> {
    let seed = format!("{account_id}:{operation_type}:{resource_kind}:{resource_id}");
    let record = build_operation_record(
        &seed,
        operation_type,
        resource_kind,
        resource_id,
        status,
        reason_code,
    );
    let event_id = record.event_id.clone();
    let path = account_operations_path(account_id)?;
    append_operation_record_to_path(&path, &record)?;
    Ok(event_id)
}

pub(super) fn record_resource_operation_under(
    operation_log_path: &Path,
    seed_scope: &str,
    operation_type: &str,
    resource_kind: &str,
    resource_id: &str,
    status: &str,
    reason_code: &str,
) -> Result<String, String> {
    let seed = format!("{seed_scope}:{operation_type}:{resource_kind}:{resource_id}");
    let record = build_operation_record(
        &seed,
        operation_type,
        resource_kind,
        resource_id,
        status,
        reason_code,
    );
    let event_id = record.event_id.clone();
    append_operation_record_to_path(operation_log_path, &record)?;
    Ok(event_id)
}

pub(super) fn quarantine_path(
    account_id: &str,
    agent_id: &str,
    resource_kind: &str,
    resource_id: &str,
) -> Result<PathBuf, String> {
    let root = agent_center_dir(account_id, agent_id)?;
    cleanup_expired_quarantine(&root)?;
    Ok(root.join("quarantine").join(resource_kind).join(format!(
        "{}_{}",
        resource_id,
        Utc::now().timestamp_nanos_opt().unwrap_or(0)
    )))
}

pub(super) fn cleanup_expired_quarantine(agent_center_root: &Path) -> Result<(), String> {
    cleanup_expired_quarantine_dir(&agent_center_root.join("quarantine"))
}

pub(super) fn cleanup_expired_quarantine_dir(quarantine_root: &Path) -> Result<(), String> {
    if !quarantine_root.exists() {
        return Ok(());
    }
    let cutoff = Utc::now()
        .checked_sub_signed(Duration::days(QUARANTINE_RETENTION_DAYS))
        .and_then(|timestamp| timestamp.timestamp_nanos_opt())
        .unwrap_or(i64::MIN);
    for kind_entry in fs::read_dir(&quarantine_root).map_err(|error| {
        format!(
            "failed to read Agent Center quarantine root ({}): {error}",
            quarantine_root.display()
        )
    })? {
        let kind_entry = kind_entry
            .map_err(|error| format!("failed to read Agent Center quarantine entry: {error}"))?;
        let kind_path = kind_entry.path();
        if !kind_path.is_dir() {
            continue;
        }
        for resource_entry in fs::read_dir(&kind_path).map_err(|error| {
            format!(
                "failed to read Agent Center quarantine directory ({}): {error}",
                kind_path.display()
            )
        })? {
            let resource_entry = resource_entry.map_err(|error| {
                format!("failed to read Agent Center quarantined resource entry: {error}")
            })?;
            let resource_path = resource_entry.path();
            let Some(name) = resource_path.file_name().and_then(|value| value.to_str()) else {
                continue;
            };
            let Some((_, timestamp_raw)) = name.rsplit_once('_') else {
                continue;
            };
            let Ok(timestamp_nanos) = timestamp_raw.parse::<i64>() else {
                continue;
            };
            if timestamp_nanos < cutoff {
                let metadata = fs::symlink_metadata(&resource_path).map_err(|error| {
                    format!(
                        "failed to read quarantined resource metadata ({}): {error}",
                        resource_path.display()
                    )
                })?;
                if metadata.is_dir() {
                    fs::remove_dir_all(&resource_path).map_err(|error| {
                        format!(
                            "failed to remove expired quarantined resource ({}): {error}",
                            resource_path.display()
                        )
                    })?;
                } else {
                    fs::remove_file(&resource_path).map_err(|error| {
                        format!(
                            "failed to remove expired quarantined resource ({}): {error}",
                            resource_path.display()
                        )
                    })?;
                }
            }
        }
    }
    Ok(())
}

pub(super) fn account_quarantine_path(
    account_id: &str,
    resource_kind: &str,
    resource_id: &str,
) -> Result<PathBuf, String> {
    let account_root = account_dir(account_id)?;
    let quarantine_root = account_root.join("quarantine");
    cleanup_expired_quarantine_dir(&quarantine_root)?;
    Ok(quarantine_root.join(resource_kind).join(format!(
        "{}_{}",
        resource_id,
        Utc::now().timestamp_nanos_opt().unwrap_or(0)
    )))
}

pub(super) fn quarantine_dir(source: &Path, destination: &Path) -> Result<bool, String> {
    if !source.exists() {
        return Ok(false);
    }
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "failed to create Agent Center quarantine directory ({}): {error}",
                parent.display()
            )
        })?;
    }
    fs::rename(source, destination).map_err(|error| {
        format!(
            "failed to quarantine Agent Center resource ({} -> {}): {error}",
            source.display(),
            destination.display()
        )
    })?;
    Ok(true)
}

pub(super) fn validate_removable_agent_center_tree(source: &Path) -> Result<bool, String> {
    match fs::symlink_metadata(source) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() {
                return Err(format!(
                    "Agent Center local resources path must not be a symlink ({})",
                    source.display()
                ));
            }
            if !metadata.is_dir() {
                return Err(format!(
                    "Agent Center local resources path must be a directory ({})",
                    source.display()
                ));
            }
            Ok(true)
        }
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!(
            "failed to inspect Agent Center local resources path ({}): {error}",
            source.display()
        )),
    }
}

pub(super) fn quarantine_agent_center_tree(
    account_id: &str,
    agent_id: &str,
    reason_code: &str,
) -> Result<DesktopAgentCenterLocalResourceRemoveResult, String> {
    let source = agent_center_dir(account_id, agent_id)?;
    if !validate_removable_agent_center_tree(&source)? {
        let operation_id = record_account_resource_operation(
            account_id,
            "agent_local_resources_quarantine",
            "agent_local_resources",
            agent_id,
            "completed",
            "already_missing",
        )?;
        return Ok(DesktopAgentCenterLocalResourceRemoveResult {
            resource_kind: "agent_local_resources".to_string(),
            resource_id: agent_id.to_string(),
            quarantined: false,
            operation_id,
            status: "completed".to_string(),
        });
    }
    let destination = account_quarantine_path(account_id, "agent_local_resources", agent_id)?;
    let quarantined = match quarantine_dir(&source, &destination) {
        Ok(value) => value,
        Err(error) => {
            let _ = record_resource_operation(
                account_id,
                agent_id,
                "agent_local_resources_quarantine",
                "agent_local_resources",
                agent_id,
                "failed",
                reason_code,
            );
            return Err(error);
        }
    };
    let operation_id = if quarantined {
        record_resource_operation_under(
            &destination.join("operations").join(OPERATIONS_FILE_NAME),
            &format!("{account_id}:{agent_id}:quarantined_agent_center"),
            "agent_local_resources_quarantine",
            "agent_local_resources",
            agent_id,
            "completed",
            reason_code,
        )?
    } else {
        record_account_resource_operation(
            account_id,
            "agent_local_resources_quarantine",
            "agent_local_resources",
            agent_id,
            "completed",
            "already_missing",
        )?
    };
    Ok(DesktopAgentCenterLocalResourceRemoveResult {
        resource_kind: "agent_local_resources".to_string(),
        resource_id: agent_id.to_string(),
        quarantined,
        operation_id,
        status: "completed".to_string(),
    })
}
