use super::db::{
    clear_binding, get_binding, import_live2d, import_vrm, list_resources, open_db,
    read_resource_asset, set_binding,
};
use super::types::{
    DesktopAgentAvatarBindingSetPayload, DesktopAgentAvatarImportLive2dPayload,
    DesktopAgentAvatarImportVrmPayload, DesktopAgentAvatarResourceKind,
};
use crate::test_support::with_env;
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

fn temp_home(prefix: &str) -> PathBuf {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("time")
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("nimi-desktop-avatar-{prefix}-{unique}"));
    fs::create_dir_all(&dir).expect("create temp home");
    dir
}

#[test]
fn imported_vrm_is_copied_under_nimi_data_and_can_bind_to_agent() {
    let home = temp_home("vrm-import");
    with_env(&[("HOME", home.to_str())], || {
        let downloads = home.join("Downloads");
        fs::create_dir_all(&downloads).expect("downloads");
        let source = downloads.join("sample.vrm");
        fs::write(&source, b"vrm-sample").expect("write sample vrm");

        let conn = open_db().expect("open db");
        let imported = import_vrm(
            &conn,
            &DesktopAgentAvatarImportVrmPayload {
                source_path: source.display().to_string(),
                display_name: Some("Sample Hero".to_string()),
                bind_agent_id: Some("agent-1".to_string()),
                imported_at_ms: Some(100),
            },
        )
        .expect("import vrm");

        assert_eq!(imported.resource.kind, DesktopAgentAvatarResourceKind::Vrm);
        assert!(imported.resource.stored_path.contains("/.nimi/data/avatar-resources/resources/"));
        assert!(PathBuf::from(&imported.resource.stored_path).join("sample.vrm").exists());
        assert!(imported.resource.file_url.starts_with("file://"));
        assert_eq!(
            imported.binding.expect("binding").agent_id,
            "agent-1".to_string()
        );

        let resources = list_resources(&conn).expect("list resources");
        assert_eq!(resources.len(), 1);
        let binding = get_binding(&conn, "agent-1")
            .expect("binding")
            .expect("binding present");
        assert_eq!(binding.resource_id, resources[0].resource_id);
    });
}

#[test]
fn imported_live2d_directory_is_copied_under_nimi_data() {
    let home = temp_home("live2d-import");
    with_env(&[("HOME", home.to_str())], || {
        let source_root = home.join("ren_pro_zh").join("runtime");
        fs::create_dir_all(source_root.join("expressions")).expect("expressions");
        fs::write(source_root.join("ren.model3.json"), b"{}").expect("model3");
        fs::write(source_root.join("ren.moc3"), b"moc3").expect("moc3");
        fs::write(source_root.join("texture_00.png"), b"png").expect("png");

        let conn = open_db().expect("open db");
        let imported = import_live2d(
            &conn,
            &DesktopAgentAvatarImportLive2dPayload {
                source_path: source_root.display().to_string(),
                display_name: Some("Ren".to_string()),
                bind_agent_id: None,
                imported_at_ms: Some(200),
            },
        )
        .expect("import live2d");

        assert_eq!(imported.resource.kind, DesktopAgentAvatarResourceKind::Live2d);
        assert!(PathBuf::from(&imported.resource.stored_path).join("ren.model3.json").exists());
        assert!(imported.resource.file_url.ends_with("/ren.model3.json"));
        assert!(imported.binding.is_none());
    });
}

#[test]
fn deleting_resource_cascades_binding_and_removes_managed_directory() {
    let home = temp_home("resource-delete");
    with_env(&[("HOME", home.to_str())], || {
        let downloads = home.join("Downloads");
        fs::create_dir_all(&downloads).expect("downloads");
        let source = downloads.join("sample.vrm");
        fs::write(&source, b"vrm-sample").expect("write sample vrm");

        let conn = open_db().expect("open db");
        let imported = import_vrm(
            &conn,
            &DesktopAgentAvatarImportVrmPayload {
                source_path: source.display().to_string(),
                display_name: Some("Delete Me".to_string()),
                bind_agent_id: None,
                imported_at_ms: Some(300),
            },
        )
        .expect("import vrm");

        let binding = set_binding(
            &conn,
            &DesktopAgentAvatarBindingSetPayload {
                agent_id: "agent-delete".to_string(),
                resource_id: imported.resource.resource_id.clone(),
                updated_at_ms: 301,
            },
        )
        .expect("set binding");
        assert_eq!(binding.agent_id, "agent-delete");

        let stored_path = PathBuf::from(imported.resource.stored_path.clone());
        assert!(super::db::delete_resource(&conn, &imported.resource.resource_id).expect("delete resource"));
        assert!(!stored_path.exists());
        assert!(get_binding(&conn, "agent-delete").expect("binding lookup").is_none());
        assert!(list_resources(&conn).expect("resources").is_empty());
    });
}

#[test]
fn clearing_binding_returns_true_only_when_binding_exists() {
    let home = temp_home("clear-binding");
    with_env(&[("HOME", home.to_str())], || {
        let conn = open_db().expect("open db");
        assert!(!clear_binding(&conn, "missing-agent").expect("clear missing"));
    });
}

#[test]
fn imported_resources_and_bindings_survive_db_reopen() {
    let home = temp_home("db-reopen");
    with_env(&[("HOME", home.to_str())], || {
        let downloads = home.join("Downloads");
        fs::create_dir_all(&downloads).expect("downloads");
        let source = downloads.join("persistent.vrm");
        fs::write(&source, b"vrm-persistent").expect("write sample vrm");

        {
            let conn = open_db().expect("open db");
            let imported = import_vrm(
                &conn,
                &DesktopAgentAvatarImportVrmPayload {
                    source_path: source.display().to_string(),
                    display_name: Some("Persistent Hero".to_string()),
                    bind_agent_id: Some("agent-persist".to_string()),
                    imported_at_ms: Some(400),
                },
            )
            .expect("import vrm");
            assert_eq!(imported.resource.display_name, "Persistent Hero");
        }

        let reopened = open_db().expect("reopen db");
        let resources = list_resources(&reopened).expect("list resources after reopen");
        assert_eq!(resources.len(), 1);
        assert_eq!(resources[0].display_name, "Persistent Hero");
        let binding = get_binding(&reopened, "agent-persist")
            .expect("binding lookup after reopen")
            .expect("binding present after reopen");
        assert_eq!(binding.resource_id, resources[0].resource_id);
    });
}

#[test]
fn imported_vrm_can_be_read_back_as_binary_asset_payload() {
    let home = temp_home("read-asset");
    with_env(&[("HOME", home.to_str())], || {
        let downloads = home.join("Downloads");
        fs::create_dir_all(&downloads).expect("downloads");
        let source = downloads.join("sample.vrm");
        fs::write(&source, b"vrm-sample-binary").expect("write sample vrm");

        let conn = open_db().expect("open db");
        let imported = import_vrm(
            &conn,
            &DesktopAgentAvatarImportVrmPayload {
                source_path: source.display().to_string(),
                display_name: Some("Sample Hero".to_string()),
                bind_agent_id: None,
                imported_at_ms: Some(500),
            },
        )
        .expect("import vrm");

        let payload = read_resource_asset(&conn, &imported.resource.resource_id).expect("read asset");
        assert_eq!(payload.mime_type, "model/gltf-binary");
        assert!(!payload.base64.is_empty());
    });
}
