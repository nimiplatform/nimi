use rusqlite::Connection;

/// Schema v16: enforce PO-ORTHO-002b "single non-completed case per child"
/// invariant by deduplicating existing data.
///
/// Per child, when more than one orthodontic_case has `stage <> 'completed'`:
///
///   1. Pick a winner = the case with the most-advanced stage
///      (active=4 > retention=3 > planning=2 > assessment=1 > unknown-legacy=0),
///      ties broken by latest `startedAt`, then latest `createdAt`.
///   2. For every loser:
///        - If it has NO attached `orthodontic_appliances` rows → DELETE the
///          loser (cascade clears any orphan checkins / unwear intervals,
///          which there shouldn't be).
///        - Otherwise → UPDATE stage='completed', actualEndAt=COALESCE(
///          actualEndAt, date('now')) so attached treatment data is preserved
///          but the case no longer counts as "ongoing".
///
/// This is admissible only because the project is pre-launch and there are no
/// production rows that depend on a particular non-winner being live; it is
/// the single migration permitted to set a case to `completed` without a
/// parent action (see orthodontic-contract.md#PO-ORTHO-002b).
///
/// Idempotency: replays on already-deduplicated data are no-ops because the
/// per-child non-completed group will have at most one row. Writes are
/// guarded by the cascade rule + COALESCE so re-running does not flip
/// `actualEndAt` for cases that already have one set.
pub(super) fn apply_v16(conn: &Connection) -> Result<(), String> {
    if !cases_table_exists(conn)? {
        return Ok(());
    }
    let groups = collect_duplicate_groups(conn)?;
    for group in groups {
        let winner = group
            .iter()
            .max_by(|a, b| {
                stage_rank(a.stage.as_str())
                    .cmp(&stage_rank(b.stage.as_str()))
                    .then(a.started_at.cmp(&b.started_at))
                    .then(a.created_at.cmp(&b.created_at))
            })
            .expect("group is non-empty by construction");
        for case in &group {
            if case.case_id == winner.case_id {
                continue;
            }
            if case_has_appliances(conn, case.case_id.as_str())? {
                conn.execute(
                    "UPDATE orthodontic_cases
                     SET stage = 'completed',
                         actualEndAt = COALESCE(actualEndAt, date('now')),
                         updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                     WHERE caseId = ?1",
                    [case.case_id.as_str()],
                )
                .map_err(|e| {
                    format!(
                        "migration v16 archive duplicate case \"{}\" failed: {e}",
                        case.case_id
                    )
                })?;
            } else {
                conn.execute(
                    "DELETE FROM orthodontic_cases WHERE caseId = ?1",
                    [case.case_id.as_str()],
                )
                .map_err(|e| {
                    format!(
                        "migration v16 delete empty duplicate case \"{}\" failed: {e}",
                        case.case_id
                    )
                })?;
            }
        }
    }
    Ok(())
}

#[derive(Debug)]
struct CaseRow {
    case_id: String,
    child_id: String,
    stage: String,
    started_at: String,
    created_at: String,
}

fn cases_table_exists(conn: &Connection) -> Result<bool, String> {
    conn.query_row(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='orthodontic_cases'",
        [],
        |_| Ok(true),
    )
    .or_else(|err| match err {
        rusqlite::Error::QueryReturnedNoRows => Ok(false),
        _ => Err(format!(
            "migration v16 check orthodontic_cases exists failed: {err}"
        )),
    })
}

/// Returns groups of non-completed cases keyed by childId, but only for
/// children with >1 such case (singleton children are already compliant).
fn collect_duplicate_groups(conn: &Connection) -> Result<Vec<Vec<CaseRow>>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT caseId, childId, stage, startedAt, createdAt
             FROM orthodontic_cases
             WHERE stage <> 'completed'
             ORDER BY childId ASC, startedAt ASC, createdAt ASC",
        )
        .map_err(|e| format!("migration v16 prepare select failed: {e}"))?;
    let rows = stmt
        .query_map([], |row| {
            Ok(CaseRow {
                case_id: row.get(0)?,
                child_id: row.get(1)?,
                stage: row.get(2)?,
                started_at: row.get(3)?,
                created_at: row.get(4)?,
            })
        })
        .map_err(|e| format!("migration v16 query select failed: {e}"))?;
    let mut by_child: std::collections::BTreeMap<String, Vec<CaseRow>> =
        std::collections::BTreeMap::new();
    for row in rows {
        let row = row.map_err(|e| format!("migration v16 read case row failed: {e}"))?;
        by_child.entry(row.child_id.clone()).or_default().push(row);
    }
    Ok(by_child
        .into_values()
        .filter(|group| group.len() > 1)
        .collect())
}

fn case_has_appliances(conn: &Connection, case_id: &str) -> Result<bool, String> {
    let exists: i64 = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM orthodontic_appliances WHERE caseId = ?1)",
            [case_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("migration v16 check case_has_appliances failed: {e}"))?;
    Ok(exists == 1)
}

fn stage_rank(stage: &str) -> i64 {
    match stage {
        "active" => 4,
        "retention" => 3,
        "planning" => 2,
        "assessment" => 1,
        // unknown-legacy and any other unexpected value sort lowest.
        _ => 0,
    }
}
