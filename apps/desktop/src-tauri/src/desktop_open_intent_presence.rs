use super::PRESENCE_RELATIVE_PATH;
use base64::Engine;
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};
pub(super) fn presence_descriptor_path(nimi_dir: &Path) -> PathBuf {
    PRESENCE_RELATIVE_PATH
        .iter()
        .fold(nimi_dir.to_path_buf(), |path, segment| path.join(segment))
}

pub(super) fn write_presence_descriptor(
    path: &Path,
    descriptor: &super::DesktopOpenPresenceDescriptor,
) -> Result<(), String> {
    write_presence_document(path, descriptor)
}

pub(crate) fn write_presence_document<T: serde::Serialize>(
    path: &Path,
    descriptor: &T,
) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "desktop open presence descriptor path has no parent".to_string())?;
    reject_symlink_ancestry(parent, "desktop open presence parent")?;
    reject_symlink_if_exists(path, "desktop open presence descriptor")?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("desktop open presence directory create failed: {error}"))?;
    reject_symlink_ancestry(parent, "desktop open presence parent")?;
    reject_descriptor_temp_symlinks(parent, path)?;
    set_owner_only_dir(parent)?;
    let temp_path = descriptor_temp_path(path)?;
    let bytes = serde_json::to_vec_pretty(descriptor)
        .map_err(|error| format!("desktop open presence serialize failed: {error}"))?;
    write_presence_temp_file(&temp_path, &bytes)?;
    replace_presence_descriptor_atomically(&temp_path, path)?;
    set_owner_only_file(path)
}

#[cfg(not(windows))]
fn replace_presence_descriptor_atomically(temp_path: &Path, path: &Path) -> Result<(), String> {
    fs::rename(temp_path, path)
        .map_err(|error| format!("desktop open presence atomic replace failed: {error}"))
}

#[cfg(windows)]
fn replace_presence_descriptor_atomically(temp_path: &Path, path: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let source = temp_path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<u16>>();
    let target = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<u16>>();
    let replaced = unsafe {
        MoveFileExW(
            source.as_ptr(),
            target.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if replaced == 0 {
        return Err(format!(
            "desktop open presence atomic replace failed: {}",
            std::io::Error::last_os_error()
        ));
    }
    Ok(())
}

fn descriptor_temp_path(path: &Path) -> Result<PathBuf, String> {
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "desktop open presence descriptor path has no file name".to_string())?;
    Ok(path.with_file_name(format!("{}.{}.tmp", file_name, random_base64_url(12)?)))
}

fn write_presence_temp_file(temp_path: &Path, bytes: &[u8]) -> Result<(), String> {
    reject_symlink_if_exists(temp_path, "desktop open presence temp descriptor")?;
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    configure_owner_only_temp_open_options(&mut options);
    let mut file = options
        .open(temp_path)
        .map_err(|error| format!("desktop open presence temp create failed: {error}"))?;
    file.write_all(bytes)
        .map_err(|error| format!("desktop open presence temp write failed: {error}"))?;
    file.sync_all()
        .map_err(|error| format!("desktop open presence temp sync failed: {error}"))?;
    set_owner_only_file(temp_path)
}

#[cfg(unix)]
fn configure_owner_only_temp_open_options(options: &mut fs::OpenOptions) {
    use std::os::unix::fs::OpenOptionsExt;
    options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
}

#[cfg(not(unix))]
fn configure_owner_only_temp_open_options(_options: &mut fs::OpenOptions) {}

fn reject_descriptor_temp_symlinks(parent: &Path, descriptor_path: &Path) -> Result<(), String> {
    let descriptor_file_name = descriptor_path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "desktop open presence descriptor path has no file name".to_string())?;
    let temp_prefix = format!("{descriptor_file_name}.");
    for entry in fs::read_dir(parent)
        .map_err(|error| format!("desktop open presence temp directory scan failed: {error}"))?
    {
        let entry = entry.map_err(|error| {
            format!("desktop open presence temp directory entry scan failed: {error}")
        })?;
        let file_name = entry.file_name();
        let Some(file_name) = file_name.to_str() else {
            continue;
        };
        if !file_name.starts_with(temp_prefix.as_str()) || !file_name.ends_with(".tmp") {
            continue;
        }
        if entry
            .file_type()
            .map_err(|error| format!("desktop open presence temp metadata failed: {error}"))?
            .is_symlink()
        {
            return Err("desktop open presence temp descriptor must not be a symlink".to_string());
        }
    }
    Ok(())
}

fn reject_symlink_if_exists(path: &Path, label: &str) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            Err(format!("{label} must not be a symlink"))
        }
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("{label} metadata check failed: {error}")),
    }
}

fn reject_symlink_ancestry(path: &Path, label: &str) -> Result<(), String> {
    let mut current = PathBuf::new();
    for component in path.components() {
        current.push(component.as_os_str());
        #[cfg(windows)]
        if matches!(component, std::path::Component::Prefix(_)) {
            continue;
        }
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(format!("{label} ancestry must not contain symlinks"));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("{label} ancestry metadata check failed: {error}")),
        }
    }
    Ok(())
}

#[cfg(unix)]
fn set_owner_only_dir(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
        .map_err(|error| format!("desktop open presence chmod dir failed: {error}"))
}

#[cfg(not(unix))]
fn set_owner_only_dir(_path: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(unix)]
fn set_owner_only_file(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
        .map_err(|error| format!("desktop open presence chmod file failed: {error}"))
}

#[cfg(not(unix))]
fn set_owner_only_file(_path: &Path) -> Result<(), String> {
    Ok(())
}

pub(crate) fn random_base64_url(byte_count: usize) -> Result<String, String> {
    let mut bytes = vec![0_u8; byte_count];
    getrandom::getrandom(&mut bytes)
        .map_err(|error| format!("desktop open random generation failed: {error}"))?;
    Ok(base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes))
}

pub(crate) fn now_iso8601() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}
