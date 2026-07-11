use nimi_shell_tauri::capabilities::runtime::LocalDevelopmentShellKind;
use serde_json::Value;
use std::path::{Path, PathBuf};
use url::Url;

#[derive(Clone, Debug)]
pub(crate) struct DevelopmentProjectPlan {
    pub(crate) app_id: String,
    pub(crate) display_name: String,
    pub(crate) project_root: PathBuf,
    pub(crate) renderer_origin: String,
    pub(crate) shell: DevelopmentShellPlan,
}

#[derive(Clone, Debug)]
pub(crate) enum DevelopmentShellPlan {
    Electron {
        electron_executable: PathBuf,
        main_entry: PathBuf,
    },
    Tauri {
        cargo_manifest: PathBuf,
        cargo_package: String,
        host_executable: PathBuf,
    },
}

impl DevelopmentShellPlan {
    pub(crate) const fn kind(&self) -> LocalDevelopmentShellKind {
        match self {
            Self::Electron { .. } => LocalDevelopmentShellKind::Electron,
            Self::Tauri { .. } => LocalDevelopmentShellKind::Tauri,
        }
    }

    pub(crate) const fn name(&self) -> &'static str {
        self.kind().as_str()
    }
}

pub(crate) fn resolve_project_plan(
    raw_root: &str,
    expected_app_id: &str,
    shell: &str,
) -> Result<DevelopmentProjectPlan, String> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (raw_root, expected_app_id, shell);
        return Err("local-development-platform-unsupported".to_string());
    }
    #[cfg(target_os = "windows")]
    {
        let project_root = canonical_directory(Path::new(raw_root))?;
        let (app_id, display_name) = read_manifest_identity(&project_root)?;
        if expected_app_id.trim() != expected_app_id
            || expected_app_id.is_empty()
            || expected_app_id != app_id
        {
            return Err("local-development-project-changed".to_string());
        }
        let package = read_json_file(&project_root.join("package.json"))?;
        let renderer_origin = read_renderer_origin(&project_root)?;
        require_exact_package_script(&package, "dev", "nimi-app dev --shell tauri")?;
        require_exact_package_script(&package, "dev:shell", "nimi-app dev")?;
        require_renderer_script(&package, &renderer_origin)?;
        let shell = match shell {
            "electron" => {
                require_package_script(&package, "build:electron")?;
                let electron_executable = canonical_file(
                    &project_root
                        .join("node_modules")
                        .join("electron")
                        .join("dist")
                        .join("electron.exe"),
                )?;
                let main_entry = project_root.join("dist-electron").join("main.js");
                ensure_path_within(&project_root, &main_entry)?;
                DevelopmentShellPlan::Electron {
                    electron_executable,
                    main_entry,
                }
            }
            "tauri" => {
                let cargo_manifest = project_root.join("src-tauri").join("Cargo.toml");
                ensure_path_within(&project_root, &cargo_manifest)?;
                let cargo_package = read_tauri_package_name(&cargo_manifest)?;
                let host_executable = project_root
                    .join("src-tauri")
                    .join("target")
                    .join("debug")
                    .join(format!("{cargo_package}.exe"));
                ensure_path_within(&project_root, &host_executable)?;
                DevelopmentShellPlan::Tauri {
                    cargo_manifest,
                    cargo_package,
                    host_executable,
                }
            }
            _ => return Err("local-development-project-changed".to_string()),
        };
        Ok(DevelopmentProjectPlan {
            app_id,
            display_name,
            project_root,
            renderer_origin,
            shell,
        })
    }
}

fn read_manifest_identity(root: &Path) -> Result<(String, String), String> {
    let path = root.join("nimi.app.yaml");
    ensure_path_within(root, &path)?;
    let raw = std::fs::read_to_string(&path)
        .map_err(|_| "local-development-project-changed".to_string())?;
    let document: serde_yaml::Value =
        serde_yaml::from_str(&raw).map_err(|_| "local-development-project-changed".to_string())?;
    let app_id = document
        .get("app_id")
        .and_then(serde_yaml::Value::as_str)
        .unwrap_or_default()
        .to_string();
    let display_name = document
        .get("display_name")
        .and_then(serde_yaml::Value::as_str)
        .unwrap_or_default()
        .to_string();
    if app_id.is_empty()
        || app_id.trim() != app_id
        || display_name.is_empty()
        || display_name.trim() != display_name
    {
        return Err("local-development-project-changed".to_string());
    }
    Ok((app_id, display_name))
}

fn read_renderer_origin(root: &Path) -> Result<String, String> {
    let config = read_json_file(&root.join("src-tauri").join("tauri.conf.json"))?;
    let raw = config
        .get("build")
        .and_then(Value::as_object)
        .and_then(|build| build.get("devUrl"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    let parsed =
        Url::parse(raw).map_err(|_| "local-development-dev-server-uncontrolled".to_string())?;
    if parsed.scheme() != "http"
        || parsed.port().is_none()
        || !matches!(parsed.host_str(), Some("127.0.0.1" | "localhost" | "::1"))
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.path() != "/"
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err("local-development-dev-server-uncontrolled".to_string());
    }
    Ok(parsed.origin().ascii_serialization())
}

fn read_json_file(path: &Path) -> Result<Value, String> {
    let raw = std::fs::read_to_string(path)
        .map_err(|_| "local-development-project-changed".to_string())?;
    serde_json::from_str(&raw).map_err(|_| "local-development-project-changed".to_string())
}

fn read_tauri_package_name(path: &Path) -> Result<String, String> {
    let raw = std::fs::read_to_string(path)
        .map_err(|_| "local-development-project-changed".to_string())?;
    let document: toml::Value =
        toml::from_str(&raw).map_err(|_| "local-development-project-changed".to_string())?;
    if document.get("bin").is_some() {
        return Err("local-development-project-changed".to_string());
    }
    let name = document
        .get("package")
        .and_then(toml::Value::as_table)
        .and_then(|package| package.get("name"))
        .and_then(toml::Value::as_str)
        .unwrap_or_default();
    if name.is_empty()
        || name.len() > 120
        || !name
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err("local-development-project-changed".to_string());
    }
    Ok(name.to_string())
}

