use crate::desktop_paths::resolve_nimi_dir;
use std::path::PathBuf;

pub(crate) fn validate_account_id(account_id: &str) -> Result<String, String> {
    let normalized = account_id.trim();
    if normalized.is_empty() {
        return Err("authenticated Runtime account_id is required".to_string());
    }
    if normalized.contains('\0') {
        return Err("authenticated Runtime account_id contains an invalid byte".to_string());
    }
    Ok(normalized.to_string())
}

fn account_path_segment(account_id: &str) -> String {
    let mut out = String::new();
    for byte in account_id.as_bytes() {
        match *byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' => {
                out.push(*byte as char);
            }
            other => out.push_str(&format!("%{other:02X}")),
        }
    }
    out
}

/// On-disk path of an account's durable Account Default Profile library record.
///
/// P-AIPS-013 fixes this at `~/.nimi/accounts/<account-id>/profiles/default.json`
/// — the `~/.nimi` CONTROL root, not the user-selected `nimi_data` DATA root.
/// The account id is percent-encoded into the directory segment. The selected
/// data root it was provisioned against is recorded as the record's
/// `dataRootRef` field, not as the location it lives under.
pub fn account_default_profile_path(account_id: &str) -> Result<PathBuf, String> {
    let normalized_account = validate_account_id(account_id)?;
    Ok(resolve_nimi_dir()?
        .join("accounts")
        .join(account_path_segment(&normalized_account))
        .join("profiles")
        .join("default.json"))
}
