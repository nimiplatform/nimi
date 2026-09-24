//! Host technical profile preparation for Desktop-managed App launches.
//!
//! Runtime returns a non-authorizing profile root with each Prepare response.
//! This current-GUI-user Host validates its fixed shape, creates the profile
//! directories without following links or widening permissions, verifies they
//! are writable, and scopes the temporary directory to the child process only.
//! A missing or unusable profile fails the launch; nothing falls back to the OS
//! home, OS temporary area, or default Electron location.

use std::collections::BTreeMap;
use std::ffi::OsString;
use std::fs::{self, OpenOptions};
use std::io::{ErrorKind, Write};
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::generated::HostStorageProjection;
use crate::{NimiHostError, NimiHostErrorReasonCode};

/// Child-process environment key carrying the prepared profile root.
pub(crate) const HOST_PROFILE_ENVIRONMENT_KEY: &str = "NIMI_APP_HOST_PROFILE_DIR";
const APP_HOSTS_DIRECTORY: &str = "app-hosts";
const PROFILE_CHILDREN: [&str; 3] = ["user-data", "session-data", "tmp"];
const DEVTOOLS_ACTIVE_PORT_FILE: &str = "DevToolsActivePort";
const HASHED_NAME_LENGTH: usize = 32;
const MAX_PROFILE_ROOT_BYTES: usize = 2048;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct PreparedHostProfile {
    root: PathBuf,
}

impl PreparedHostProfile {
    pub(crate) fn root(&self) -> &Path {
        &self.root
    }

    pub(crate) fn user_data(&self) -> PathBuf {
        self.root.join(PROFILE_CHILDREN[0])
    }

    pub(crate) fn temp(&self) -> PathBuf {
        self.root.join(PROFILE_CHILDREN[2])
    }

