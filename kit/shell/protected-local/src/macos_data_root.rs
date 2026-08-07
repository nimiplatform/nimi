use std::error::Error;
use std::ffi::CString;
use std::fmt::{Display, Formatter};
use std::fs;
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::MetadataExt;
use std::path::{Component, Path, PathBuf};

const ACL_SEARCH_DIRECTORY: i32 = 1;
const ACL_PRODUCT_CONTROL_DIRECTORY: i32 = 2;
const ACL_DATA_DIRECTORY: i32 = 3;
const ACL_MODIFY_FILE: i32 = 4;
const PROFILE_BUFFER_BYTES: usize = 4096;

unsafe extern "C" {
    fn nimi_macos_prepare_fixed_runtime_path_acl(path: *const libc::c_char, policy: i32) -> i32;
    #[cfg(test)]
    fn nimi_macos_validate_fixed_runtime_path_acl(path: *const libc::c_char, policy: i32) -> i32;
    fn nimi_macos_copy_current_user_profile(output: *mut libc::c_char, output_size: usize) -> i32;
}

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

fn normalized_absolute_non_root(
    path: &Path,
    stage: &'static str,
) -> Result<PathBuf, FixedRuntimeDataRootError> {
    if !path.is_absolute() {
        return Err(FixedRuntimeDataRootError::new(
            stage,
            "an absolute non-root path is required",
        ));
    }
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::RootDir | Component::Normal(_) => normalized.push(component),
            _ => {
                return Err(FixedRuntimeDataRootError::new(
                    stage,
                    "relative, parent, and platform-prefix components are forbidden",
                ));
            }
        }
    }
    if normalized == Path::new("/") || normalized.parent().is_none() {
        return Err(FixedRuntimeDataRootError::new(
            stage,
            "an absolute non-root path is required",
        ));
    }
    for (alias, canonical) in [
        (Path::new("/etc"), Path::new("/private/etc")),
        (Path::new("/tmp"), Path::new("/private/tmp")),
        (Path::new("/var"), Path::new("/private/var")),
    ] {
        if let Ok(suffix) = normalized.strip_prefix(alias) {
            normalized = canonical.join(suffix);
            break;
        }
    }
    Ok(normalized)
}

fn validate_directory_chain(
    path: &Path,
    allow_missing_tail: bool,
    stage: &'static str,
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
            Err(error) => return Err(FixedRuntimeDataRootError::new(stage, error.to_string())),
        };
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            return Err(FixedRuntimeDataRootError::new(
                stage,
                "the path chain contains a symlink or non-directory component",
            ));
        }
    }
    Ok(())
}

fn path_c_string(path: &Path, stage: &'static str) -> Result<CString, FixedRuntimeDataRootError> {
    CString::new(path.as_os_str().as_bytes()).map_err(|_| {
        FixedRuntimeDataRootError::new(stage, "the path contains an embedded NUL byte")
    })
}

fn prepare_native_acl(
    path: &Path,
    policy: i32,
    stage: &'static str,
) -> Result<(), FixedRuntimeDataRootError> {
    let encoded = path_c_string(path, stage)?;
    // SAFETY: encoded is a live nul-terminated path and policy is one of the
    // closed native ACL policies defined above.
    let status = unsafe { nimi_macos_prepare_fixed_runtime_path_acl(encoded.as_ptr(), policy) };
    if status != 0 {
        return Err(FixedRuntimeDataRootError::new(
            stage,
            format!("native ACL preparation failed with status {status}"),
        ));
    }
    Ok(())
}

fn prepare_runtime_traversal(path: &Path) -> Result<(), FixedRuntimeDataRootError> {
    // SAFETY: geteuid is a read-only process identity query.
    let current_uid = unsafe { libc::geteuid() };
    if current_uid == 0 {
        return Err(FixedRuntimeDataRootError::new(
            "prepare-runtime-traversal",
            "the Desktop host must not run as root",
        ));
    }
    let mut ancestors = path.ancestors().skip(1).collect::<Vec<_>>();
    ancestors.reverse();
    for ancestor in ancestors {
        if ancestor == Path::new("/") {
            continue;
        }
        let metadata = fs::symlink_metadata(ancestor).map_err(|error| {
            FixedRuntimeDataRootError::new("prepare-runtime-traversal", error.to_string())
        })?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            return Err(FixedRuntimeDataRootError::new(
                "prepare-runtime-traversal",
                "a path ancestor is not a direct directory",
            ));
        }
        if metadata.uid() == current_uid {
            prepare_native_acl(ancestor, ACL_SEARCH_DIRECTORY, "prepare-runtime-traversal")?;
        } else if metadata.mode() & 0o001 == 0 {
            return Err(FixedRuntimeDataRootError::new(
                "prepare-runtime-traversal",
                "a non-owned path ancestor does not admit fixed-service traversal",
            ));
        }
    }
    Ok(())
}

