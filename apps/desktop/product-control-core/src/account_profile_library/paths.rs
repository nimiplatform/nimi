use std::path::{Path, PathBuf};

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
/// P-AIPS-013 fixes this at
/// `<dataRoot>/accounts/<account-id>/profiles/default.json`. The canonical
/// `dataRoot` is resolved by Product Control before entering this library; the
/// library never discovers a root or falls back to the Product Control
/// directory. The account id is percent-encoded into the directory segment.
pub fn account_default_profile_path(data_root: &Path, account_id: &str) -> Result<PathBuf, String> {
    if !data_root.is_absolute() {
        return Err("canonical data_root must be absolute".to_string());
    }
    let normalized_account = validate_account_id(account_id)?;
    Ok(data_root
        .join("accounts")
        .join(account_path_segment(&normalized_account))
        .join("profiles")
        .join("default.json"))
}