    /// Variables set only in the launched child's environment.
    pub(crate) fn environment(&self) -> [(&'static str, OsString); 4] {
        let temp = self.temp().into_os_string();
        [
            (
                HOST_PROFILE_ENVIRONMENT_KEY,
                self.root.clone().into_os_string(),
            ),
            ("TEMP", temp.clone()),
            ("TMP", temp.clone()),
            ("TMPDIR", temp),
        ]
    }

    /// Removes only stale Chromium `DevToolsActivePort` files so a fresh
    /// development host cannot be mistaken for its predecessor. Electron writes
    /// it to session data; a shell that leaves session data at its default
    /// writes it to user data.
    pub(crate) fn clear_devtools_active_port(&self) -> Result<(), NimiHostError> {
        for directory in [PROFILE_CHILDREN[0], PROFILE_CHILDREN[1]] {
            let path = self.root.join(directory).join(DEVTOOLS_ACTIVE_PORT_FILE);
            match fs::symlink_metadata(&path) {
                Err(error) if error.kind() == ErrorKind::NotFound => {}
                Err(error) => return Err(unavailable("devtools-port-inspect", Some(&error))),
                Ok(metadata) if !metadata.file_type().is_file() => {
                    return Err(unavailable("devtools-port-not-file", None));
                }
                Ok(_) => match fs::remove_file(&path) {
                    Err(error) if error.kind() != ErrorKind::NotFound => {
                        return Err(unavailable("devtools-port-remove", Some(&error)));
                    }
                    _ => {}
                },
            }
        }
        Ok(())
    }
}

// @nimi-authority: rule.nimi.platform.product-lifecycle.p-mig-006d
/// Validates the Runtime projection and prepares the profile as the current
/// GUI user. Existing directories must be real directories, missing ones are
/// created one level at a time, and each profile child must pass a real
/// create/delete write probe.
pub(crate) fn prepare(
    projection: Option<HostStorageProjection>,
) -> Result<PreparedHostProfile, NimiHostError> {
    let raw = projection
        .ok_or_else(|| unavailable("projection-missing", None))?
        .profile_root;
    let root = validated_profile_root(&raw)?;
    let app_hosts = root
        .ancestors()
        .nth(3)
        .ok_or_else(|| unavailable("projection-invalid", None))?;
    let data_root = app_hosts
        .parent()
        .ok_or_else(|| unavailable("projection-invalid", None))?;
    let data_root_metadata =
        fs::metadata(data_root).map_err(|error| unavailable("data-root", Some(&error)))?;
    if !data_root_metadata.is_dir() {
        return Err(unavailable("data-root", None));
    }
    ensure_directory(app_hosts, DirectoryPolicy::SharedRoot(&data_root_metadata))?;
    for directory in [
        root.ancestors().nth(2),
        root.ancestors().nth(1),
        Some(root.as_path()),
    ] {
        let directory = directory.ok_or_else(|| unavailable("projection-invalid", None))?;
        ensure_directory(directory, DirectoryPolicy::Private)?;
    }
    for child in PROFILE_CHILDREN {
        let directory = root.join(child);
        ensure_directory(&directory, DirectoryPolicy::Private)?;
        write_probe(&directory)?;
    }
    Ok(PreparedHostProfile { root })
}

fn validated_profile_root(raw: &str) -> Result<PathBuf, NimiHostError> {
    if raw.is_empty()
        || raw.len() > MAX_PROFILE_ROOT_BYTES
        || raw.trim() != raw
        || raw.contains('\0')
    {
        return Err(unavailable("projection-invalid", None));
    }
    let root = PathBuf::from(raw);
    if !root.is_absolute()
        || root
            .components()
            .any(|component| matches!(component, Component::CurDir | Component::ParentDir))
    {
        return Err(unavailable("projection-invalid", None));
    }
    let names = root
        .components()
        .rev()
        .take(4)
        .map(|component| match component {
            Component::Normal(value) => value.to_str(),
            _ => None,
        })
        .collect::<Vec<_>>();
    let valid_shape = matches!(
        names.as_slice(),
        [Some(subject), Some("apps"), Some(scope), Some(APP_HOSTS_DIRECTORY)]
            if is_hashed_name(subject) && is_hashed_name(scope)
    );
    if !valid_shape {
        return Err(unavailable("projection-invalid", None));
    }
    Ok(root)
}

fn is_hashed_name(value: &str) -> bool {
    value.len() == HASHED_NAME_LENGTH
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

// Windows directories inherit ACLs, so only unix reads the root metadata.
#[cfg_attr(not(unix), allow(dead_code))]
enum DirectoryPolicy<'a> {
    /// The shared `app-hosts` directory follows the selected root's existing
    /// access policy.
    SharedRoot(&'a fs::Metadata),
    /// Per-user scope and profile directories stay private to the GUI user.
    Private,
}

fn ensure_directory(path: &Path, policy: DirectoryPolicy<'_>) -> Result<(), NimiHostError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() {
                return Err(unavailable("link-rejected", None));
            }
            if !metadata.is_dir() {
                return Err(unavailable("not-directory", None));
            }
            Ok(())
        }
        Err(error) if error.kind() == ErrorKind::NotFound => {
            create_directory(path, &policy).or_else(|error| {
                // Another Host of the same user may have created it meanwhile;
                // accept only a real directory, never a link.
                if error.kind() == ErrorKind::AlreadyExists {
                    let metadata = fs::symlink_metadata(path)
                        .map_err(|error| unavailable("inspect", Some(&error)))?;
                    if metadata.file_type().is_symlink() || !metadata.is_dir() {
                        return Err(unavailable("link-rejected", None));
                    }
                    return Ok(());
                }
                Err(unavailable("create", Some(&error)))
            })
        }
        Err(error) => Err(unavailable("inspect", Some(&error))),
    }
}

#[cfg(unix)]
fn create_directory(path: &Path, policy: &DirectoryPolicy<'_>) -> std::io::Result<()> {
    use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
    let mode = match policy {
        DirectoryPolicy::SharedRoot(root) => root.permissions().mode() & 0o7777,
        DirectoryPolicy::Private => 0o700,
    };
    fs::DirBuilder::new().mode(mode).create(path)?;
    // DirBuilder applies the process umask; a shared directory this process
    // created keeps the root's exact mode so other OS users can create theirs.
    if matches!(policy, DirectoryPolicy::SharedRoot(_)) {
        fs::set_permissions(path, fs::Permissions::from_mode(mode))?;
    }
    Ok(())
}

