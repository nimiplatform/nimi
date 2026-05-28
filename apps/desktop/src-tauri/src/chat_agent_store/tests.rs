use super::*;
use crate::test_support::with_product_data_home;
use rusqlite::{params, Connection};
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

fn temp_home(prefix: &str) -> PathBuf {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("time")
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("nimi-chat-agent-{prefix}-{unique}"));
    fs::create_dir_all(&dir).expect("create temp home");
    dir
}

fn sample_local_agent_ref(owner_user_id: &str, realm_agent_id: &str) -> String {
    format!("local-agent:{owner_user_id}:{realm_agent_id}")
}

fn sample_target_snapshot(realm_agent_id: &str) -> ChatAgentTargetSnapshot {
    sample_target_snapshot_for_owner("user-1", realm_agent_id)
}

fn sample_target_snapshot_for_owner(
    owner_user_id: &str,
    realm_agent_id: &str,
) -> ChatAgentTargetSnapshot {
    ChatAgentTargetSnapshot {
        owner_user_id: owner_user_id.to_string(),
        realm_agent_id: realm_agent_id.to_string(),
        local_agent_ref: sample_local_agent_ref(owner_user_id, realm_agent_id),
        display_name: "Agent One".to_string(),
        handle: "~agent-one".to_string(),
        avatar_url: Some("https://example.com/avatar.png".to_string()),
        world_id: Some("world-1".to_string()),
        world_name: Some("OASIS".to_string()),
        bio: Some("Helpful agent".to_string()),
        ownership_type: Some("WORLD_OWNED".to_string()),
    }
}

fn sample_create_thread_input(
    id: &str,
    owner_user_id: &str,
    realm_agent_id: &str,
) -> ChatAgentCreateThreadInput {
    ChatAgentCreateThreadInput {
        id: id.to_string(),
        owner_user_id: owner_user_id.to_string(),
        realm_agent_id: realm_agent_id.to_string(),
        local_agent_ref: sample_local_agent_ref(owner_user_id, realm_agent_id),
        title: "Agent One".to_string(),
        created_at_ms: 100,
        updated_at_ms: 120,
        last_message_at_ms: None,
        target_snapshot: sample_target_snapshot_for_owner(owner_user_id, realm_agent_id),
    }
}

#[test]
fn chat_agent_db_path_stays_under_nimi_data_dir() {
    let home = temp_home("db-path");
    with_product_data_home(&home, || {
        let path = super::db::db_path().expect("db path");
        assert_eq!(
            path,
            crate::desktop_paths::resolve_nimi_data_dir()
                .expect("nimi data dir")
                .join("chat-agent")
                .join("main.db")
        );
    });
}

#[test]
fn chat_agent_open_db_initializes_schema_idempotently() {
    let home = temp_home("schema");
    with_product_data_home(&home, || {
        let path = crate::desktop_paths::resolve_nimi_data_dir()
            .expect("nimi data dir")
            .join("chat-agent")
            .join("main.db");
        fs::create_dir_all(path.parent().expect("parent")).expect("create parent");
        let conn = Connection::open(&path).expect("open");
        super::schema::init_schema(&conn).expect("init schema");
        super::schema::init_schema(&conn).expect("init schema again");

        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("user_version");
        assert_eq!(version, CHAT_AGENT_DB_SCHEMA_VERSION);
    });
}

