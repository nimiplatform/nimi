use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;
use tauri::Manager;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialEntryPayload {
    pub ref_id: String,
    pub provider: String,
    pub profile_id: String,
    pub label: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageRecordPayload {
    pub id: String,
    pub timestamp: String,
    pub caller: String,
    pub model_id: String,
    pub provider_type: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_read_tokens: Option<i64>,
    pub cache_write_tokens: Option<i64>,
    pub total_tokens: i64,
    pub ttft_ms: Option<f64>,
    pub latency_ms: f64,
    pub success: bool,
    pub error_code: Option<String>,
    pub recovery_action: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageQueryFilter {
    pub since: Option<String>,
    pub until: Option<String>,
    pub caller: Option<String>,
    pub model_id: Option<String>,
    pub provider_type: Option<String>,
    pub success: Option<bool>,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSummaryRecord {
    pub bucket: String,
    pub model_id: String,
    pub provider_type: String,
    pub request_count: usize,
    pub success_count: usize,
    pub error_count: usize,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub total_tokens: i64,
    pub avg_ttft_ms: Option<f64>,
    pub avg_latency_ms: f64,
}

pub fn db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let base_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法获取 app_data_dir: {error}"))?;

    fs::create_dir_all(&base_dir).map_err(|error| format!("无法创建 app_data_dir: {error}"))?;
    Ok(base_dir.join("llm-adapter.db"))
}

pub fn open_db(app: &AppHandle) -> Result<Connection, String> {
    let path = db_path(app)?;
    let conn = Connection::open(path).map_err(|error| format!("无法打开 SQLite: {error}"))?;
    init_schema(&conn)?;
    Ok(conn)
}

fn init_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS credential_entries (
          ref_id TEXT PRIMARY KEY,
          provider TEXT NOT NULL,
          profile_id TEXT NOT NULL,
          label TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS usage_records (
          id TEXT PRIMARY KEY,
          timestamp TEXT NOT NULL,
          caller TEXT NOT NULL,
          model_id TEXT NOT NULL,
          provider_type TEXT NOT NULL,
          input_tokens INTEGER NOT NULL,
          output_tokens INTEGER NOT NULL,
          cache_read_tokens INTEGER,
          cache_write_tokens INTEGER,
          total_tokens INTEGER NOT NULL,
          ttft_ms REAL,
          latency_ms REAL NOT NULL,
          success INTEGER NOT NULL,
          error_code TEXT,
          recovery_action TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_usage_records_timestamp ON usage_records(timestamp);
        CREATE INDEX IF NOT EXISTS idx_usage_records_model_id ON usage_records(model_id);
        CREATE INDEX IF NOT EXISTS idx_usage_records_provider_type ON usage_records(provider_type);
        CREATE INDEX IF NOT EXISTS idx_usage_records_caller ON usage_records(caller);
        "#,
    )
    .map_err(|error| format!("初始化 SQLite schema 失败: {error}"))?;

    Ok(())
}

pub fn upsert_credential_entry(
    conn: &Connection,
    entry: &CredentialEntryPayload,
) -> Result<(), String> {
    conn.execute(
        r#"
        INSERT INTO credential_entries (ref_id, provider, profile_id, label, created_at)
        VALUES (?1, ?2, ?3, ?4, ?5)
        ON CONFLICT(ref_id) DO UPDATE SET
          provider = excluded.provider,
          profile_id = excluded.profile_id,
          label = excluded.label,
          created_at = excluded.created_at
        "#,
        params![
            entry.ref_id,
            entry.provider,
            entry.profile_id,
            entry.label,
            entry.created_at
        ],
    )
    .map_err(|error| format!("保存 credential entry 失败: {error}"))?;

    Ok(())
}

pub fn list_credential_entries(
    conn: &Connection,
    provider: Option<String>,
) -> Result<Vec<CredentialEntryPayload>, String> {
    let rows = if let Some(provider_value) = provider {
        let mut statement = conn
            .prepare(
                r#"
                SELECT ref_id, provider, profile_id, label, created_at
                FROM credential_entries
                WHERE provider = ?1
                ORDER BY created_at DESC
                "#,
            )
            .map_err(|error| format!("查询 credential entries 失败: {error}"))?;

        let mapped = statement
            .query_map(params![provider_value], |row| {
                Ok(CredentialEntryPayload {
                    ref_id: row.get(0)?,
                    provider: row.get(1)?,
                    profile_id: row.get(2)?,
                    label: row.get(3)?,
                    created_at: row.get(4)?,
                })
            })
            .map_err(|error| format!("解析 credential entries 失败: {error}"))?;

        mapped
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("收集 credential entries 失败: {error}"))?
    } else {
        let mut statement = conn
            .prepare(
                r#"
                SELECT ref_id, provider, profile_id, label, created_at
                FROM credential_entries
                ORDER BY created_at DESC
                "#,
            )
            .map_err(|error| format!("查询 credential entries 失败: {error}"))?;

        let mapped = statement
            .query_map([], |row| {
                Ok(CredentialEntryPayload {
                    ref_id: row.get(0)?,
                    provider: row.get(1)?,
                    profile_id: row.get(2)?,
                    label: row.get(3)?,
                    created_at: row.get(4)?,
                })
            })
            .map_err(|error| format!("解析 credential entries 失败: {error}"))?;

        mapped
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("收集 credential entries 失败: {error}"))?
    };

    Ok(rows)
}

