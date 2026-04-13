use std::collections::HashSet;
use std::env;
use std::ffi::OsString;
use std::fs;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::json;

use super::{
    complete_import_by_id, generate_id, load_snapshot, now_iso, queue_import, retry_import_by_id,
    save_creator_sync, VenueRecord,
};
use super::db_imports::update_import_status_by_id;
use super::db_schema::open_db;
use crate::db_queries::{address_is_specific, resolve_review_state, should_show_on_map, VenueInput};
use crate::probe::{
    GeocodeOutcome, ProbeCommentClue, ProbeExtractionCoverage, ProbeMetadata, ProbeResult,
    ProbeSavedFiles,
};

fn db_test_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

struct TestHomeGuard {
    original_home: Option<OsString>,
    root: PathBuf,
}

impl TestHomeGuard {
    fn new(name: &str) -> Self {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let root = env::temp_dir().join(format!("video-food-map-db-{name}-{unique}"));
        fs::create_dir_all(&root).expect("failed to create test home");
        let original_home = env::var_os("HOME");
        env::set_var("HOME", &root);
        Self {
            original_home,
            root,
        }
    }
}

impl Drop for TestHomeGuard {
    fn drop(&mut self) {
        if let Some(value) = &self.original_home {
            env::set_var("HOME", value);
        } else {
            env::remove_var("HOME");
        }
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn sample_probe_result() -> ProbeResult {
    ProbeResult {
        metadata: ProbeMetadata {
            bvid: "BV1xx411c7mD".to_string(),
            aid: "123".to_string(),
            cid: "456".to_string(),
            title: "上海探店".to_string(),
            owner_mid: "789".to_string(),
            owner_name: "测试博主".to_string(),
            duration_sec: 98.5,
            description: "今天去吃了两家店".to_string(),
            tags: vec!["上海".to_string(), "美食".to_string()],
            canonical_url: "https://www.bilibili.com/video/BV1xx411c7mD/".to_string(),
        },
        audio_source_url: "https://example.com/audio.m4a".to_string(),
        selected_stt_model: "stt-model".to_string(),
        selected_text_model: "text-model".to_string(),
        raw_comment_count: 5,
        comment_clues: vec![ProbeCommentClue {
            comment_id: "c1".to_string(),
            author_name: "路人甲".to_string(),
            message: "这家店我也去过".to_string(),
            like_count: 8,
            published_at: "2026-04-06T10:00:00.000Z".to_string(),
            matched_venue_names: vec!["炭火小馆".to_string()],
            address_hint: "静安区".to_string(),
        }],
        extraction_coverage: ProbeExtractionCoverage {
            state: "complete".to_string(),
            processed_segment_count: 4,
            processed_duration_sec: 98.5,
            total_duration_sec: 98.5,
        },
        transcript: "先去炭火小馆，再去面馆".to_string(),
        extraction_raw: "原始提取文本".to_string(),
        extraction_json: Some(json!({
            "video_summary": "视频讲了两家店",
            "uncertain_points": ["第二家门牌号没听清"],
            "venues": [
                {
                    "venue_name": "炭火小馆",
                    "address_text": "",
                    "recommended_dishes": ["鸡翅"],
                    "cuisine_tags": ["烧烤"],
                    "flavor_tags": ["香辣"],
                    "evidence": ["鸡翅不错"],
                    "confidence": "high",
                    "recommendation_polarity": "positive",
                    "needs_review": false
                }
            ]
        })),
        output_dir: "/tmp/video-food-map-test".to_string(),
        saved_files: ProbeSavedFiles {
            metadata_json: "/tmp/video-food-map-test/metadata.json".to_string(),
            transcript_text: "/tmp/video-food-map-test/transcript.txt".to_string(),
            extraction_raw_text: "/tmp/video-food-map-test/extraction-raw.txt".to_string(),
            extraction_json: "/tmp/video-food-map-test/extraction.json".to_string(),
        },
    }
}

fn sample_input(address_text: &str) -> VenueInput {
    VenueInput {
        venue_name: "炭火小馆".to_string(),
        address_text: address_text.to_string(),
        recommended_dishes: vec!["烤鸡翅".to_string()],
        cuisine_tags: vec![],
        flavor_tags: vec![],
        evidence: vec!["这家鸡翅不错".to_string()],
        confidence: "high".to_string(),
        recommendation_polarity: "positive".to_string(),
        needs_review: false,
    }
}

#[test]
fn vague_business_area_is_not_specific_enough_for_map_promotion() {
    assert!(!address_is_specific("天河城商圈附近"));
}

#[test]
fn street_address_is_specific_enough_for_map_promotion() {
    assert!(address_is_specific("广州市天河区体育西路123号"));
}

#[test]
fn resolved_geocode_can_map_when_name_search_finds_a_place() {
    let geocode = GeocodeOutcome {
        provider: "amap".to_string(),
        status: "resolved".to_string(),
        query: "炭火小馆 天河城商圈".to_string(),
        latitude: Some(23.0),
        longitude: Some(113.0),
    };
    assert_eq!(
        resolve_review_state(&sample_input("天河城商圈"), &geocode),
        "map_ready"
    );
}

#[test]
fn resolved_precise_address_can_map_even_if_record_still_needs_review() {
    let mut input = sample_input("上海市静安区茂名北路68号");
    input.needs_review = true;
    let geocode = GeocodeOutcome {
        provider: "amap".to_string(),
        status: "resolved".to_string(),
        query: "上海市静安区茂名北路68号".to_string(),
        latitude: Some(31.227),
        longitude: Some(121.459),
    };
    assert_eq!(resolve_review_state(&input, &geocode), "map_ready");
}

#[test]
fn user_confirmed_venue_with_coordinates_can_show_on_map() {
    let venue = VenueRecord {
        id: "venue-1".to_string(),
        import_id: "import-1".to_string(),
        venue_name: "那木山选有料蛋饼".to_string(),
        address_text: "上海市静安区茂名北路68号".to_string(),
        recommended_dishes: vec![],
        cuisine_tags: vec![],
        flavor_tags: vec![],
        evidence: vec![],
        confidence: "medium".to_string(),
        recommendation_polarity: "positive".to_string(),
        needs_review: true,
        review_state: "review".to_string(),
        geocode_status: "resolved".to_string(),
        geocode_query: "上海市静安区茂名北路68号".to_string(),
        latitude: Some(31.225032),
        longitude: Some(121.460684),
        user_confirmed: true,
        is_favorite: false,
        created_at: now_iso(),
        updated_at: now_iso(),
    };
    assert!(should_show_on_map(&venue));
}

#[test]
fn queue_import_reuses_active_bvid_row_without_restart() {
    let _lock = db_test_lock().lock().expect("failed to lock db test mutex");
    let _home = TestHomeGuard::new("reuse-active");

    let first = queue_import(
        "https://www.bilibili.com/video/BV1xx411c7mD/",
        "BV1xx411c7mD",
    )
    .expect("failed to queue first import");
    let second = queue_import(
        "https://www.bilibili.com/video/BV1xx411c7mD/?share_source=copy_web",
        "BV1xx411c7mD",
    )
    .expect("failed to queue second import");

    assert!(first.should_start);
    assert!(!second.should_start);
    assert_eq!(first.record.id, second.record.id);

    let conn = open_db().expect("failed to reopen db");
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM imports", [], |row| row.get(0))
        .expect("failed to count imports");
    assert_eq!(count, 1);
}

#[test]
fn queue_import_reuses_normalized_url_when_bvid_is_missing() {
    let _lock = db_test_lock().lock().expect("failed to lock db test mutex");
    let _home = TestHomeGuard::new("reuse-url");

    let first = queue_import("https://b23.tv/demo-short-link", "")
        .expect("failed to queue first short url import");
    let second = queue_import("https://b23.tv/demo-short-link#fragment", "")
        .expect("failed to queue second short url import");

    assert!(first.should_start);
    assert!(!second.should_start);
    assert_eq!(first.record.id, second.record.id);
}

#[test]
fn queue_import_can_restart_failed_row_without_creating_duplicate() {
    let _lock = db_test_lock().lock().expect("failed to lock db test mutex");
    let _home = TestHomeGuard::new("restart-failed");

    let first = queue_import(
        "https://www.bilibili.com/video/BV1xx411c7mD/",
        "BV1xx411c7mD",
    )
    .expect("failed to queue import");
    let conn = open_db().expect("failed to reopen db");
    update_import_status_by_id(&conn, &first.record.id, "failed", "boom")
        .expect("failed to mark import failed");

    let retried = queue_import(
        "https://www.bilibili.com/video/BV1xx411c7mD/",
        "BV1xx411c7mD",
    )
    .expect("failed to retry import");

    assert!(retried.should_start);
    assert_eq!(retried.record.id, first.record.id);
    assert_eq!(retried.record.status, "queued");
    assert!(retried.record.error_message.is_empty());
}

#[test]
fn complete_import_writes_summary_and_venues() {
    let _lock = db_test_lock().lock().expect("failed to lock db test mutex");
    let _home = TestHomeGuard::new("complete-import");

    let queued = queue_import(
        "https://www.bilibili.com/video/BV1xx411c7mD/",
        "BV1xx411c7mD",
    )
    .expect("failed to queue import");
    let completed = complete_import_by_id(
        &queued.record.id,
        "https://www.bilibili.com/video/BV1xx411c7mD/",
        &sample_probe_result(),
    )
    .expect("failed to complete import");

    assert_eq!(completed.status, "succeeded");
    assert_eq!(completed.bvid, "BV1xx411c7mD");
    assert_eq!(completed.video_summary, "视频讲了两家店");
    assert_eq!(completed.venues.len(), 1);
    assert_eq!(completed.venues[0].venue_name, "炭火小馆");
}

#[test]
fn retry_import_reuses_failed_row_and_requeues_it() {
    let _lock = db_test_lock().lock().expect("failed to lock db test mutex");
    let _home = TestHomeGuard::new("retry-import");

    let first = queue_import(
        "https://www.bilibili.com/video/BV1xx411c7mD/",
        "BV1xx411c7mD",
    )
    .expect("failed to queue import");
    let conn = open_db().expect("failed to reopen db");
    update_import_status_by_id(&conn, &first.record.id, "failed", "boom")
        .expect("failed to mark import failed");

    let retried = retry_import_by_id(&first.record.id).expect("failed to retry import by id");
    assert!(retried.should_start);
    assert_eq!(retried.record.id, first.record.id);
    assert_eq!(retried.record.status, "queued");
    assert!(retried.record.error_message.is_empty());
}

#[test]
fn generate_id_stays_unique_within_the_same_burst() {
    let mut ids = HashSet::new();
    for _ in 0..64 {
        let id = generate_id("venue");
        assert!(ids.insert(id), "generated duplicate venue id");
    }
}

#[test]
fn snapshot_includes_saved_creator_syncs() {
    let _lock = db_test_lock().lock().expect("failed to lock db test mutex");
    let _home = TestHomeGuard::new("creator-sync-history");

    save_creator_sync(
        "123456",
        "测试博主",
        "https://space.bilibili.com/123456",
        12,
        4,
        8,
    )
    .expect("failed to save creator sync");

    let snapshot = load_snapshot().expect("failed to load snapshot");
    assert_eq!(snapshot.creator_syncs.len(), 1);
    let sync = &snapshot.creator_syncs[0];
    assert_eq!(sync.creator_mid, "123456");
    assert_eq!(sync.creator_name, "测试博主");
    assert_eq!(sync.last_scanned_count, 12);
    assert_eq!(sync.last_queued_count, 4);
    assert_eq!(sync.last_skipped_existing_count, 8);
}
