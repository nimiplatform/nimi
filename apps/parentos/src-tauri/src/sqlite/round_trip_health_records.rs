use super::{run_migrations, seed_family_and_child};
use rusqlite::{params, Connection};

#[test]
fn health_record_event_values_round_trip_and_cascade_with_child_delete() {
    let conn = Connection::open_in_memory().expect("open in-memory db");
    conn.execute_batch("PRAGMA foreign_keys=ON;")
        .expect("enable fk");
    run_migrations(&conn).expect("run migrations");
    seed_family_and_child(&conn);

    conn.execute(
        "INSERT INTO health_record_events (
            eventId, childId, protocolId, groupId, recordKind, sourceSurface,
            recordedAt, effectiveDate, ageMonths, notes, createdAt, updatedAt
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)",
        params![
            "hre-1",
            "child-1",
            "growth-basic",
            "growth",
            "manual",
            "profile_detail",
            "2026-02-01T09:00:00.000Z",
            "2026-02-01",
            62,
            "school measurement",
            "2026-02-01T09:05:00.000Z"
        ],
    )
    .expect("insert health record event");

    conn.execute(
        "INSERT INTO health_record_values (
            valueId, eventId, childId, metricId, valueNumber, unit, recordKind, createdAt
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            "hrv-1",
            "hre-1",
            "child-1",
            "growth.height",
            112.4,
            "cm",
            "measured",
            "2026-02-01T09:05:00.000Z"
        ],
    )
    .expect("insert health record value");

    let row = conn
        .query_row(
            "SELECT e.groupId, v.metricId, v.valueNumber, v.unit
             FROM health_record_events e
             JOIN health_record_values v ON v.eventId = e.eventId
             WHERE e.eventId = ?1",
            params!["hre-1"],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<f64>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                ))
            },
        )
        .expect("query health record");
    assert_eq!(row.0, "growth");
    assert_eq!(row.1, "growth.height");
    assert!((row.2.unwrap() - 112.4).abs() < 0.01);
    assert_eq!(row.3.as_deref(), Some("cm"));

    conn.execute(
        "DELETE FROM children WHERE childId = ?1",
        params!["child-1"],
    )
    .expect("delete child");

    let event_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM health_record_events", [], |row| {
            row.get(0)
        })
        .expect("count events");
    let value_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM health_record_values", [], |row| {
            row.get(0)
        })
        .expect("count values");
    assert_eq!(event_count, 0);
    assert_eq!(value_count, 0);
}

#[test]
fn migration_v13_backfills_existing_growth_measurements_into_health_records() {
    let conn = Connection::open_in_memory().expect("open in-memory db");
    conn.execute_batch("PRAGMA foreign_keys=ON;")
        .expect("enable fk");
    run_migrations(&conn).expect("run migrations");
    seed_family_and_child(&conn);

    // v21 retired the legacy growth_measurements table (see
    // apps/parentos/src-tauri/src/sqlite/migrations_v21.rs and
    // apps/parentos/spec/kernel/tables/local-storage.yaml#growth_measurement_canonical_migration.retirement_plan).
    // To preserve coverage of the v13 backfill semantics (a historical
    // one-time migration whose mapping authority is still spec-bound),
    // we recreate the legacy table here as a test fixture, populate it
    // with pre-cutover-shape rows, then call run_migrations again to
    // trigger the v13 backfill via repair_missing_tables. v21 will
    // drop the table again at the end of the repair chain, which is
    // correct end-state behaviour.
    conn.execute_batch(
        "CREATE TABLE growth_measurements (
            measurementId TEXT PRIMARY KEY NOT NULL,
            childId       TEXT NOT NULL REFERENCES children(childId) ON DELETE CASCADE,
            typeId        TEXT NOT NULL,
            value         REAL NOT NULL,
            measuredAt    TEXT NOT NULL,
            ageMonths     INTEGER NOT NULL,
            percentile    REAL,
            source        TEXT,
            notes         TEXT,
            createdAt     TEXT NOT NULL
        );
         CREATE INDEX idx_growth_child_type_date ON growth_measurements (childId, typeId, measuredAt);
         CREATE INDEX idx_growth_child_age ON growth_measurements (childId, ageMonths);",
    )
    .expect("recreate legacy growth_measurements fixture for v13 backfill test");

    conn.execute(
        "INSERT INTO growth_measurements (
            measurementId, childId, typeId, value, measuredAt, ageMonths,
            percentile, source, notes, createdAt
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, ?7, ?8, ?9)",
        params![
            "precutover-height-1",
            "child-1",
            "height",
            145.2,
            "2026-02-01T09:00:00.000Z",
            25,
            "manual",
            "school measurement",
            "2026-02-01T09:05:00.000Z"
        ],
    )
    .expect("insert precutover height");
    conn.execute(
        "INSERT INTO growth_measurements (
            measurementId, childId, typeId, value, measuredAt, ageMonths,
            percentile, source, notes, createdAt
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, ?7, ?8, ?9)",
        params![
            "precutover-vision-left-1",
            "child-1",
            "vision-left",
            0.8,
            "2026-02-02T09:00:00.000Z",
            25,
            "ocr",
            "vision sheet",
            "2026-02-02T09:05:00.000Z"
        ],
    )
    .expect("insert precutover vision");

    run_migrations(&conn).expect("repair migration backfill");
    run_migrations(&conn).expect("idempotent repair migration backfill");

    let height = conn
        .query_row(
            "SELECT e.protocolId, e.groupId, e.sourceSurface, v.metricId, v.valueNumber, v.unit
             FROM health_record_events e
             JOIN health_record_values v ON v.eventId = e.eventId
             WHERE e.eventId = 'precutover-growth-measurement:precutover-height-1'",
            [],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, Option<f64>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                ))
            },
        )
        .expect("query backfilled height");
    assert_eq!(height.0, "growth-child-quarterly");
    assert_eq!(height.1, "growth");
    assert_eq!(height.2, "profile_detail");
    assert_eq!(height.3, "growth.height");
    assert_eq!(height.4, Some(145.2));
    assert_eq!(height.5.as_deref(), Some("cm"));

    let vision = conn
        .query_row(
            "SELECT e.protocolId, e.groupId, e.sourceSurface, v.metricId, v.valueNumber, v.unit, v.qualifier
             FROM health_record_events e
             JOIN health_record_values v ON v.eventId = e.eventId
             WHERE e.eventId = 'precutover-growth-measurement:precutover-vision-left-1'",
            [],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, Option<f64>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, Option<String>>(6)?,
                ))
            },
        )
        .expect("query backfilled vision");
    assert_eq!(vision.0, "vision-basic");
    assert_eq!(vision.1, "vision");
    assert_eq!(vision.2, "ocr_tool");
    assert_eq!(vision.3, "vision.left_visual_acuity");
    assert_eq!(vision.4, Some(0.8));
    assert_eq!(vision.5.as_deref(), Some("decimal"));
    assert_eq!(vision.6.as_deref(), Some("left"));

    let event_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM health_record_events WHERE eventId LIKE 'precutover-growth-measurement:%'",
            [],
            |row| row.get(0),
        )
        .expect("count backfilled events");
    let value_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM health_record_values WHERE valueId LIKE 'precutover-growth-value:%'",
            [],
            |row| row.get(0),
        )
        .expect("count backfilled values");
    assert_eq!(event_count, 2);
    assert_eq!(value_count, 2);
}

