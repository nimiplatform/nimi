use super::{
    claim_launch_token, persist_viewer_preset_to_manifest, read_viewer_preset_from_manifest,
    resolve_world_tour_fixture_from_manifest_path, validate_viewer_preset, write_launch_token,
    ViewerPresetVector, WorldTourViewerPreset, WorldTourViewerPresetCamera,
    DEFAULT_WORLD_TOUR_MANIFEST_REL,
};
use crate::test_support::with_product_data_home;
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

fn temp_dir(prefix: &str) -> PathBuf {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("time")
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("nimi-world-tour-{prefix}-{unique}"));
    fs::create_dir_all(&dir).expect("create temp dir");
    dir
}

fn write_fixture(root: &PathBuf) -> PathBuf {
    let fixture_dir = root
        .join(".nimi")
        .join("data")
        .join("apps")
        .join("nimi.tester")
        .join("cache")
        .join("worldlabs")
        .join("world-tour")
        .join("latest");
    fs::create_dir_all(&fixture_dir).expect("create fixture dir");
    let spz = fixture_dir.join("world.spz");
    let collider = fixture_dir.join("collider.glb");
    fs::write(&spz, b"spz").expect("write spz");
    fs::write(&collider, b"glb").expect("write collider");
    let spz_sha256 = super::sha256_file_hex(&spz).expect("spz sha256");
    let collider_sha256 = super::sha256_file_hex(&collider).expect("collider sha256");
    let manifest_path = fixture_dir.join("fixture-manifest.json");
    fs::write(
        &manifest_path,
        format!(
            r#"{{
  "world_id": "world-1",
  "model": "marble-1.1",
  "caption": "Fixture caption",
  "spz_local_path": "{}",
  "collider_mesh_local_path": "{}",
  "thumbnail_remote_url": "https://example.invalid/thumb.webp",
  "asset_integrity": {{
"spz_local_path": {{
  "sha256": "{}",
  "provenance_ref": "worldlabs-job:job-1"
}},
"collider_mesh_local_path": {{
  "sha256": "{}",
  "provenance_ref": "worldlabs-job:job-1"
}}
  }},
  "semantics_metadata": {{
"ground_plane_offset": 0,
"metric_scale_factor": 1.2
  }}
}}"#,
            spz.display(),
            collider.display(),
            spz_sha256,
            collider_sha256
        ),
    )
    .expect("write manifest");
    manifest_path
}

fn sample_preset(source: &str) -> WorldTourViewerPreset {
    WorldTourViewerPreset {
        version: 1,
        mode: "inspect".to_string(),
        source: source.to_string(),
        camera: WorldTourViewerPresetCamera {
            position: ViewerPresetVector {
                x: 12.0,
                y: 24.0,
                z: 36.0,
            },
            target: ViewerPresetVector {
                x: 1.0,
                y: 2.0,
                z: 3.0,
            },
        },
    }
}

#[test]
fn fixture_resolution_returns_canonical_local_paths() {
    let home = temp_dir("resolve");
    with_product_data_home(&home, || {
        let manifest_path = write_fixture(&home);
        let fixture =
            resolve_world_tour_fixture_from_manifest_path(DEFAULT_WORLD_TOUR_MANIFEST_REL)
                .expect("resolve fixture");
        assert_eq!(
            fixture.manifest_path,
            manifest_path
                .canonicalize()
                .expect("canonical manifest")
                .to_string_lossy()
        );
        assert!(fixture
            .spz_local_path
            .as_deref()
            .is_some_and(|value| value.ends_with("world.spz")));
        assert!(fixture
            .collider_mesh_local_path
            .as_deref()
            .is_some_and(|value| value.ends_with("collider.glb")));
        assert_eq!(fixture.model.as_deref(), Some("marble-1.1"));
        assert!(fixture.viewer_preset.is_none());
    });
}

#[test]
fn fixture_resolution_merges_viewer_preset_when_present() {
    let home = temp_dir("merge-preset");
    with_product_data_home(&home, || {
        let manifest_path = write_fixture(&home);
        let preset = sample_preset("manual");
        persist_viewer_preset_to_manifest(&manifest_path, &preset).expect("persist preset");
        let fixture =
            resolve_world_tour_fixture_from_manifest_path(DEFAULT_WORLD_TOUR_MANIFEST_REL)
                .expect("resolve fixture");
        assert_eq!(fixture.viewer_preset, Some(preset));
    });
}