#[test]
fn chat_agent_store_round_trip_thread() {
    let home = temp_home("roundtrip");
    with_product_data_home(&home, || {
        let path = crate::desktop_paths::resolve_nimi_data_dir()
            .expect("nimi data dir")
            .join("chat-agent")
            .join("main.db");
        fs::create_dir_all(path.parent().expect("parent")).expect("create parent");
        let conn = Connection::open(&path).expect("open");
        super::schema::init_schema(&conn).expect("init schema");

        let thread = create_thread(
            &conn,
            &sample_create_thread_input("thread-agent-001", "user-1", "agent-001"),
        )
        .expect("create thread");
        assert_eq!(thread.realm_agent_id, "agent-001");
        assert_eq!(thread.owner_user_id, "user-1");
        assert_eq!(thread.local_agent_ref, "local-agent:user-1:agent-001");

        let threads = list_threads(&conn).expect("list threads");
        assert_eq!(threads.len(), 1);
        assert_eq!(threads[0].target_snapshot.handle, "~agent-one");

        let bundle = get_thread_bundle(&conn, &thread.id)
            .expect("bundle")
            .expect("bundle present");
        assert!(bundle.messages.is_empty());
    });
}

#[test]
fn chat_agent_store_rejects_missing_thread_reuses_duplicate_agent_and_invalid_json() {
    let home = temp_home("errors");
    with_product_data_home(&home, || {
        let path = crate::desktop_paths::resolve_nimi_data_dir()
            .expect("nimi data dir")
            .join("chat-agent")
            .join("main.db");
        fs::create_dir_all(path.parent().expect("parent")).expect("create parent");
        let conn = Connection::open(&path).expect("open");
        super::schema::init_schema(&conn).expect("init schema");

        let created = create_thread(
            &conn,
            &sample_create_thread_input("thread-agent-dup", "user-1", "agent-dup"),
        )
        .expect("create thread");
        assert_eq!(created.id, "thread-agent-dup");

        let duplicate_agent = create_thread(
            &conn,
            &ChatAgentCreateThreadInput {
                id: "thread-agent-dup-2".to_string(),
                owner_user_id: "user-1".to_string(),
                realm_agent_id: "agent-dup".to_string(),
                local_agent_ref: sample_local_agent_ref("user-1", "agent-dup"),
                title: "Agent Dup Updated".to_string(),
                created_at_ms: 101,
                updated_at_ms: 121,
                last_message_at_ms: None,
                target_snapshot: ChatAgentTargetSnapshot {
                    display_name: "Agent Dup Updated".to_string(),
                    ..sample_target_snapshot("agent-dup")
                },
            },
        )
        .expect("duplicate agent should reuse existing thread");
        assert_eq!(duplicate_agent.id, "thread-agent-dup");
        assert_eq!(duplicate_agent.title, "Agent Dup Updated");
        assert_eq!(
            duplicate_agent.target_snapshot.display_name,
            "Agent Dup Updated"
        );

        conn.execute(
            r#"
            UPDATE agent_threads
            SET target_snapshot_json = ?2
            WHERE id = ?1
            "#,
            params!["thread-agent-dup", "{bad-json"],
        )
        .expect("insert bad json");
        let bundle_error =
            get_thread_bundle(&conn, "thread-agent-dup").expect_err("bad json should fail");
        assert!(bundle_error.contains("invalid JSON"));
    });
}

#[test]
fn chat_agent_store_isolates_same_realm_agent_across_owners() {
    let home = temp_home("owner-isolation");
    with_product_data_home(&home, || {
        let path = crate::desktop_paths::resolve_nimi_data_dir()
            .expect("nimi data dir")
            .join("chat-agent")
            .join("main.db");
        fs::create_dir_all(path.parent().expect("parent")).expect("create parent");
        let conn = Connection::open(&path).expect("open");
        super::schema::init_schema(&conn).expect("init schema");

        let alice = create_thread(
            &conn,
            &sample_create_thread_input("thread-alice-shared-agent", "alice", "agent-shared"),
        )
        .expect("create alice thread");
        let bob = create_thread(
            &conn,
            &sample_create_thread_input("thread-bob-shared-agent", "bob", "agent-shared"),
        )
        .expect("create bob thread");

        assert_ne!(alice.id, bob.id);
        assert_eq!(alice.realm_agent_id, bob.realm_agent_id);
        assert_ne!(alice.local_agent_ref, bob.local_agent_ref);

        let alice_bundle = get_thread_bundle(&conn, &alice.id)
            .expect("alice bundle")
            .expect("alice bundle present");
        let bob_bundle = get_thread_bundle(&conn, &bob.id)
            .expect("bob bundle")
            .expect("bob bundle present");
        assert_eq!(alice_bundle.thread.local_agent_ref, "local-agent:alice:agent-shared");
        assert_eq!(bob_bundle.thread.local_agent_ref, "local-agent:bob:agent-shared");

        let threads = list_threads(&conn).expect("list threads");
        assert_eq!(threads.len(), 2);
        assert!(threads
            .iter()
            .any(|thread| thread.local_agent_ref == "local-agent:alice:agent-shared"));
        assert!(threads
            .iter()
            .any(|thread| thread.local_agent_ref == "local-agent:bob:agent-shared"));
    });
}

