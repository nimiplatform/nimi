use crate::{ProtectedCarrierError, ProtectedCarrierReasonCode};
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::os::windows::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use windows_sys::Win32::Foundation::LocalFree;
use windows_sys::Win32::Globalization::{CompareStringOrdinal, CSTR_EQUAL};
use windows_sys::Win32::Security::Authorization::{
    ConvertSidToStringSidW, GetNamedSecurityInfoW, SE_FILE_OBJECT,
};
use windows_sys::Win32::Security::{
    GetAce, ACCESS_ALLOWED_ACE, ACL, DACL_SECURITY_INFORMATION, OWNER_SECURITY_INFORMATION,
};
use windows_sys::Win32::Storage::FileSystem::{
    GetFileAttributesW, FILE_ATTRIBUTE_REPARSE_POINT, INVALID_FILE_ATTRIBUTES,
};
use windows_sys::Win32::System::Com::CoTaskMemFree;
use windows_sys::Win32::UI::Shell::{FOLDERID_ProgramFiles, SHGetKnownFolderPath};

const PUBLIC_KEY: Option<&str> = option_env!("NIMI_WINDOWS_PRODUCT_PUBLIC_KEY");
pub(crate) fn verify_runtime(
    path: &Path,
    file: &mut File,
) -> Result<String, ProtectedCarrierError> {
    Ok(verify_role(path, file, "runtime/nimi.exe")?
        .components
        .runtime
        .version)
}
fn verify_role(
    path: &Path,
    file: &mut File,
    role: &str,
) -> Result<crate::windows_product_identity::Identity, ProtectedCarrierError> {
    let mut raw = std::ptr::null_mut();
    if unsafe { SHGetKnownFolderPath(&FOLDERID_ProgramFiles, 0, std::ptr::null_mut(), &mut raw) }
        != 0
        || raw.is_null()
    {
        return Err(untrusted());
    }
    let mut length = 0;
    unsafe {
        while *raw.add(length) != 0 {
            length += 1;
        }
    }
    let program_files = PathBuf::from(
        String::from_utf16(unsafe { std::slice::from_raw_parts(raw, length) })
            .map_err(|_| untrusted())?,
    );
    unsafe {
        CoTaskMemFree(raw.cast());
    }
    let product = program_files.join("Nimi").join("Product");
    let root = role_root(path, &product, role)?;
    administrative_path(&product)?;
    administrative_path(product.parent().ok_or_else(untrusted)?)?;
    administrative_path(&root)?;
    let identity_path = root.join("nimi-product-identity.json");
    administrative_path(&identity_path)?;
    let metadata = fs::metadata(&identity_path).map_err(|_| untrusted())?;
    if metadata.len() > 128 * 1024 {
        return Err(untrusted());
    }
    let identity = crate::windows_product_identity::verify(
        &fs::read(&identity_path).map_err(|_| untrusted())?,
        PUBLIC_KEY.ok_or_else(untrusted)?,
    )
    .map_err(|_| untrusted())?;
    if root.file_name().and_then(|v| v.to_str()) != Some(&identity.version)
        || identity.files.get(role) != Some(&hash_file(file)?)
    {
        return Err(untrusted());
    }
    let mut seen = 0usize;
    fn visit(
        root: &Path,
        dir: &Path,
        identity: &crate::windows_product_identity::Identity,
        seen: &mut usize,
    ) -> Result<(), ProtectedCarrierError> {
        for entry in fs::read_dir(dir).map_err(|_| untrusted())? {
            let entry = entry.map_err(|_| untrusted())?;
            let path = entry.path();
            administrative_path(&path)?;
            if entry.file_type().map_err(|_| untrusted())?.is_dir() {
                visit(root, &path, identity, seen)?;
                continue;
            }
            let relative = path
                .strip_prefix(root)
                .map_err(|_| untrusted())?
                .to_str()
                .ok_or_else(untrusted)?
                .replace('\\', "/");
            if relative == "nimi-product-identity.json" {
                continue;
            }
            if identity.files.get(&relative)
                != Some(&hash_file(&mut File::open(path).map_err(|_| untrusted())?)?)
            {
                return Err(untrusted());
            }
            *seen += 1;
        }
        Ok(())
    }
    visit(&root, &root, &identity, &mut seen)?;
    if seen != identity.files.len() {
        return Err(untrusted());
    }
    Ok(identity)
}