fn prepare_directory(
    path: &Path,
    policy: i32,
    validation_stage: &'static str,
    creation_stage: &'static str,
    acl_stage: &'static str,
) -> Result<PathBuf, FixedRuntimeDataRootError> {
    let root = normalized_absolute_non_root(path, validation_stage)?;
    validate_directory_chain(&root, true, validation_stage)?;
    fs::create_dir_all(&root)
        .map_err(|error| FixedRuntimeDataRootError::new(creation_stage, error.to_string()))?;
    validate_directory_chain(&root, false, validation_stage)?;
    prepare_runtime_traversal(&root)?;
    prepare_native_acl(&root, policy, acl_stage)?;
    Ok(root)
}

/// Prepares a user-selected macOS data-plane root for the active Runtime
/// custody profile. Production grants only the fixed service account its
/// inheritable modify ACE. Source local development instead preserves the
/// single current-user boundary and never requests a service-account ACL.
pub fn prepare_fixed_runtime_data_root(path: &Path) -> Result<(), FixedRuntimeDataRootError> {
    #[cfg(feature = "macos-source-local-development")]
    {
        return prepare_source_local_development_data_root(path);
    }
    #[cfg(not(feature = "macos-source-local-development"))]
    {
        let root = normalized_absolute_non_root(path, "validate-selected-root")?;
        let profile = current_process_profile_root()?;
        if root == profile || root.starts_with(profile.join(".nimi")) {
            return Err(FixedRuntimeDataRootError::new(
                "validate-selected-root",
                "the selected data root must not overlap the user profile or fixed Product Control boundary",
            ));
        }
        prepare_directory(
            &root,
            ACL_DATA_DIRECTORY,
            "validate-selected-root",
            "create-selected-root",
            "prepare-service-root-acl",
        )?;
        Ok(())
    }
}

#[cfg(feature = "macos-source-local-development")]
fn prepare_source_local_development_data_root(
    path: &Path,
) -> Result<(), FixedRuntimeDataRootError> {
    use std::os::unix::fs::DirBuilderExt;

    let root = normalized_absolute_non_root(path, "validate-selected-root")?;
    let profile = current_process_profile_root()?;
    let source_state = profile
        .join("Library")
        .join("Application Support")
        .join("Nimi")
        .join("RuntimeLocalDevelopment");
    if root == profile
        || root.starts_with(profile.join(".nimi"))
        || root == source_state
        || root.starts_with(source_state.join(".nimi"))
    {
        return Err(FixedRuntimeDataRootError::new(
            "validate-selected-root",
            "the selected data root must not overlap Product Control or the source Runtime state root",
        ));
    }
    validate_directory_chain(&root, true, "validate-selected-root")?;
    let mut builder = fs::DirBuilder::new();
    builder.recursive(true).mode(0o700);
    builder.create(&root).map_err(|error| {
        FixedRuntimeDataRootError::new("create-selected-root", error.to_string())
    })?;
    validate_directory_chain(&root, false, "validate-selected-root")?;

    // SAFETY: identity queries are read-only and bind this preparation to the
    // exact non-root Desktop user that also owns the source Runtime.
    let uid = unsafe { libc::geteuid() };
    if uid == 0 || unsafe { libc::getuid() } != uid {
        return Err(FixedRuntimeDataRootError::new(
            "validate-selected-root",
            "source local development requires one non-root current user",
        ));
    }
    let metadata = fs::symlink_metadata(&root).map_err(|error| {
        FixedRuntimeDataRootError::new("inspect-selected-root", error.to_string())
    })?;
    if !metadata.is_dir()
        || metadata.file_type().is_symlink()
        || metadata.uid() != uid
        || metadata.mode() & 0o777 != 0o700
    {
        return Err(FixedRuntimeDataRootError::new(
            "inspect-selected-root",
            "source local development data root must be a direct owner-only current-user directory",
        ));
    }
    Ok(())
}