#[test]
fn chat_agent_store_rejects_invalid_local_agent_identity() {
    let home = temp_home("identity-negative");
    with_product_data_home(&home, || {
        let path = crate::desktop_paths::resolve_nimi_data_dir()
            .expect("nimi data dir")
            .join("chat-agent")
            .join("main.db");
        fs::create_dir_all(path.parent().expect("parent")).expect("create parent");
        let conn = Connection::open(&path).expect("open");
        super::schema::init_schema(&conn).expect("init schema");

        let mut missing =
            sample_create_thread_input("thread-missing-local-ref", "user-1", "agent-negative");
        missing.local_agent_ref.clear();
        assert!(create_thread(&conn, &missing)
            .expect_err("missing localAgentRef should fail")
            .contains("localAgentIdentity.localAgentRef must not be empty"));

        let mut bare =
            sample_create_thread_input("thread-bare-local-ref", "user-1", "agent-negative");
        bare.local_agent_ref = "agent-negative".to_string();
        assert!(create_thread(&conn, &bare)
            .expect_err("bare realmAgentId should fail")
            .contains("localAgentRef must not be bare realmAgentId"));

        let mut malformed =
            sample_create_thread_input("thread-malformed-local-ref", "user-1", "agent-negative");
        malformed.local_agent_ref = "localagent:user-1:agent-negative".to_string();
        assert!(create_thread(&conn, &malformed)
            .expect_err("malformed localAgentRef should fail")
            .contains("localAgentRef must start with local-agent:"));

        let mut owner_mismatch =
            sample_create_thread_input("thread-owner-mismatch", "user-1", "agent-negative");
        owner_mismatch.local_agent_ref = sample_local_agent_ref("user-2", "agent-negative");
        owner_mismatch.target_snapshot.local_agent_ref = owner_mismatch.local_agent_ref.clone();
        assert!(create_thread(&conn, &owner_mismatch)
            .expect_err("owner mismatch should fail")
            .contains("localAgentRef must equal"));

        let mut realm_mismatch =
            sample_create_thread_input("thread-realm-mismatch", "user-1", "agent-negative");
        realm_mismatch.local_agent_ref = sample_local_agent_ref("user-1", "agent-other");
        realm_mismatch.target_snapshot.local_agent_ref = realm_mismatch.local_agent_ref.clone();
        assert!(create_thread(&conn, &realm_mismatch)
            .expect_err("realm mismatch should fail")
            .contains("localAgentRef must equal"));

        let mut snapshot_mismatch =
            sample_create_thread_input("thread-snapshot-mismatch", "user-1", "agent-negative");
        snapshot_mismatch.target_snapshot.owner_user_id = "user-2".to_string();
        snapshot_mismatch.target_snapshot.local_agent_ref =
            sample_local_agent_ref("user-2", "agent-negative");
        assert!(create_thread(&conn, &snapshot_mismatch)
            .expect_err("target snapshot mismatch should fail")
            .contains("targetSnapshot local identity must match"));
    });
}
