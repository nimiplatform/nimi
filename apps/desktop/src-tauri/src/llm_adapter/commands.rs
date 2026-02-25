use keyring::{Entry, Error as KeyringError};
use serde::Deserialize;
use tauri::AppHandle;

use super::store::{
    delete_credential_entry, insert_usage_record, list_credential_entries, open_db,
    query_usage_records, summary_usage_records, upsert_credential_entry, CredentialEntryPayload,
    UsageQueryFilter, UsageRecordPayload, UsageSummaryRecord,
};

const KEYRING_SERVICE: &str = "app.nimi.desktop.llm_adapter";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialSetSecretPayload {
    pub ref_id: String,
    pub secret: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialRefPayload {
    pub ref_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialUpsertPayload {
    pub entry: CredentialEntryPayload,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialListPayload {
    pub provider: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageInsertPayload {
    pub record: UsageRecordPayload,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageQueryPayload {
    pub filter: Option<UsageQueryFilter>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSummaryPayload {
    pub period: String,
    pub filter: Option<UsageQueryFilter>,
}

fn keyring_entry(ref_id: &str) -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, ref_id).map_err(|error| format!("无法创建 keyring entry: {error}"))
}

#[tauri::command]
pub fn credential_upsert_entry(
    app: AppHandle,
    payload: CredentialUpsertPayload,
) -> Result<(), String> {
    let conn = open_db(&app)?;
    upsert_credential_entry(&conn, &payload.entry)
}

#[tauri::command]
pub fn credential_list_entries(
    app: AppHandle,
    payload: Option<CredentialListPayload>,
) -> Result<Vec<CredentialEntryPayload>, String> {
    let conn = open_db(&app)?;
    let provider = payload.and_then(|item| item.provider);
    list_credential_entries(&conn, provider)
}

#[tauri::command]
pub fn credential_delete_entry(
    app: AppHandle,
    payload: CredentialRefPayload,
) -> Result<(), String> {
    let conn = open_db(&app)?;
    delete_credential_entry(&conn, &payload.ref_id)
}

#[tauri::command]
pub fn credential_set_secret(payload: CredentialSetSecretPayload) -> Result<(), String> {
    let entry = keyring_entry(&payload.ref_id)?;
    entry
        .set_password(&payload.secret)
        .map_err(|error| format!("写入 keyring 失败: {error}"))
}

#[tauri::command]
pub fn credential_get_secret(payload: CredentialRefPayload) -> Result<String, String> {
    let entry = keyring_entry(&payload.ref_id)?;
    entry
        .get_password()
        .map_err(|error| format!("读取 keyring 失败: {error}"))
}

#[tauri::command]
pub fn credential_delete_secret(payload: CredentialRefPayload) -> Result<(), String> {
    let entry = keyring_entry(&payload.ref_id)?;
    match entry.delete_credential() {
        Ok(_) => Ok(()),
        Err(KeyringError::NoEntry) => Ok(()),
        Err(error) => Err(format!("删除 keyring 凭证失败: {error}")),
    }
}

#[tauri::command]
pub fn usage_insert_record(app: AppHandle, payload: UsageInsertPayload) -> Result<(), String> {
    let conn = open_db(&app)?;
    insert_usage_record(&conn, &payload.record)
}

#[tauri::command]
pub fn usage_query_records(
    app: AppHandle,
    payload: Option<UsageQueryPayload>,
) -> Result<Vec<UsageRecordPayload>, String> {
    let conn = open_db(&app)?;
    let filter = payload.and_then(|item| item.filter);
    query_usage_records(&conn, filter)
}

#[tauri::command]
pub fn usage_summary_records(
    app: AppHandle,
    payload: UsageSummaryPayload,
) -> Result<Vec<UsageSummaryRecord>, String> {
    let conn = open_db(&app)?;
    let period = payload.period;
    if period != "hour" && period != "day" && period != "week" {
        return Err(format!("不支持的 summary period: {}", period));
    }
    summary_usage_records(&conn, period, payload.filter)
}