fn package_script<'a>(package: &'a Value, name: &str) -> Result<&'a str, String> {
    let value = package
        .get("scripts")
        .and_then(Value::as_object)
        .and_then(|scripts| scripts.get(name))
        .and_then(Value::as_str)
        .unwrap_or_default();
    if value.is_empty() || value.trim() != value {
        return Err("local-development-project-changed".to_string());
    }
    Ok(value)
}

fn require_package_script(package: &Value, name: &str) -> Result<(), String> {
    package_script(package, name).map(|_| ())
}

fn require_exact_package_script(package: &Value, name: &str, expected: &str) -> Result<(), String> {
    if package_script(package, name)? != expected {
        return Err("local-development-project-changed".to_string());
    }
    Ok(())
}

fn require_renderer_script(package: &Value, renderer_origin: &str) -> Result<(), String> {
    let parsed = Url::parse(renderer_origin)
        .map_err(|_| "local-development-dev-server-uncontrolled".to_string())?;
    let port = parsed
        .port()
        .ok_or_else(|| "local-development-dev-server-uncontrolled".to_string())?;
    let expected = format!("vite --host 127.0.0.1 --port {port} --strictPort");
    if package_script(package, "dev:renderer")? != expected {
        return Err("local-development-dev-server-uncontrolled".to_string());
    }
    Ok(())
}

fn canonical_directory(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() || !path.is_dir() {
        return Err("local-development-project-changed".to_string());
    }
    std::fs::canonicalize(path).map_err(|_| "local-development-project-changed".to_string())
}

fn canonical_file(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() || !path.is_file() {
        return Err("local-development-project-changed".to_string());
    }
    std::fs::canonicalize(path).map_err(|_| "local-development-project-changed".to_string())
}

fn ensure_path_within(root: &Path, path: &Path) -> Result<(), String> {
    let root = root
        .to_string_lossy()
        .replace('/', "\\")
        .to_ascii_lowercase();
    let path = path
        .to_string_lossy()
        .replace('/', "\\")
        .to_ascii_lowercase();
    if path == root
        || path
            .strip_prefix(&root)
            .is_some_and(|suffix| suffix.starts_with('\\'))
    {
        return Ok(());
    }
    Err("local-development-project-changed".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renderer_origin_requires_explicit_loopback_http_port() {
        let dir = tempfile::tempdir().expect("temp");
        let root = dir.path();
        std::fs::create_dir_all(root.join("src-tauri")).expect("tauri dir");
        for (raw, expected) in [
            ("http://127.0.0.1:1468", true),
            ("http://localhost:1468", true),
            ("https://localhost:1468", false),
            ("http://192.168.1.5:1468", false),
            ("http://localhost:1468/path", false),
        ] {
            std::fs::write(
                root.join("src-tauri/tauri.conf.json"),
                serde_json::json!({ "build": { "devUrl": raw } }).to_string(),
            )
            .expect("config");
            assert_eq!(read_renderer_origin(root).is_ok(), expected, "{raw}");
        }
    }

    #[test]
    fn tauri_package_name_is_fixed_by_the_project_manifest() {
        let dir = tempfile::tempdir().expect("temp");
        let manifest = dir.path().join("Cargo.toml");
        std::fs::write(
            &manifest,
            "[package]\nname = \"acme-widget-shell\"\nversion = \"0.1.0\"\n",
        )
        .expect("manifest");
        assert_eq!(
            read_tauri_package_name(&manifest).expect("package"),
            "acme-widget-shell"
        );
        std::fs::write(
            &manifest,
            "[package]\nname = \"acme-widget-shell\"\nversion = \"0.1.0\"\n[[bin]]\nname = \"other\"\n",
        )
        .expect("custom bin manifest");
        assert!(read_tauri_package_name(&manifest).is_err());
    }

    #[test]
    fn package_scripts_require_the_official_launcher_and_exact_renderer_owner() {
        let package = serde_json::json!({
            "scripts": {
                "dev": "nimi-app dev --shell tauri",
                "dev:shell": "nimi-app dev",
                "dev:renderer": "vite --host 127.0.0.1 --port 1468 --strictPort"
            }
        });
        assert!(
            require_exact_package_script(&package, "dev", "nimi-app dev --shell tauri").is_ok()
        );
        assert!(require_renderer_script(&package, "http://127.0.0.1:1468").is_ok());

        let bypass = serde_json::json!({
            "scripts": {
                "dev": "tauri dev",
                "dev:renderer": "node rogue-server.mjs"
            }
        });
        assert!(
            require_exact_package_script(&bypass, "dev", "nimi-app dev --shell tauri").is_err()
        );
        assert!(require_renderer_script(&bypass, "http://127.0.0.1:1468").is_err());
    }
}