#[test]
fn save_health_record_capture_persists_event_and_values_transactionally() {
    let mut conn = Connection::open_in_memory().expect("open in-memory db");
    conn.execute_batch("PRAGMA foreign_keys=ON;")
        .expect("enable fk");
    run_migrations(&conn).expect("run migrations");
    seed_family_and_child(&conn);

    let result = crate::sqlite::queries::save_health_record_capture_with_conn(
        &mut conn,
        crate::sqlite::queries::SaveHealthRecordCaptureInput {
            event_id: "hre-capture-1".to_string(),
            child_id: "child-1".to_string(),
            protocol_id: "growth-child-quarterly".to_string(),
            group_id: "growth".to_string(),
            record_kind: "manual".to_string(),
            source_surface: "profile_detail".to_string(),
            recorded_at: "2026-05-02T10:00:00.000Z".to_string(),
            effective_date: "2026-05-02".to_string(),
            age_months: 27,
            recorder_id: None,
            linked_reminder_state_id: None,
            linked_reminder_rule_id: None,
            notes: Some("school check".to_string()),
            metadata_json: Some("{\"mode\":\"manual\"}".to_string()),
            now: "2026-05-02T10:00:00.000Z".to_string(),
            values: vec![
                crate::sqlite::queries::HealthRecordCaptureValueInput {
                    value_id: "hrv-height".to_string(),
                    metric_id: "growth.height".to_string(),
                    value_number: Some(96.4),
                    value_text: None,
                    value_json: None,
                    unit: Some("cm".to_string()),
                    qualifier: None,
                    record_kind: "measured".to_string(),
                    source_value_ids: None,
                },
                crate::sqlite::queries::HealthRecordCaptureValueInput {
                    value_id: "hrv-weight".to_string(),
                    metric_id: "growth.weight".to_string(),
                    value_number: Some(14.2),
                    value_text: None,
                    value_json: None,
                    unit: Some("kg".to_string()),
                    qualifier: None,
                    record_kind: "measured".to_string(),
                    source_value_ids: None,
                },
                crate::sqlite::queries::HealthRecordCaptureValueInput {
                    value_id: "hrv-bmi".to_string(),
                    metric_id: "growth.bmi".to_string(),
                    value_number: Some(15.3),
                    value_text: None,
                    value_json: None,
                    unit: Some("kg/m2".to_string()),
                    qualifier: None,
                    record_kind: "derived".to_string(),
                    source_value_ids: Some("[\"hrv-height\",\"hrv-weight\"]".to_string()),
                },
            ],
        },
    )
    .expect("save health capture");

    assert_eq!(result.event_id, "hre-capture-1");
    assert_eq!(result.persisted_value_count, 3);

    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM health_record_values WHERE eventId = ?1",
            params!["hre-capture-1"],
            |row| row.get(0),
        )
        .expect("count saved values");
    assert_eq!(count, 3);
}