#[cfg(not(unix))]
fn create_directory(path: &Path, _policy: &DirectoryPolicy<'_>) -> std::io::Result<()> {
    // Windows directories inherit the selected root's ACL.
    fs::create_dir(path)
}

fn write_probe(directory: &Path) -> Result<(), NimiHostError> {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_nanos())
        .unwrap_or_default();
    let probe = directory.join(format!(
        ".nimi-host-profile-probe-{}-{nanos}",
        std::process::id()
    ));
    let written = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&probe)
        .and_then(|mut file| file.write_all(b"nimi-host-profile"));
    let removed = fs::remove_file(&probe);
    written.map_err(|error| unavailable("write-probe", Some(&error)))?;
    removed.map_err(|error| unavailable("write-probe-remove", Some(&error)))
}

fn unavailable(stage: &str, error: Option<&std::io::Error>) -> NimiHostError {
    let mut metadata = BTreeMap::from([(
        "native_operation".to_string(),
        format!("host-profile-{stage}"),
    )]);
    if let Some(code) = error.and_then(std::io::Error::raw_os_error) {
        metadata.insert("native_error_code".to_string(), code.to_string());
    }
    NimiHostError::new(NimiHostErrorReasonCode::HostProfileUnavailable, false)
        .with_reason_metadata(metadata)
}

