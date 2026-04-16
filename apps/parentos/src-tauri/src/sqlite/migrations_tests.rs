use super::{run_migrations, V1_SCHEMA_SQL};
use rusqlite::{params, Connection};

mod migration_repairs;
mod round_trip;

fn seed_family_and_child(conn: &Connection) {
    conn.execute(
        "INSERT INTO families (familyId, displayName, createdAt, updatedAt) VALUES (?1, ?2, ?3, ?3)",
        params!["family-1", "Test Family", "2026-01-01T00:00:00.000Z"],
    )
    .expect("insert family");

    conn.execute(
        "INSERT INTO children (childId, familyId, displayName, gender, birthDate, nurtureMode, createdAt, updatedAt) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
        params![
            "child-1",
            "family-1",
            "Mimi",
            "female",
            "2024-01-15",
            "balanced",
            "2026-01-01T00:00:00.000Z"
        ],
    )
    .expect("insert child");
}