#[test]
fn save_health_record_capture_rejects_invalid_payload_without_partial_event() {
    let mut conn = Connection::open_in_memory().expect("open in-memory db");
    conn.execute_batch("PRAGMA foreign_keys=ON;")
        .expect("enable fk");
    run_migrations(&conn).expect("run migrations");
    seed_family_and_child(&conn);

    let result = crate::sqlite::queries::save_health_record_capture_with_conn(
        &mut conn,
        crate::sqlite::queries::SaveHealthRecordCaptureInput {
            event_id: "hre-invalid".to_string(),
            child_id: "child-1".to_string(),
            protocol_id: "growth-child-quarterly".to_string(),
            group_id: "growth".to_string(),
            record_kind: "manual".to_string(),
            source_surface: "profile_detail".to_string(),
            recorded_at: "2026-05-02T10:00:00.000Z".to_string(),
            effective_date: "2026-05-02".to_string(),
            age_months: 27,
            recorder_id: None,
            linked_reminder_state_id: None,
            linked_reminder_rule_id: None,
            notes: None,
            metadata_json: None,
            now: "2026-05-02T10:00:00.000Z".to_string(),
            values: vec![crate::sqlite::queries::HealthRecordCaptureValueInput {
                value_id: "hrv-invalid-derived".to_string(),
                metric_id: "growth.bmi".to_string(),
                value_number: Some(15.3),
                value_text: None,
                value_json: None,
                unit: Some("kg/m2".to_string()),
                qualifier: None,
                record_kind: "derived".to_string(),
                source_value_ids: None,
            }],
        },
    );

    assert!(result.is_err());
    let event_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM health_record_events WHERE eventId = ?1",
            params!["hre-invalid"],
            |row| row.get(0),
        )
        .expect("count invalid event");
    assert_eq!(event_count, 0);
}

#[test]
fn save_health_record_capture_rejects_unadmitted_registry_bypass_without_partial_event() {
    let mut conn = Connection::open_in_memory().expect("open in-memory db");
    conn.execute_batch("PRAGMA foreign_keys=ON;")
        .expect("enable fk");
    run_migrations(&conn).expect("run migrations");
    seed_family_and_child(&conn);

    let cases = [
        (
            health_record_capture_input(
                "hre-unknown-metric",
                "growth-child-quarterly",
                "growth",
                "unknown.metric",
                Some(1.0),
                None,
                None,
            ),
            "unknown health metric id",
        ),
        (
            health_record_capture_input(
                "hre-metric-protocol-mismatch",
                "growth-child-quarterly",
                "growth",
                "vision.left_visual_acuity",
                Some(1.0),
                None,
                None,
            ),
            "health metric",
        ),
        (
            health_record_capture_input(
                "hre-retained-protocol",
                "vaccine-administration",
                "vaccine",
                "vaccine.administration",
                None,
                None,
                Some("{\"ruleId\":\"PO-REM-VAX-001\"}".to_string()),
            ),
            "cannot be saved as health_record_event",
        ),
    ];

    for (input, expected_error) in cases {
        let event_id = input.event_id.clone();
        let result = crate::sqlite::queries::save_health_record_capture_with_conn(&mut conn, input);
        let error = result.expect_err("registry bypass must fail closed");
        assert!(
            error.contains(expected_error),
            "expected {error:?} to contain {expected_error:?}",
        );
        let event_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM health_record_events WHERE eventId = ?1",
                params![event_id],
                |row| row.get(0),
            )
            .expect("count rejected event");
        assert_eq!(event_count, 0);
    }
}

fn health_record_capture_input(
    event_id: &str,
    protocol_id: &str,
    group_id: &str,
    metric_id: &str,
    value_number: Option<f64>,
    value_text: Option<String>,
    value_json: Option<String>,
) -> crate::sqlite::queries::SaveHealthRecordCaptureInput {
    crate::sqlite::queries::SaveHealthRecordCaptureInput {
        event_id: event_id.to_string(),
        child_id: "child-1".to_string(),
        protocol_id: protocol_id.to_string(),
        group_id: group_id.to_string(),
        record_kind: "manual".to_string(),
        source_surface: "profile_detail".to_string(),
        recorded_at: "2026-05-02T10:00:00.000Z".to_string(),
        effective_date: "2026-05-02".to_string(),
        age_months: 27,
        recorder_id: None,
        linked_reminder_state_id: None,
        linked_reminder_rule_id: None,
        notes: None,
        metadata_json: None,
        now: "2026-05-02T10:00:00.000Z".to_string(),
        values: vec![crate::sqlite::queries::HealthRecordCaptureValueInput {
            value_id: format!("{event_id}:value"),
            metric_id: metric_id.to_string(),
            value_number,
            value_text,
            value_json,
            unit: None,
            qualifier: None,
            record_kind: "measured".to_string(),
            source_value_ids: None,
        }],
    }
}