#[cfg(test)]
pub(crate) fn test_profile_projection(data_root: &Path) -> HostStorageProjection {
    HostStorageProjection {
        profile_root: data_root
            .join(APP_HOSTS_DIRECTORY)
            .join("01".repeat(16))
            .join("apps")
            .join("10".repeat(16))
            .to_string_lossy()
            .into_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_data_root(label: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "nimi-host-profile-{label}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).expect("create data root");
        root
    }

    #[test]
    fn prepare_creates_profile_children_and_scopes_child_temp() {
        let data_root = temp_data_root("create");
        let projection = test_profile_projection(&data_root);
        let profile = prepare(Some(projection.clone())).expect("prepare profile");
        assert_eq!(profile.root(), Path::new(&projection.profile_root));
        for child in PROFILE_CHILDREN {
            assert!(profile.root().join(child).is_dir(), "{child} must exist");
            assert_eq!(
                fs::read_dir(profile.root().join(child)).unwrap().count(),
                0,
                "write probe must not leave files in {child}"
            );
        }
        let environment = profile.environment();
        assert_eq!(environment[0].0, HOST_PROFILE_ENVIRONMENT_KEY);
        assert_eq!(environment[0].1, profile.root().as_os_str());
        for (key, value) in &environment[1..] {
            assert_eq!(value, profile.temp().as_os_str(), "{key}");
        }
        // Preparing again reuses the same directories.
        assert_eq!(prepare(Some(projection)).expect("prepare again"), profile);
        let _ = fs::remove_dir_all(&data_root);
    }

    #[test]
    fn prepare_fails_closed_for_missing_or_malformed_projection() {
        let data_root = temp_data_root("invalid");
        assert_eq!(
            prepare(None).unwrap_err().reason_code(),
            NimiHostErrorReasonCode::HostProfileUnavailable
        );
        for raw in [
            String::new(),
            format!("relative/app-hosts/{}/apps/{}", "01".repeat(16), "10".repeat(16)),
            data_root.join("app-hosts").join("short").join("apps").join("10".repeat(16)).to_string_lossy().into_owned(),
            data_root.join("other").join("01".repeat(16)).join("apps").join("10".repeat(16)).to_string_lossy().into_owned(),
            data_root.join("app-hosts").join("AB".repeat(16)).join("apps").join("10".repeat(16)).to_string_lossy().into_owned(),
            format!(" {}", test_profile_projection(&data_root).profile_root),
        ] {
            let error = prepare(Some(HostStorageProjection { profile_root: raw.clone() }))
                .expect_err("malformed projection must fail");
            assert_eq!(
                error.reason_code(),
                NimiHostErrorReasonCode::HostProfileUnavailable,
                "{raw}"
            );
        }
        assert!(
            !data_root.join("app-hosts").exists(),
            "nothing may be created for invalid input"
        );
        let _ = fs::remove_dir_all(&data_root);
    }

    #[test]
    fn prepare_rejects_a_file_in_place_of_a_profile_directory() {
        let data_root = temp_data_root("conflict");
        let projection = test_profile_projection(&data_root);
        let root = PathBuf::from(&projection.profile_root);
        fs::create_dir_all(&root).expect("create profile root");
        fs::write(root.join("session-data"), b"not a directory").expect("write conflict");
        let error = prepare(Some(projection)).expect_err("file conflict must fail");
        assert_eq!(
            error
                .reason_metadata()
                .get("native_operation")
                .map(String::as_str),
            Some("host-profile-not-directory")
        );
        let _ = fs::remove_dir_all(&data_root);
    }

    #[test]
    fn prepare_rejects_a_linked_profile_directory() {
        let data_root = temp_data_root("link");
        let outside = data_root.join("outside");
        fs::create_dir_all(&outside).expect("create outside");
        let projection = test_profile_projection(&data_root);
        let root = PathBuf::from(&projection.profile_root);
        fs::create_dir_all(root.parent().unwrap()).expect("create apps");
        #[cfg(unix)]
        let linked = std::os::unix::fs::symlink(&outside, &root);
        #[cfg(windows)]
        let linked = std::os::windows::fs::symlink_dir(&outside, &root);
        if linked.is_err() {
            // Unprivileged Windows accounts may not create directory links.
            let _ = fs::remove_dir_all(&data_root);
            return;
        }
        let error = prepare(Some(projection)).expect_err("linked profile must fail");
        assert_eq!(
            error
                .reason_metadata()
                .get("native_operation")
                .map(String::as_str),
            Some("host-profile-link-rejected")
        );
        assert_eq!(
            fs::read_dir(&outside).unwrap().count(),
            0,
            "nothing may be written through the link"
        );
        let _ = fs::remove_dir_all(&data_root);
    }

    #[cfg(unix)]
    #[test]
    fn shared_app_hosts_keeps_the_root_mode_despite_the_umask() {
        use std::os::unix::fs::PermissionsExt;
        let data_root = temp_data_root("shared-mode");
        fs::set_permissions(&data_root, fs::Permissions::from_mode(0o775)).expect("share root");
        prepare(Some(test_profile_projection(&data_root))).expect("prepare profile");
        let mode = fs::metadata(data_root.join(APP_HOSTS_DIRECTORY))
            .expect("app-hosts")
            .permissions()
            .mode()
            & 0o7777;
        assert_eq!(mode, 0o775, "other OS users must be able to create their scope");
        let _ = fs::remove_dir_all(&data_root);
    }

    #[test]
    fn stale_devtools_port_file_is_removed_before_launch() {
        let data_root = temp_data_root("devtools");
        let profile = prepare(Some(test_profile_projection(&data_root))).expect("prepare");
        let port_files = [
            profile.user_data().join(DEVTOOLS_ACTIVE_PORT_FILE),
            profile
                .root()
                .join("session-data")
                .join(DEVTOOLS_ACTIVE_PORT_FILE),
        ];
        for port_file in &port_files {
            fs::write(port_file, b"9222\n/devtools/browser/stale").expect("write stale port");
        }
        profile
            .clear_devtools_active_port()
            .expect("clear stale port");
        for port_file in &port_files {
            assert!(!port_file.exists());
        }
        profile
            .clear_devtools_active_port()
            .expect("absent port file is fine");
        let _ = fs::remove_dir_all(&data_root);
    }
}