fn current_process_profile_root() -> Result<PathBuf, FixedRuntimeDataRootError> {
    let mut buffer = vec![0u8; PROFILE_BUFFER_BYTES];
    // SAFETY: buffer is writable for the supplied byte count and the native
    // function always nul-terminates a successful result.
    let status = unsafe {
        nimi_macos_copy_current_user_profile(
            buffer.as_mut_ptr().cast::<libc::c_char>(),
            buffer.len(),
        )
    };
    if status != 0 {
        return Err(FixedRuntimeDataRootError::new(
            "resolve-interactive-user-profile",
            format!("native profile lookup failed with status {status}"),
        ));
    }
    let end = buffer.iter().position(|byte| *byte == 0).ok_or_else(|| {
        FixedRuntimeDataRootError::new(
            "resolve-interactive-user-profile",
            "the native profile path was not terminated",
        )
    })?;
    if end == 0 {
        return Err(FixedRuntimeDataRootError::new(
            "resolve-interactive-user-profile",
            "the native profile path was empty",
        ));
    }
    let profile = PathBuf::from(std::ffi::OsStr::from_bytes(&buffer[..end]));
    normalized_absolute_non_root(&profile, "resolve-interactive-user-profile")
}

fn prepare_existing_product_control_record(
    record_path: &Path,
) -> Result<(), FixedRuntimeDataRootError> {
    let metadata = match fs::symlink_metadata(record_path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(FixedRuntimeDataRootError::new(
                "inspect-product-control-record",
                error.to_string(),
            ));
        }
    };
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(FixedRuntimeDataRootError::new(
            "inspect-product-control-record",
            "nimi.json is not an admitted-owner regular file",
        ));
    }
    prepare_native_acl(
        record_path,
        ACL_MODIFY_FILE,
        "prepare-product-control-record-acl",
    )
}

fn prepare_fixed_runtime_product_control_root_at(
    profile_root: &Path,
) -> Result<(), FixedRuntimeDataRootError> {
    let profile = normalized_absolute_non_root(profile_root, "validate-product-control-profile")?;
    validate_directory_chain(&profile, false, "validate-product-control-profile")?;
    prepare_native_acl(
        &profile,
        ACL_SEARCH_DIRECTORY,
        "prepare-product-control-profile-acl",
    )?;
    let product_control_root = prepare_directory(
        &profile.join(".nimi"),
        ACL_PRODUCT_CONTROL_DIRECTORY,
        "validate-product-control-root",
        "create-product-control-root",
        "prepare-product-control-root-acl",
    )?;
    prepare_existing_product_control_record(&product_control_root.join("nimi.json"))
}