pub fn delete_credential_entry(conn: &Connection, ref_id: &str) -> Result<(), String> {
    conn.execute(
        "DELETE FROM credential_entries WHERE ref_id = ?1",
        params![ref_id.to_string()],
    )
    .map_err(|error| format!("删除 credential entry 失败: {error}"))?;

    Ok(())
}

pub fn insert_usage_record(conn: &Connection, record: &UsageRecordPayload) -> Result<(), String> {
    conn.execute(
        r#"
        INSERT INTO usage_records (
          id, timestamp, caller, model_id, provider_type,
          input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, total_tokens,
          ttft_ms, latency_ms, success, error_code, recovery_action
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
        ON CONFLICT(id) DO UPDATE SET
          timestamp = excluded.timestamp,
          caller = excluded.caller,
          model_id = excluded.model_id,
          provider_type = excluded.provider_type,
          input_tokens = excluded.input_tokens,
          output_tokens = excluded.output_tokens,
          cache_read_tokens = excluded.cache_read_tokens,
          cache_write_tokens = excluded.cache_write_tokens,
          total_tokens = excluded.total_tokens,
          ttft_ms = excluded.ttft_ms,
          latency_ms = excluded.latency_ms,
          success = excluded.success,
          error_code = excluded.error_code,
          recovery_action = excluded.recovery_action
        "#,
        params![
            record.id,
            record.timestamp,
            record.caller,
            record.model_id,
            record.provider_type,
            record.input_tokens,
            record.output_tokens,
            record.cache_read_tokens,
            record.cache_write_tokens,
            record.total_tokens,
            record.ttft_ms,
            record.latency_ms,
            if record.success { 1 } else { 0 },
            record.error_code,
            record.recovery_action
        ],
    )
    .map_err(|error| format!("写入 usage record 失败: {error}"))?;

    Ok(())
}

fn load_usage_records(conn: &Connection) -> Result<Vec<UsageRecordPayload>, String> {
    let mut statement = conn
        .prepare(
            r#"
            SELECT
              id, timestamp, caller, model_id, provider_type,
              input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, total_tokens,
              ttft_ms, latency_ms, success, error_code, recovery_action
            FROM usage_records
            ORDER BY timestamp DESC
            "#,
        )
        .map_err(|error| format!("查询 usage records 失败: {error}"))?;

    let mapped = statement
        .query_map([], |row| {
            Ok(UsageRecordPayload {
                id: row.get(0)?,
                timestamp: row.get(1)?,
                caller: row.get(2)?,
                model_id: row.get(3)?,
                provider_type: row.get(4)?,
                input_tokens: row.get(5)?,
                output_tokens: row.get(6)?,
                cache_read_tokens: row.get(7)?,
                cache_write_tokens: row.get(8)?,
                total_tokens: row.get(9)?,
                ttft_ms: row.get(10)?,
                latency_ms: row.get(11)?,
                success: row.get::<_, i64>(12)? != 0,
                error_code: row.get(13)?,
                recovery_action: row.get(14)?,
            })
        })
        .map_err(|error| format!("解析 usage records 失败: {error}"))?;

    mapped
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("收集 usage records 失败: {error}"))
}

