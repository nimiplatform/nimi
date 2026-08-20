use std::error::Error;
use std::fmt::{Display, Formatter};
use std::fs;
use std::os::windows::fs::MetadataExt;
use std::path::Path;

use windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT;

#[derive(Debug)]
pub struct FixedRuntimeDataRootError {
    stage: &'static str,
    detail: String,
}

impl FixedRuntimeDataRootError {
    fn new(stage: &'static str, detail: impl Into<String>) -> Self {
        Self {
            stage,
            detail: detail.into(),
        }
    }

    pub const fn stage(&self) -> &'static str {
        self.stage
    }
}

impl Display for FixedRuntimeDataRootError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}: {}", self.stage, self.detail)
    }
}

impl Error for FixedRuntimeDataRootError {}

// @nimi-authority: rule.nimi.platform.product-lifecycle.p-cold-010a
pub fn prepare_fixed_runtime_data_root(path: &Path) -> Result<(), FixedRuntimeDataRootError> {
    if !path.is_absolute() || path.parent().is_none() {
        return Err(FixedRuntimeDataRootError::new(
            "validate-selected-root",
            "an absolute non-volume-root path is required",
        ));
    }
    validate_direct_directory_chain(path, true)?;
    fs::create_dir_all(path).map_err(|error| {
        FixedRuntimeDataRootError::new("create-selected-root", error.to_string())
    })?;
    validate_direct_directory_chain(path, false)?;
    Ok(())
}

fn validate_direct_directory_chain(
    path: &Path,
    allow_missing_tail: bool,
) -> Result<(), FixedRuntimeDataRootError> {
    let mut components = path.ancestors().collect::<Vec<_>>();
    components.reverse();
    let mut missing_tail = false;
    for component in components {
        if missing_tail {
            continue;
        }
        let metadata = match fs::symlink_metadata(component) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound && allow_missing_tail => {
                missing_tail = true;
                continue;
            }
            Err(error) => {
                return Err(FixedRuntimeDataRootError::new(
                    "validate-selected-root",
                    error.to_string(),
                ));
            }
        };
        if !metadata.is_dir() || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Err(FixedRuntimeDataRootError::new(
                "validate-selected-root",
                "selected root chain contains a non-directory or reparse component",
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::process::{Command, Stdio};
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::*;

    #[test]
    fn source_selected_root_preserves_user_selected_sharing_acl() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "nimi-source-runtime-data-root-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir(&root).expect("create selected root fixture");
        let grant = Command::new("icacls.exe")
            .arg(&root)
            .arg("/grant")
            .arg("*S-1-5-11:(OI)(CI)M")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .expect("grant broad fixture ACL");
        assert!(grant.success(), "grant broad fixture ACL failed");

        prepare_fixed_runtime_data_root(&root)
            .expect("user-selected sharing ACL must not block source data-root admission");

        fs::remove_dir_all(&root).expect("remove selected root fixture");
    }
}
