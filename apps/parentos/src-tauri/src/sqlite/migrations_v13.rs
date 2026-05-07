use rusqlite::Connection;

/// Schema v13: introduce the canonical PO-HREC health record event/value
/// storage pair admitted by `local-storage.yaml`.
///
/// `health_record_events` is the event envelope. `health_record_values` stores
/// metric values attached to an event and keeps `childId` denormalized for
/// efficient child-scoped projection queries.
///
/// Idempotency: all DDL uses `CREATE ... IF NOT EXISTS`, so repair replays are
/// safe for pre-release databases stamped at a later schema version.
pub(super) fn apply_v13(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(HEALTH_RECORD_STORAGE_SQL)
        .map_err(|e| format!("migration v13 create health record storage failed: {e}"))?;
    backfill_precutover_growth_measurements(conn)?;
    backfill_precutover_folded_detail_records(conn)?;
    Ok(())
}

fn backfill_precutover_growth_measurements(conn: &Connection) -> Result<(), String> {
    if !table_exists(conn, "growth_measurements")? {
        return Ok(());
    }
    conn.execute_batch(PRECUTOVER_GROWTH_MEASUREMENT_BACKFILL_SQL)
        .map_err(|e| {
            format!("migration v13 backfill precutover growth measurements failed: {e}")
        })?;
    Ok(())
}

fn backfill_precutover_folded_detail_records(conn: &Connection) -> Result<(), String> {
    for table_name in [
        "sleep_records",
        "tanner_assessments",
        "fitness_assessments",
        "outdoor_records",
        "dental_records",
        "medical_events",
        "attachments",
    ] {
        if !table_exists(conn, table_name)? {
            return Ok(());
        }
    }
    conn.execute_batch(PRECUTOVER_FOLDED_DETAIL_BACKFILL_SQL)
        .map_err(|e| {
            format!("migration v13 backfill precutover folded detail records failed: {e}")
        })?;
    Ok(())
}

fn table_exists(conn: &Connection, table_name: &str) -> Result<bool, String> {
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
            [table_name],
            |row| row.get(0),
        )
        .map_err(|e| format!("migration v13 check table {table_name} existence failed: {e}"))?;
    Ok(count > 0)
}