pub fn query_usage_records(
    conn: &Connection,
    filter: Option<UsageQueryFilter>,
) -> Result<Vec<UsageRecordPayload>, String> {
    let mut rows = load_usage_records(conn)?;
    if let Some(spec) = filter {
        rows.retain(|row| {
            if let Some(ref since) = spec.since {
                if row.timestamp < *since {
                    return false;
                }
            }
            if let Some(ref until) = spec.until {
                if row.timestamp > *until {
                    return false;
                }
            }
            if let Some(ref caller) = spec.caller {
                if row.caller != *caller {
                    return false;
                }
            }
            if let Some(ref model_id) = spec.model_id {
                if row.model_id != *model_id {
                    return false;
                }
            }
            if let Some(ref provider_type) = spec.provider_type {
                if row.provider_type != *provider_type {
                    return false;
                }
            }
            if let Some(success) = spec.success {
                if row.success != success {
                    return false;
                }
            }

            true
        });

        if let Some(limit) = spec.limit {
            if rows.len() > limit {
                rows.truncate(limit);
            }
        }
    }

    Ok(rows)
}

fn bucket_for_period(timestamp: &str, period: &str) -> String {
    if period == "week" {
        // ISO-like week bucket (YYYY-Www)
        if timestamp.len() >= 10 {
            return format!("{}-W{}", &timestamp[0..4], &timestamp[5..7]);
        }
        return timestamp.to_string();
    }

    if period == "hour" {
        if timestamp.len() >= 13 {
            return format!("{}:00:00.000Z", &timestamp[0..13]);
        }
        return timestamp.to_string();
    }

    if timestamp.len() >= 10 {
        return format!("{}T00:00:00.000Z", &timestamp[0..10]);
    }

    timestamp.to_string()
}

pub fn summary_usage_records(
    conn: &Connection,
    period: String,
    filter: Option<UsageQueryFilter>,
) -> Result<Vec<UsageSummaryRecord>, String> {
    let rows = query_usage_records(conn, filter)?;
    let mut grouped: HashMap<String, UsageSummaryRecord> = HashMap::new();
    let mut grouped_ttft: HashMap<String, (f64, usize)> = HashMap::new();

    for row in rows.iter() {
        let bucket = bucket_for_period(&row.timestamp, &period);
        let key = format!("{}|{}|{}", bucket, row.model_id, row.provider_type);

        let entry = grouped.entry(key.clone()).or_insert(UsageSummaryRecord {
            bucket: bucket.clone(),
            model_id: row.model_id.clone(),
            provider_type: row.provider_type.clone(),
            request_count: 0,
            success_count: 0,
            error_count: 0,
            input_tokens: 0,
            output_tokens: 0,
            total_tokens: 0,
            avg_ttft_ms: None,
            avg_latency_ms: 0.0,
        });

        entry.request_count += 1;
        if row.success {
            entry.success_count += 1;
        } else {
            entry.error_count += 1;
        }
        entry.input_tokens += row.input_tokens;
        entry.output_tokens += row.output_tokens;
        entry.total_tokens += row.total_tokens;
        entry.avg_latency_ms += row.latency_ms;

        if let Some(ttft) = row.ttft_ms {
            let ttft_entry = grouped_ttft.entry(key).or_insert((0.0, 0));
            ttft_entry.0 += ttft;
            ttft_entry.1 += 1;
        }
    }

    let mut summaries: Vec<UsageSummaryRecord> = grouped
        .into_iter()
        .map(|(key, mut value)| {
            if value.request_count > 0 {
                value.avg_latency_ms =
                    (value.avg_latency_ms / value.request_count as f64 * 100.0).round() / 100.0;
            }
            if let Some((total, count)) = grouped_ttft.get(&key) {
                if *count > 0 {
                    value.avg_ttft_ms = Some((total / *count as f64 * 100.0).round() / 100.0);
                }
            }
            value
        })
        .collect();

    summaries.sort_by(|a, b| b.bucket.cmp(&a.bucket));
    Ok(summaries)
}
