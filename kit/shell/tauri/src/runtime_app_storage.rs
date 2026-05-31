use std::fs;
use std::path::{Path, PathBuf};

pub fn canonical_storage_root(root: &str, label: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(root.trim());
    if !path.is_absolute() {
        return Err(format!(
            "{label} must be an absolute Runtime app storage root"
        ));
    }
    fs::create_dir_all(&path)
        .map_err(|error| format!("create {label} failed ({}): {error}", path.display()))?;
    path.canonicalize()
        .map_err(|error| format!("resolve {label} failed: {error}"))
}

pub fn scoped_storage_child(
    root: &str,
    label: &str,
    child: impl AsRef<Path>,
) -> Result<PathBuf, String> {
    let root = canonical_storage_root(root, label)?;
    let child_path = root.join(child.as_ref());
    if let Some(parent) = child_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "create {label} child directory failed ({}): {error}",
                parent.display()
            )
        })?;
    }
    let parent = child_path
        .parent()
        .ok_or_else(|| format!("{label} child has no parent"))?
        .canonicalize()
        .map_err(|error| format!("resolve {label} child parent failed: {error}"))?;
    if !parent.starts_with(&root) {
        return Err(format!("{label} child escapes Runtime app storage root"));
    }
    Ok(child_path)
}

#[cfg(test)]
mod tests {
    use super::{canonical_storage_root, scoped_storage_child};
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_root(prefix: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("nimi-runtime-app-storage-{prefix}-{unique}"));
        std::fs::create_dir_all(&dir).expect("create temp root");
        dir
    }

    #[test]
    fn canonical_root_requires_absolute_path() {
        assert!(canonical_storage_root("relative/path", "test root")
            .expect_err("relative rejected")
            .contains("absolute Runtime app storage root"));
    }

    #[test]
    fn scoped_child_rejects_parent_escape() {
        let root = temp_root("escape");
        let error =
            scoped_storage_child(root.to_str().expect("root"), "test root", "../outside.json")
                .expect_err("escape rejected");
        assert!(error.contains("escapes Runtime app storage root"));
    }

    #[test]
    fn scoped_child_materializes_parent_under_root() {
        let root = temp_root("child");
        let child = scoped_storage_child(
            root.to_str().expect("root"),
            "test root",
            "nested/file.json",
        )
        .expect("child");
        assert!(child.starts_with(root.canonicalize().expect("canonical root")));
        assert!(child.parent().expect("parent").exists());
    }
}