#[test]
fn viewer_preset_persistence_roundtrips() {
    let home = temp_dir("persist-preset");
    with_product_data_home(&home, || {
        let manifest_path = write_fixture(&home);
        let preset = sample_preset("manual");
        let preset_path =
            persist_viewer_preset_to_manifest(&manifest_path, &preset).expect("persist preset");
        let loaded = read_viewer_preset_from_manifest(&manifest_path)
            .expect("read preset")
            .expect("preset exists");
        assert!(preset_path.ends_with("viewer-preset.json"));
        assert_eq!(loaded, preset);
    });
}

#[test]
fn viewer_preset_validation_rejects_unknown_source() {
    let err = validate_viewer_preset(sample_preset("bad-source")).expect_err("preset should fail");
    assert!(err.contains("source"));
}

#[test]
fn viewer_launch_token_is_one_time_and_manifest_bound() {
    let home = temp_dir("launch-token");
    with_product_data_home(&home, || {
        let manifest_path = write_fixture(&home)
            .canonicalize()
            .expect("canonical manifest");
        let token = write_launch_token(&manifest_path).expect("write launch token");
        claim_launch_token(&manifest_path, &token).expect("claim token");
        let err = claim_launch_token(&manifest_path, &token)
            .expect_err("claimed token should fail closed");
        assert!(err.contains("launch token"));
    });
}

#[test]
fn viewer_launch_token_rejects_manifest_mismatch() {
    let home = temp_dir("launch-token-mismatch");
    with_product_data_home(&home, || {
        let manifest_path = write_fixture(&home)
            .canonicalize()
            .expect("canonical manifest");
        let other_manifest = manifest_path
            .parent()
            .expect("manifest dir")
            .join("other-fixture-manifest.json");
        fs::write(&other_manifest, "{}").expect("write other manifest");
        let token = write_launch_token(&manifest_path).expect("write launch token");
        let err =
            claim_launch_token(&other_manifest, &token).expect_err("wrong manifest should fail");
        assert!(err.contains("manifest"));
    });
}

#[test]
fn fixture_resolution_fails_closed_outside_cache_root() {
    let home = temp_dir("reject");
    with_product_data_home(&home, || {
        let outside_dir = home.join("outside");
        fs::create_dir_all(&outside_dir).expect("create outside dir");
        let manifest_path = outside_dir.join("fixture-manifest.json");
        fs::write(&manifest_path, "{}").expect("write outside manifest");
        let err =
            resolve_world_tour_fixture_from_manifest_path(manifest_path.to_string_lossy().as_ref())
                .expect_err("outside fixture should fail");
        assert!(err.contains("Tester App cache") || err.contains("超出允许目录"));
    });
}

#[test]
fn fixture_resolution_fails_closed_without_asset_integrity() {
    let home = temp_dir("missing-integrity");
    with_product_data_home(&home, || {
        let manifest_path = write_fixture(&home);
        let raw = fs::read_to_string(&manifest_path).expect("read manifest");
        let stripped = raw
            .split("  \"asset_integrity\"")
            .next()
            .expect("manifest head")
            .trim_end_matches(",\n")
            .to_string()
            + "\n}";
        fs::write(&manifest_path, stripped).expect("write stripped manifest");
        let err = resolve_world_tour_fixture_from_manifest_path(DEFAULT_WORLD_TOUR_MANIFEST_REL)
            .expect_err("missing integrity should fail");
        assert!(err.contains("asset_integrity"));
    });
}

#[test]
fn fixture_resolution_fails_closed_on_digest_mismatch() {
    let home = temp_dir("digest-mismatch");
    with_product_data_home(&home, || {
        let manifest_path = write_fixture(&home);
        let raw = fs::read_to_string(&manifest_path).expect("read manifest");
        fs::write(
            &manifest_path,
            raw.replace("worldlabs-job:job-1", "worldlabs-job:job-1"),
        )
        .expect("rewrite manifest");
        let spz = manifest_path
            .parent()
            .expect("manifest dir")
            .join("world.spz");
        fs::write(&spz, b"tampered").expect("tamper spz");
        let err = resolve_world_tour_fixture_from_manifest_path(DEFAULT_WORLD_TOUR_MANIFEST_REL)
            .expect_err("digest mismatch should fail");
        assert!(err.contains("digest mismatch"));
    });
}