const HEALTH_RECORD_STORAGE_SQL: &str = "
    CREATE TABLE IF NOT EXISTS health_record_events (
        eventId               TEXT PRIMARY KEY,
        childId               TEXT NOT NULL REFERENCES children(childId) ON DELETE CASCADE,
        protocolId            TEXT NOT NULL,
        groupId               TEXT NOT NULL,
        recordKind            TEXT NOT NULL CHECK (recordKind IN ('manual', 'imported', 'ocr_confirmed', 'reminder_linked', 'derived')),
        sourceSurface         TEXT NOT NULL CHECK (sourceSurface IN ('profile_console', 'profile_detail', 'reminder', 'ocr_tool', 'import')),
        recordedAt            TEXT NOT NULL,
        effectiveDate         TEXT NOT NULL,
        ageMonths             INTEGER NOT NULL,
        recorderId            TEXT,
        linkedReminderStateId TEXT REFERENCES reminder_states(stateId) ON DELETE SET NULL,
        linkedReminderRuleId  TEXT,
        notes                 TEXT,
        metadataJson          TEXT,
        createdAt             TEXT NOT NULL,
        updatedAt             TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_health_record_events_child_effective_date
        ON health_record_events(childId, effectiveDate);
    CREATE INDEX IF NOT EXISTS idx_health_record_events_child_group_effective_date
        ON health_record_events(childId, groupId, effectiveDate);
    CREATE INDEX IF NOT EXISTS idx_health_record_events_child_linked_reminder_state
        ON health_record_events(childId, linkedReminderStateId);
    CREATE INDEX IF NOT EXISTS idx_health_record_events_protocol
        ON health_record_events(protocolId);

    CREATE TABLE IF NOT EXISTS health_record_values (
        valueId        TEXT PRIMARY KEY,
        eventId        TEXT NOT NULL REFERENCES health_record_events(eventId) ON DELETE CASCADE,
        childId        TEXT NOT NULL REFERENCES children(childId) ON DELETE CASCADE,
        metricId       TEXT NOT NULL,
        valueNumber    REAL,
        valueText      TEXT,
        valueJson      TEXT,
        unit           TEXT,
        qualifier      TEXT,
        recordKind     TEXT NOT NULL CHECK (recordKind IN ('measured', 'derived', 'parent_confirmed_import')),
        sourceValueIds TEXT,
        createdAt      TEXT NOT NULL,
        CHECK (valueNumber IS NOT NULL OR valueText IS NOT NULL OR valueJson IS NOT NULL)
    );

    CREATE INDEX IF NOT EXISTS idx_health_record_values_event
        ON health_record_values(eventId);
    CREATE INDEX IF NOT EXISTS idx_health_record_values_child_metric
        ON health_record_values(childId, metricId);
    CREATE INDEX IF NOT EXISTS idx_health_record_values_child_metric_created_at
        ON health_record_values(childId, metricId, createdAt);
";

const PRECUTOVER_GROWTH_MEASUREMENT_BACKFILL_SQL: &str = "
    INSERT OR IGNORE INTO health_record_events (
        eventId, childId, protocolId, groupId, recordKind, sourceSurface,
        recordedAt, effectiveDate, ageMonths, notes, metadataJson, createdAt, updatedAt
    )
    SELECT
        'precutover-growth-measurement:' || measurementId,
        childId,
        CASE
            WHEN typeId IN ('height', 'weight') THEN 'growth-child-quarterly'
            WHEN typeId = 'head-circumference' THEN 'growth-infant-monthly'
            WHEN typeId IN ('vision-left', 'vision-right') THEN 'vision-basic'
            WHEN typeId IN ('axial-length-left', 'axial-length-right', 'iop-left', 'iop-right') THEN 'vision-full-exam'
            ELSE 'precutover-unsupported'
        END,
        CASE
            WHEN typeId IN ('height', 'weight', 'head-circumference') THEN 'growth'
            ELSE 'vision'
        END,
        CASE
            WHEN source = 'ocr' THEN 'ocr_confirmed'
            WHEN source = 'imported' THEN 'imported'
            ELSE 'manual'
        END,
        CASE
            WHEN source = 'ocr' THEN 'ocr_tool'
            WHEN source = 'imported' THEN 'import'
            ELSE 'profile_detail'
        END,
        measuredAt,
        substr(measuredAt, 1, 10),
        ageMonths,
        notes,
        json_object('precutoverTable', 'growth_measurements', 'precutoverMeasurementId', measurementId, 'precutoverTypeId', typeId),
        createdAt,
        createdAt
    FROM growth_measurements
    WHERE typeId IN (
        'height',
        'weight',
        'head-circumference',
        'vision-left',
        'vision-right',
        'axial-length-left',
        'axial-length-right',
        'iop-left',
        'iop-right'
    );

    INSERT OR IGNORE INTO health_record_values (
        valueId, eventId, childId, metricId, valueNumber, unit, qualifier, recordKind, createdAt
    )
    SELECT
        'precutover-growth-value:' || measurementId,
        'precutover-growth-measurement:' || measurementId,
        childId,
        CASE typeId
            WHEN 'height' THEN 'growth.height'
            WHEN 'weight' THEN 'growth.weight'
            WHEN 'head-circumference' THEN 'growth.head_circumference'
            WHEN 'vision-left' THEN 'vision.left_visual_acuity'
            WHEN 'vision-right' THEN 'vision.right_visual_acuity'
            WHEN 'axial-length-left' THEN 'vision.left_axial_length'
            WHEN 'axial-length-right' THEN 'vision.right_axial_length'
            WHEN 'iop-left' THEN 'vision.left_iop'
            WHEN 'iop-right' THEN 'vision.right_iop'
            ELSE typeId
        END,
        value,
        CASE typeId
            WHEN 'height' THEN 'cm'
            WHEN 'weight' THEN 'kg'
            WHEN 'head-circumference' THEN 'cm'
            WHEN 'vision-left' THEN 'decimal'
            WHEN 'vision-right' THEN 'decimal'
            WHEN 'axial-length-left' THEN 'mm'
            WHEN 'axial-length-right' THEN 'mm'
            WHEN 'iop-left' THEN 'mmHg'
            WHEN 'iop-right' THEN 'mmHg'
            ELSE NULL
        END,
        CASE
            WHEN typeId LIKE '%-left' THEN 'left'
            WHEN typeId LIKE '%-right' THEN 'right'
            ELSE NULL
        END,
        'measured',
        createdAt
    FROM growth_measurements
    WHERE typeId IN (
        'height',
        'weight',
        'head-circumference',
        'vision-left',
        'vision-right',
        'axial-length-left',
        'axial-length-right',
        'iop-left',
        'iop-right'
    );
";

const PRECUTOVER_FOLDED_DETAIL_BACKFILL_SQL: &str = "
    INSERT OR IGNORE INTO health_record_events (
        eventId, childId, protocolId, groupId, recordKind, sourceSurface,
        recordedAt, effectiveDate, ageMonths, notes, metadataJson, createdAt, updatedAt
    )
    SELECT
        'precutover-sleep:' || recordId,
        childId,
        'sleep-night',
        'sleep',
        'manual',
        'profile_detail',
        sleepDate,
        sleepDate,
        ageMonths,
        notes,
        json_object('precutoverTable', 'sleep_records', 'precutoverRecordId', recordId, 'bedtime', bedtime, 'wakeTime', wakeTime, 'napCount', napCount, 'napMinutes', napMinutes, 'quality', quality),
        createdAt,
        createdAt
    FROM sleep_records
    WHERE durationMinutes IS NOT NULL AND durationMinutes > 0;

    INSERT OR IGNORE INTO health_record_values (
        valueId, eventId, childId, metricId, valueNumber, unit, recordKind, createdAt
    )
    SELECT
        'precutover-sleep-value:' || recordId,
        'precutover-sleep:' || recordId,
        childId,
        'sleep.duration_minutes',
        durationMinutes,
        'min',
        'measured',
        createdAt
    FROM sleep_records
    WHERE durationMinutes IS NOT NULL AND durationMinutes > 0;

    INSERT OR IGNORE INTO health_record_events (
        eventId, childId, protocolId, groupId, recordKind, sourceSurface,
        recordedAt, effectiveDate, ageMonths, notes, metadataJson, createdAt, updatedAt
    )
    SELECT
        'precutover-tanner:' || t.assessmentId,
        t.childId,
        CASE WHEN c.gender = 'female' THEN 'tanner-female-self-assessment' ELSE 'tanner-male-self-assessment' END,
        'development',
        'manual',
        'profile_detail',
        t.assessedAt,
        substr(t.assessedAt, 1, 10),
        t.ageMonths,
        t.notes,
        json_object('precutoverTable', 'tanner_assessments', 'precutoverAssessmentId', t.assessmentId, 'assessedBy', t.assessedBy),
        t.createdAt,
        t.createdAt
    FROM tanner_assessments t
    JOIN children c ON c.childId = t.childId
    WHERE t.breastOrGenitalStage IS NOT NULL OR t.pubicHairStage IS NOT NULL;

    INSERT OR IGNORE INTO health_record_values (
        valueId, eventId, childId, metricId, valueNumber, unit, recordKind, createdAt
    )
    SELECT
        'precutover-tanner-value:' || t.assessmentId || ':primary',
        'precutover-tanner:' || t.assessmentId,
        t.childId,
        CASE WHEN c.gender = 'female' THEN 'development.tanner_breast_stage' ELSE 'development.tanner_genital_stage' END,
        t.breastOrGenitalStage,
        'stage',
        'measured',
        t.createdAt
    FROM tanner_assessments t
    JOIN children c ON c.childId = t.childId
    WHERE t.breastOrGenitalStage IS NOT NULL;

    INSERT OR IGNORE INTO health_record_values (
        valueId, eventId, childId, metricId, valueNumber, unit, recordKind, createdAt
    )
    SELECT
        'precutover-tanner-value:' || assessmentId || ':pubic-hair',
        'precutover-tanner:' || assessmentId,
        childId,
        'development.tanner_pubic_hair_stage',
        pubicHairStage,
        'stage',
        'measured',
        createdAt
    FROM tanner_assessments
    WHERE pubicHairStage IS NOT NULL;

    INSERT OR IGNORE INTO health_record_events (
        eventId, childId, protocolId, groupId, recordKind, sourceSurface,
        recordedAt, effectiveDate, ageMonths, notes, metadataJson, createdAt, updatedAt
    )
    SELECT
        'precutover-fitness:' || assessmentId,
        childId,
        'fitness-school-assessment',
        'fitness',
        'manual',
        'profile_detail',
        assessedAt,
        substr(assessedAt, 1, 10),
        ageMonths,
        notes,
        json_object('precutoverTable', 'fitness_assessments', 'precutoverAssessmentId', assessmentId, 'assessmentSource', assessmentSource),
        createdAt,
        createdAt
    FROM fitness_assessments
    WHERE run50m IS NOT NULL OR run800m IS NOT NULL OR run1000m IS NOT NULL OR run50x8 IS NOT NULL
       OR sitAndReach IS NOT NULL OR standingLongJump IS NOT NULL OR sitUps IS NOT NULL OR pullUps IS NOT NULL
       OR ropeSkipping IS NOT NULL OR vitalCapacity IS NOT NULL OR footArchStatus IS NOT NULL;

    INSERT OR IGNORE INTO health_record_values (valueId, eventId, childId, metricId, valueNumber, unit, recordKind, createdAt)
    SELECT 'precutover-fitness-value:' || assessmentId || ':run-50m', 'precutover-fitness:' || assessmentId, childId, 'fitness.run_50m', run50m, 's', 'measured', createdAt FROM fitness_assessments WHERE run50m IS NOT NULL;
    INSERT OR IGNORE INTO health_record_values (valueId, eventId, childId, metricId, valueNumber, unit, recordKind, createdAt)
    SELECT 'precutover-fitness-value:' || assessmentId || ':run-800m', 'precutover-fitness:' || assessmentId, childId, 'fitness.run_800m', run800m, 's', 'measured', createdAt FROM fitness_assessments WHERE run800m IS NOT NULL;
    INSERT OR IGNORE INTO health_record_values (valueId, eventId, childId, metricId, valueNumber, unit, recordKind, createdAt)
    SELECT 'precutover-fitness-value:' || assessmentId || ':run-1000m', 'precutover-fitness:' || assessmentId, childId, 'fitness.run_1000m', run1000m, 's', 'measured', createdAt FROM fitness_assessments WHERE run1000m IS NOT NULL;
    INSERT OR IGNORE INTO health_record_values (valueId, eventId, childId, metricId, valueNumber, unit, recordKind, createdAt)
    SELECT 'precutover-fitness-value:' || assessmentId || ':run-50x8', 'precutover-fitness:' || assessmentId, childId, 'fitness.run_50x8', run50x8, 's', 'measured', createdAt FROM fitness_assessments WHERE run50x8 IS NOT NULL;
    INSERT OR IGNORE INTO health_record_values (valueId, eventId, childId, metricId, valueNumber, unit, recordKind, createdAt)
    SELECT 'precutover-fitness-value:' || assessmentId || ':sit-and-reach', 'precutover-fitness:' || assessmentId, childId, 'fitness.sit_and_reach', sitAndReach, 'cm', 'measured', createdAt FROM fitness_assessments WHERE sitAndReach IS NOT NULL;
    INSERT OR IGNORE INTO health_record_values (valueId, eventId, childId, metricId, valueNumber, unit, recordKind, createdAt)
    SELECT 'precutover-fitness-value:' || assessmentId || ':standing-long-jump', 'precutover-fitness:' || assessmentId, childId, 'fitness.standing_long_jump', standingLongJump, 'cm', 'measured', createdAt FROM fitness_assessments WHERE standingLongJump IS NOT NULL;
    INSERT OR IGNORE INTO health_record_values (valueId, eventId, childId, metricId, valueNumber, unit, recordKind, createdAt)
    SELECT 'precutover-fitness-value:' || assessmentId || ':sit-ups', 'precutover-fitness:' || assessmentId, childId, 'fitness.sit_ups', sitUps, 'count', 'measured', createdAt FROM fitness_assessments WHERE sitUps IS NOT NULL;
    INSERT OR IGNORE INTO health_record_values (valueId, eventId, childId, metricId, valueNumber, unit, recordKind, createdAt)
    SELECT 'precutover-fitness-value:' || assessmentId || ':pull-ups', 'precutover-fitness:' || assessmentId, childId, 'fitness.pull_ups', pullUps, 'count', 'measured', createdAt FROM fitness_assessments WHERE pullUps IS NOT NULL;
    INSERT OR IGNORE INTO health_record_values (valueId, eventId, childId, metricId, valueNumber, unit, recordKind, createdAt)
    SELECT 'precutover-fitness-value:' || assessmentId || ':rope-skipping', 'precutover-fitness:' || assessmentId, childId, 'fitness.rope_skipping', ropeSkipping, 'count_per_min', 'measured', createdAt FROM fitness_assessments WHERE ropeSkipping IS NOT NULL;
    INSERT OR IGNORE INTO health_record_values (valueId, eventId, childId, metricId, valueNumber, unit, recordKind, createdAt)
    SELECT 'precutover-fitness-value:' || assessmentId || ':vital-capacity', 'precutover-fitness:' || assessmentId, childId, 'fitness.vital_capacity', vitalCapacity, 'ml', 'measured', createdAt FROM fitness_assessments WHERE vitalCapacity IS NOT NULL;
    INSERT OR IGNORE INTO health_record_values (valueId, eventId, childId, metricId, valueText, recordKind, createdAt)
    SELECT 'precutover-fitness-value:' || assessmentId || ':foot-arch-status', 'precutover-fitness:' || assessmentId, childId, 'fitness.foot_arch_status', footArchStatus, 'measured', createdAt FROM fitness_assessments WHERE footArchStatus IS NOT NULL;

    INSERT OR IGNORE INTO health_record_events (
        eventId, childId, protocolId, groupId, recordKind, sourceSurface,
        recordedAt, effectiveDate, ageMonths, notes, metadataJson, createdAt, updatedAt
    )
    SELECT
        'precutover-outdoor:' || o.recordId,
        o.childId,
        'outdoor-activity',
        'outdoor',
        'manual',
        'profile_detail',
        o.activityDate,
        o.activityDate,
        MAX(0, CAST((CAST(strftime('%Y', o.activityDate) AS INTEGER) - CAST(strftime('%Y', c.birthDate) AS INTEGER)) * 12
          + (CAST(strftime('%m', o.activityDate) AS INTEGER) - CAST(strftime('%m', c.birthDate) AS INTEGER))
          - CASE WHEN CAST(strftime('%d', o.activityDate) AS INTEGER) < CAST(strftime('%d', c.birthDate) AS INTEGER) THEN 1 ELSE 0 END AS INTEGER)),
        o.note,
        json_object('precutoverTable', 'outdoor_records', 'precutoverRecordId', o.recordId),
        o.createdAt,
        o.updatedAt
    FROM outdoor_records o
    JOIN children c ON c.childId = o.childId
    WHERE o.durationMinutes IS NOT NULL AND o.durationMinutes > 0;

    INSERT OR IGNORE INTO health_record_values (
        valueId, eventId, childId, metricId, valueNumber, unit, recordKind, createdAt
    )
    SELECT
        'precutover-outdoor-value:' || recordId,
        'precutover-outdoor:' || recordId,
        childId,
        'outdoor.activity_minutes',
        durationMinutes,
        'min',
        'measured',
        createdAt
    FROM outdoor_records
    WHERE durationMinutes IS NOT NULL AND durationMinutes > 0;

    INSERT OR IGNORE INTO health_record_events (
        eventId, childId, protocolId, groupId, recordKind, sourceSurface,
        recordedAt, effectiveDate, ageMonths, notes, metadataJson, createdAt, updatedAt
    )
    SELECT
        'precutover-dental:' || recordId,
        childId,
        'dental-event',
        'dental',
        'manual',
        'profile_detail',
        eventDate,
        eventDate,
        ageMonths,
        notes,
        json_object('precutoverTable', 'dental_records', 'precutoverRecordId', recordId, 'eventType', eventType),
        createdAt,
        createdAt
    FROM dental_records;

    INSERT OR IGNORE INTO health_record_values (
        valueId, eventId, childId, metricId, valueJson, recordKind, createdAt
    )
    SELECT
        'precutover-dental-value:' || recordId,
        'precutover-dental:' || recordId,
        childId,
        'dental.event',
        json_object(
            'eventType', eventType,
            'toothId', toothId,
            'toothSet', toothSet,
            'severity', severity,
            'hospital', hospital,
            'photoPath', photoPath
        ),
        'measured',
        createdAt
    FROM dental_records;

    INSERT OR IGNORE INTO health_record_events (
        eventId, childId, protocolId, groupId, recordKind, sourceSurface,
        recordedAt, effectiveDate, ageMonths, notes, metadataJson, createdAt, updatedAt
    )
    SELECT
        'precutover-medical:' || eventId,
        childId,
        'medical-event',
        'medical',
        'manual',
        'profile_detail',
        eventDate,
        eventDate,
        ageMonths,
        notes,
        json_object('precutoverTable', 'medical_events', 'precutoverEventId', eventId, 'eventType', eventType),
        createdAt,
        updatedAt
    FROM medical_events;

    INSERT OR IGNORE INTO health_record_values (
        valueId, eventId, childId, metricId, valueJson, recordKind, createdAt
    )
    SELECT
        'precutover-medical-value:' || eventId,
        'precutover-medical:' || eventId,
        childId,
        'medical.event',
        json_object(
            'eventType', eventType,
            'title', title,
            'endDate', endDate,
            'severity', severity,
            'result', result,
            'hospital', hospital,
            'medication', medication,
            'dosage', dosage,
            'photoPath', photoPath
        ),
        'measured',
        createdAt
    FROM medical_events;

    UPDATE attachments
    SET
        ownerTable = 'health_record_events',
        ownerId = CASE
            WHEN EXISTS (
                SELECT 1 FROM health_record_events e
                WHERE e.eventId = 'precutover-growth-measurement:' || attachments.ownerId
            )
            THEN 'precutover-growth-measurement:' || ownerId
            ELSE 'detail-measurement:' || ownerId
        END
    WHERE ownerTable = 'growth_measurements'
      AND (
        EXISTS (
            SELECT 1 FROM health_record_events e
            WHERE e.eventId = 'precutover-growth-measurement:' || attachments.ownerId
        )
        OR EXISTS (
            SELECT 1 FROM health_record_events e
            WHERE e.eventId = 'detail-measurement:' || attachments.ownerId
        )
      );

    UPDATE attachments
    SET ownerTable = 'health_record_events',
        ownerId = 'precutover-dental:' || ownerId
    WHERE ownerTable = 'dental_records'
      AND EXISTS (
        SELECT 1 FROM health_record_events e
        WHERE e.eventId = 'precutover-dental:' || attachments.ownerId
      );

    UPDATE attachments
    SET ownerTable = 'health_record_events',
        ownerId = 'precutover-medical:' || ownerId
    WHERE ownerTable = 'medical_events'
      AND EXISTS (
        SELECT 1 FROM health_record_events e
        WHERE e.eventId = 'precutover-medical:' || attachments.ownerId
      );
";