// Windows preserves the spelling used to launch an executable. Accept case
// differences only after checking the original location and every product
// component for reparses; canonical paths still distinguish real siblings in
// case-sensitive directories. Signed inventory names remain exact.
fn role_root(path: &Path, product: &Path, role: &str) -> Result<PathBuf, ProtectedCarrierError> {
    let mut root = path;
    for _ in role.split('/') {
        non_reparse_path(root)?;
        root = root.parent().ok_or_else(untrusted)?;
    }
    let parent = root.parent().ok_or_else(untrusted)?;
    if !same_windows_spelling(parent, product) || !same_windows_spelling(path, &root.join(role)) {
        return Err(untrusted());
    }
    non_reparse_path(root)?;
    non_reparse_path(parent)?;
    non_reparse_path(parent.parent().ok_or_else(untrusted)?)?;
    let canonical = fs::canonicalize(path).map_err(|_| untrusted())?;
    let root = fs::canonicalize(root).map_err(|_| untrusted())?;
    let product = fs::canonicalize(product).map_err(|_| untrusted())?;
    if root.parent() != Some(product.as_path()) || canonical != root.join(role) {
        return Err(untrusted());
    }
    Ok(root)
}

fn same_windows_spelling(left: &Path, right: &Path) -> bool {
    let spelling = |path: &Path| {
        path.as_os_str()
            .encode_wide()
            .map(|unit| {
                if unit == b'/' as u16 {
                    b'\\' as u16
                } else {
                    unit
                }
            })
            .collect::<Vec<_>>()
    };
    let left = spelling(left);
    let right = spelling(right);
    unsafe {
        CompareStringOrdinal(
            left.as_ptr(),
            left.len() as i32,
            right.as_ptr(),
            right.len() as i32,
            1,
        ) == CSTR_EQUAL
    }
}