/// Prepares the fixed current-user `~/.nimi` Product Control directory before
/// the isolated Runtime is contacted. The host does not parse or interpret the
/// canonical record; data-root preparation remains bound to the real selection
/// request.
pub(crate) fn prepare_fixed_runtime_product_control_root() -> Result<(), FixedRuntimeDataRootError>
{
    prepare_fixed_runtime_product_control_root_at(&current_process_profile_root()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::{symlink, PermissionsExt};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn fixture(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let temp = PathBuf::from("/private/tmp").join(format!(
            "nimi-macos-data-root-{name}-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&temp).expect("create fixture");
        temp
    }

    fn validate_native_acl(path: &Path, policy: i32) {
        let encoded = path_c_string(path, "test-path").expect("encode fixture path");
        // SAFETY: encoded is a live nul-terminated fixture path and policy is
        // one of the closed native values.
        let status =
            unsafe { nimi_macos_validate_fixed_runtime_path_acl(encoded.as_ptr(), policy) };
        assert_eq!(status, 0, "native ACL validation status");
    }

    #[test]
    fn relative_root_and_symlink_ancestor_fail_before_acl_mutation() {
        let relative = prepare_fixed_runtime_data_root(Path::new("relative"))
            .expect_err("relative root must fail");
        assert_eq!(relative.stage(), "validate-selected-root");

        let root = fixture("symlink");
        let target = root.join("target");
        let link = root.join("link");
        fs::create_dir(&target).expect("create target");
        symlink(&target, &link).expect("create symlink");
        let result = prepare_fixed_runtime_data_root(&link.join("selected"))
            .expect_err("symlink ancestor must fail");
        assert_eq!(result.stage(), "validate-selected-root");
        assert!(!target.join("selected").exists());
        fs::remove_dir_all(&root).expect("remove fixture");
    }

    #[test]
    fn fixed_system_aliases_are_normalized_and_control_boundaries_are_rejected() {
        assert_eq!(
            normalized_absolute_non_root(
                Path::new("/var/folders/nimi"),
                "normalize-fixed-system-alias"
            )
            .expect("normalize fixed /var alias"),
            PathBuf::from("/private/var/folders/nimi")
        );

        let profile = current_process_profile_root().expect("resolve current profile");
        for selected in [
            profile.clone(),
            profile.join(".nimi"),
            profile.join(".nimi/data"),
        ] {
            let error = prepare_fixed_runtime_data_root(&selected)
                .expect_err("profile and Product Control boundaries must be rejected");
            assert_eq!(error.stage(), "validate-selected-root");
        }
    }

    #[cfg(feature = "macos-source-local-development")]
    #[test]
    fn source_selected_root_is_current_user_owner_only_without_fixed_service_acl() {
        let root = fixture("source-selected");
        let selected = root.join("selected");
        fs::create_dir(&selected).expect("create selected root");
        fs::set_permissions(&selected, fs::Permissions::from_mode(0o700))
            .expect("make selected root owner-only");

        prepare_fixed_runtime_data_root(&selected).expect("prepare source selected root");
        let metadata = fs::symlink_metadata(&selected).expect("selected metadata");
        // SAFETY: geteuid is a read-only identity query.
        assert_eq!(metadata.uid(), unsafe { libc::geteuid() });
        assert_eq!(metadata.mode() & 0o777, 0o700);

        fs::set_permissions(&selected, fs::Permissions::from_mode(0o750))
            .expect("widen selected root");
        let error = prepare_fixed_runtime_data_root(&selected)
            .expect_err("non-owner-only source selected root must fail");
        assert_eq!(error.stage(), "inspect-selected-root");
        fs::remove_dir_all(&root).expect("remove fixture");
    }

    #[cfg(feature = "macos-local-development")]
    #[test]
    fn selected_root_acl_is_exact_idempotent_and_preserves_owner() {
        let root = fixture("selected");
        let selected = root.join("selected");
        fs::create_dir(&selected).expect("create selected root");
        let owner = fs::symlink_metadata(&selected)
            .expect("selected metadata")
            .uid();
        prepare_fixed_runtime_data_root(&selected).expect("first preparation");
        validate_native_acl(&selected, ACL_DATA_DIRECTORY);
        prepare_fixed_runtime_data_root(&selected).expect("idempotent preparation");
        validate_native_acl(&selected, ACL_DATA_DIRECTORY);
        assert_eq!(
            fs::symlink_metadata(&selected)
                .expect("selected metadata after preparation")
                .uid(),
            owner
        );
        fs::remove_dir_all(&root).expect("remove fixture");
    }

    #[cfg(feature = "macos-local-development")]
    #[test]
    fn product_control_bootstrap_prepares_existing_record_without_interpreting_it() {
        let profile = fixture("product-control");
        let product_control = profile.join(".nimi");
        fs::create_dir(&product_control).expect("create product control root");
        fs::write(product_control.join("nimi.json"), b"{")
            .expect("write intentionally uninterpreted product control record");

        prepare_fixed_runtime_product_control_root_at(&profile)
            .expect("prepare product control bootstrap");
        validate_native_acl(&profile, ACL_SEARCH_DIRECTORY);
        validate_native_acl(&product_control, ACL_PRODUCT_CONTROL_DIRECTORY);
        validate_native_acl(&product_control.join("nimi.json"), ACL_MODIFY_FILE);

        prepare_fixed_runtime_product_control_root_at(&profile)
            .expect("repeat product control bootstrap");
        validate_native_acl(&product_control.join("nimi.json"), ACL_MODIFY_FILE);
        fs::remove_dir_all(&profile).expect("remove fixture");
    }

    #[cfg(feature = "macos-local-development")]
    #[test]
    fn writable_group_or_other_root_is_rejected() {
        let root = fixture("broad-mode");
        let selected = root.join("selected");
        fs::create_dir(&selected).expect("create selected root");
        fs::set_permissions(&selected, fs::Permissions::from_mode(0o775))
            .expect("widen selected root mode");
        let error = prepare_fixed_runtime_data_root(&selected)
            .expect_err("group-writable selected root must fail");
        assert_eq!(error.stage(), "prepare-service-root-acl");
        fs::remove_dir_all(&root).expect("remove fixture");
    }
}