pub(crate) fn updater_host() -> Result<(String, String), ProtectedCarrierError> {
    use std::os::windows::fs::OpenOptionsExt;
    let path = std::env::current_exe().map_err(|_| untrusted())?;
    let mut executable = std::fs::OpenOptions::new()
        .read(true)
        .share_mode(1)
        .open(&path)
        .map_err(|_| untrusted())?;
    verify_role(&path, &mut executable, "Nimi.exe")?;
    Ok((
        path.parent()
            .ok_or_else(untrusted)?
            .join("NimiProductUpdater.exe")
            .to_str()
            .ok_or_else(untrusted)?
            .to_owned(),
        PUBLIC_KEY.ok_or_else(untrusted)?.to_owned(),
    ))
}
fn hash_file(file: &mut File) -> Result<String, ProtectedCarrierError> {
    file.seek(SeekFrom::Start(0)).map_err(|_| untrusted())?;
    let mut hash = Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        let size = file.read(&mut buffer).map_err(|_| untrusted())?;
        if size == 0 {
            break;
        }
        hash.update(&buffer[..size]);
    }
    file.seek(SeekFrom::Start(0)).map_err(|_| untrusted())?;
    Ok(hash.finalize().iter().map(|b| format!("{b:02x}")).collect())
}
fn sid_string(sid: *mut std::ffi::c_void) -> Result<String, ProtectedCarrierError> {
    if sid.is_null() {
        return Err(untrusted());
    }
    let mut raw = std::ptr::null_mut();
    if unsafe { ConvertSidToStringSidW(sid, &mut raw) } == 0 {
        return Err(untrusted());
    }
    let mut length = 0;
    unsafe {
        while *raw.add(length) != 0 {
            length += 1;
        }
    }
    let value = String::from_utf16(unsafe { std::slice::from_raw_parts(raw, length) })
        .map_err(|_| untrusted());
    unsafe {
        LocalFree(raw.cast());
    }
    value
}
fn administrative_path(path: &Path) -> Result<(), ProtectedCarrierError> {
    non_reparse_path(path)?;
    let wide: Vec<_> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let mut owner = std::ptr::null_mut();
    let mut acl: *mut ACL = std::ptr::null_mut();
    let mut descriptor = std::ptr::null_mut();
    let status = unsafe {
        GetNamedSecurityInfoW(
            wide.as_ptr(),
            SE_FILE_OBJECT,
            OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
            &mut owner,
            std::ptr::null_mut(),
            &mut acl,
            std::ptr::null_mut(),
            &mut descriptor,
        )
    };
    if status != 0 || descriptor.is_null() {
        return Err(untrusted());
    }
    let result = (|| {
        if !["S-1-5-18", "S-1-5-32-544"].contains(&sid_string(owner)?.as_str())
            || acl.is_null()
            || unsafe { (*acl).AceCount } == 0
        {
            return Err(untrusted());
        }
        for index in 0..unsafe { (*acl).AceCount } {
            let mut raw = std::ptr::null_mut();
            if unsafe { GetAce(acl, index as u32, &mut raw) } == 0 || raw.is_null() {
                return Err(untrusted());
            }
            let ace = unsafe { &*raw.cast::<ACCESS_ALLOWED_ACE>() };
            if ace.Header.AceType == 1 {
                continue;
            } // ACCESS_DENIED_ACE_TYPE
            if ace.Header.AceType != 0 {
                return Err(untrusted());
            } // ACCESS_ALLOWED_ACE_TYPE
            let sid = sid_string((&ace.SidStart as *const u32).cast_mut().cast())?;
            if !["S-1-5-18", "S-1-5-32-544"].contains(&sid.as_str())
                && ace.Mask
                    & (0x10000000
                        | 0x40000000
                        | 0x10000
                        | 0x40000
                        | 0x80000
                        | 2
                        | 4
                        | 16
                        | 256
                        | 64)
                    != 0
            {
                return Err(untrusted());
            }
        }
        Ok(())
    })();
    unsafe {
        LocalFree(descriptor);
    }
    result
}
fn non_reparse_path(path: &Path) -> Result<(), ProtectedCarrierError> {
    let wide: Vec<_> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let attrs = unsafe { GetFileAttributesW(wide.as_ptr()) };
    if attrs == INVALID_FILE_ATTRIBUTES || attrs & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        return Err(untrusted());
    }
    Ok(())
}
fn untrusted() -> ProtectedCarrierError {
    ProtectedCarrierError::new(ProtectedCarrierReasonCode::RuntimeServiceUntrusted, false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let unique = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let root = std::env::temp_dir()
                .join(format!("nimi-role-case-{}-{unique}", std::process::id()));
            fs::create_dir(&root).unwrap();
            Self(root)
        }
        fn product(&self) -> PathBuf {
            self.0.join("Nimi").join("Product")
        }
        fn cohort(&self) -> PathBuf {
            self.product().join("0.2.5-rc.8")
        }
        fn populate(&self) {
            fs::create_dir_all(self.cohort().join("runtime")).unwrap();
            fs::write(self.cohort().join("Nimi.exe"), b"home path fixture").unwrap();
            fs::write(
                self.cohort().join("runtime/nimi.exe"),
                b"runtime path fixture",
            )
            .unwrap();
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.0).unwrap();
        }
    }

    #[test]
    fn actual_home_and_runtime_paths_accept_launch_case_variants() {
        let fixture = Fixture::new();
        fixture.populate();
        for role in ["Nimi.exe", "runtime/nimi.exe"] {
            let path = fixture.cohort().join(role);
            let expected = fs::canonicalize(fixture.cohort()).unwrap();
            for spelling in [
                path.to_string_lossy().to_lowercase(),
                path.to_string_lossy().to_uppercase(),
                path.to_string_lossy().replace('/', "\\"),
            ] {
                let opened = File::open(&spelling).unwrap();
                assert_eq!(
                    role_root(Path::new(&spelling), &fixture.product(), role).unwrap(),
                    expected
                );
                drop(opened);
            }
        }
    }

    #[test]
    fn case_tolerance_keeps_fixed_location_role_and_existence_checks() {
        let fixture = Fixture::new();
        fixture.populate();
        let home = fixture.cohort().join("Nimi.exe");
        assert!(role_root(
            &home,
            &fixture.product().with_file_name("Product-other"),
            "Nimi.exe"
        )
        .is_err());
        assert!(role_root(&home, &fixture.product(), "runtime/nimi.exe").is_err());
        let wrong_role = fixture.cohort().join("Other.exe");
        fs::hard_link(&home, &wrong_role).unwrap();
        assert!(role_root(&wrong_role, &fixture.product(), "Nimi.exe").is_err());
        assert!(role_root(
            &fixture.cohort().join("missing.exe"),
            &fixture.product(),
            "Nimi.exe"
        )
        .is_err());
    }

    #[test]
    fn original_reparse_components_are_rejected_before_canonicalization() {
        let fixture = Fixture::new();
        fixture.populate();
        let alias = fixture.product().join("0.2.5-rc.9");
        std::os::windows::fs::symlink_dir(fixture.cohort(), &alias).unwrap();
        assert!(role_root(&alias.join("Nimi.exe"), &fixture.product(), "Nimi.exe").is_err());
        fs::remove_dir(alias).unwrap();
    }
}
