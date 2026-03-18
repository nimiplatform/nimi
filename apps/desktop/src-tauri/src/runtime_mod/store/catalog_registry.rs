use base64::Engine as _;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use ed25519_dalek::pkcs8::DecodePublicKey;
use reqwest::blocking::Client as BlockingHttpClient;
use serde::de::DeserializeOwned;
use std::collections::HashSet;
use std::fs::File as StdFile;
use std::io::{Read, Write};

const CURRENT_DESKTOP_VERSION: &str = env!("CARGO_PKG_VERSION");
const CURRENT_HOOK_API_VERSION: &str = "v1";
const MOD_CATALOG_BASE_URL_ENV: &str = "NIMI_MOD_CATALOG_BASE_URL";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReleaseSignaturePayload<'a> {
    package_type: &'a str,
    package_id: &'a str,
    version: &'a str,
    channel: &'a str,
    artifact_url: &'a str,
    sha256: &'a str,
    signer_id: &'a str,
    min_desktop_version: &'a str,
    min_hook_api_version: &'a str,
    capabilities: &'a Vec<String>,
    requires_reconsent_on_capability_increase: bool,
    publisher: &'a CatalogPublisherPayload,
    source: &'a CatalogReleaseSourcePayload,
    state: &'a CatalogStatePayload,
    #[serde(skip_serializing_if = "Option::is_none")]
    app_mode: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    scope_catalog_version: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    min_runtime_version: Option<&'a str>,
}

fn resolve_catalog_base_url() -> Option<String> {
    let value = std::env::var(MOD_CATALOG_BASE_URL_ENV).ok()?;
    let normalized = value.trim();
    if normalized.is_empty() {
        return None;
    }
    Some(normalized.trim_end_matches('/').to_string())
}

fn build_catalog_url(base_url: &str, path: &str) -> String {
    let normalized_path = path.trim();
    if normalized_path.starts_with("http://") || normalized_path.starts_with("https://") {
        return normalized_path.to_string();
    }
    format!(
        "{}/{}",
        base_url.trim_end_matches('/'),
        normalized_path.trim_start_matches('/')
    )
}

fn normalize_catalog_asset_url(base_url: &str, value: Option<String>) -> Option<String> {
    let normalized = value?.trim().to_string();
    if normalized.is_empty() {
        return None;
    }
    Some(build_catalog_url(base_url, &normalized))
}

fn normalize_catalog_package_summary(
    base_url: &str,
    mut summary: CatalogPackageSummaryPayload,
) -> CatalogPackageSummaryPayload {
    summary.icon_url = normalize_catalog_asset_url(base_url, summary.icon_url);
    summary
}

fn normalize_catalog_package_record(
    base_url: &str,
    mut package: CatalogPackageRecordPayload,
) -> CatalogPackageRecordPayload {
    package.icon_url = normalize_catalog_asset_url(base_url, package.icon_url);
    package
}

fn fetch_catalog_json_optional<T: DeserializeOwned>(base_url: &str, path: &str) -> Result<Option<T>, String> {
    let client = BlockingHttpClient::new();
    let response = client
        .get(build_catalog_url(base_url, path))
        .send()
        .map_err(|error| format!("请求 mod catalog 失败: {error}"))?;
    if response.status().as_u16() == 404 {
        return Ok(None);
    }
    let response = response
        .error_for_status()
        .map_err(|error| format!("请求 mod catalog 失败: {error}"))?;
    let body = response
        .text()
        .map_err(|error| format!("读取 mod catalog 响应失败: {error}"))?;
    serde_json::from_str::<T>(&body)
        .map(Some)
        .map_err(|error| format!("解析 mod catalog JSON 失败: {error}"))
}

fn fetch_catalog_json<T: DeserializeOwned>(base_url: &str, path: &str) -> Result<T, String> {
    fetch_catalog_json_optional(base_url, path)?.ok_or_else(|| format!("mod catalog 资源不存在: {path}"))
}

fn normalize_release_manifest_payload(record: &CatalogReleaseRecordPayload) -> ReleaseSignaturePayload<'_> {
    ReleaseSignaturePayload {
        package_type: &record.package_type,
        package_id: &record.package_id,
        version: &record.version,
        channel: &record.channel,
        artifact_url: &record.artifact_url,
        sha256: &record.sha256,
        signer_id: &record.signer_id,
        min_desktop_version: &record.min_desktop_version,
        min_hook_api_version: &record.min_hook_api_version,
        capabilities: &record.capabilities,
        requires_reconsent_on_capability_increase: record.requires_reconsent_on_capability_increase,
        publisher: &record.publisher,
        source: &record.source,
        state: &record.state,
        app_mode: record.app_mode.as_deref(),
        scope_catalog_version: record.scope_catalog_version.as_deref(),
        min_runtime_version: record.min_runtime_version.as_deref(),
    }
}

fn version_segments(value: &str) -> Vec<u64> {
    value
        .trim()
        .trim_start_matches('v')
        .split('.')
        .map(|item| item.parse::<u64>().unwrap_or(0))
        .collect()
}

fn compare_semver_like(left: &str, right: &str) -> std::cmp::Ordering {
    let left_segments = version_segments(left);
    let right_segments = version_segments(right);
    let max_len = left_segments.len().max(right_segments.len());
    for index in 0..max_len {
        let left_value = *left_segments.get(index).unwrap_or(&0);
        let right_value = *right_segments.get(index).unwrap_or(&0);
        match left_value.cmp(&right_value) {
            std::cmp::Ordering::Equal => continue,
            ordering => return ordering,
        }
    }
    std::cmp::Ordering::Equal
}

fn compare_hook_api_version(left: &str, right: &str) -> std::cmp::Ordering {
    let parse = |value: &str| -> u64 { value.trim().trim_start_matches('v').parse::<u64>().unwrap_or(0) };
    parse(left).cmp(&parse(right))
}

fn trust_tier_default_auto_update(trust_tier: &str, channel: &str) -> bool {
    matches!(trust_tier, "official" | "verified") && channel == "stable"
}

fn advisory_matches(advisory: &CatalogAdvisoryRecordPayload, package_id: &str, version: &str) -> bool {
    if advisory.package_id != package_id {
        return false;
    }
    match advisory.version.as_deref() {
        Some(target_version) => target_version.trim() == version,
        None => true,
    }
}

fn has_revocation(revocations: &CatalogRevocationsPayload, scope: &str, target_id: &str) -> bool {
    revocations.items.iter().any(|item| item.scope == scope && item.target_id == target_id)
}

fn parse_release_manifest_object(value: &serde_json::Value) -> Option<CatalogReleaseRecordPayload> {
    serde_json::from_value::<CatalogReleaseRecordPayload>(value.clone()).ok()
}

fn resolve_installed_release_record(
    summary: &RuntimeLocalManifestSummary,
) -> Option<CatalogReleaseRecordPayload> {
    summary
        .release_manifest
        .as_ref()
        .and_then(parse_release_manifest_object)
}

fn resolve_installed_policy(
    summary: &RuntimeLocalManifestSummary,
    package: &CatalogPackageRecordPayload,
) -> InstalledModPolicyPayload {
    let installed_release = resolve_installed_release_record(summary);
    let channel = installed_release
        .as_ref()
        .map(|item| item.channel.trim().to_string())
        .filter(|item| !item.is_empty())
        .unwrap_or_else(|| "stable".to_string());
    InstalledModPolicyPayload {
        auto_update: trust_tier_default_auto_update(&package.publisher.trust_tier, &channel),
        channel,
    }
}

#[derive(Debug, Default)]
struct CatalogConsentDecision {
    requires_user_consent: bool,
    consent_reasons: Vec<String>,
    added_capabilities: Vec<String>,
}

fn normalize_capability_set(items: &[String]) -> HashSet<String> {
    items
        .iter()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .collect()
}

fn read_manifest_capability_set(value: &serde_json::Value) -> HashSet<String> {
    value
        .get("capabilities")
        .and_then(|item| item.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str())
                .map(|item| item.trim().to_string())
                .filter(|item| !item.is_empty())
                .collect::<HashSet<_>>()
        })
        .unwrap_or_default()
}

fn resolve_installed_capability_set(summary: &RuntimeLocalManifestSummary) -> HashSet<String> {
    summary
        .release_manifest
        .as_ref()
        .map(read_manifest_capability_set)
        .filter(|items| !items.is_empty())
        .or_else(|| {
            resolve_installed_release_record(summary)
                .map(|record| normalize_capability_set(&record.capabilities))
                .filter(|items| !items.is_empty())
        })
        .or_else(|| summary.manifest.as_ref().map(read_manifest_capability_set).filter(|items| !items.is_empty()))
        .unwrap_or_default()
}

fn trust_tier_rank(value: &str) -> u8 {
    match value.trim() {
        "official" => 3,
        "verified" => 2,
        "community" => 1,
        _ => 0,
    }
}

fn resolve_installed_trust_tier(summary: &RuntimeLocalManifestSummary) -> Option<String> {
    summary
        .release_manifest
        .as_ref()
        .and_then(|value| value.get("publisher"))
        .and_then(|value| value.get("trustTier"))
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| {
            resolve_installed_release_record(summary)
                .map(|record| record.publisher.trust_tier.trim().to_string())
                .filter(|value| !value.is_empty())
        })
}

fn evaluate_catalog_consent(
    package: &CatalogPackageRecordPayload,
    release: &CatalogReleaseRecordPayload,
    advisory_ids: &[String],
    installed_summary: Option<&RuntimeLocalManifestSummary>,
) -> CatalogConsentDecision {
    let mut consent_reasons = Vec::<String>::new();
    let mut added_capabilities = Vec::<String>::new();
    let next_capabilities = normalize_capability_set(&release.capabilities);
    if let Some(summary) = installed_summary {
        let existing_capabilities = resolve_installed_capability_set(summary);
        if !next_capabilities.is_empty() {
            added_capabilities = next_capabilities
                .iter()
                .filter(|item| !existing_capabilities.contains(*item))
                .cloned()
                .collect::<Vec<_>>();
            added_capabilities.sort();
            if !added_capabilities.is_empty() {
                consent_reasons.push("capability-increase".to_string());
            }
        }
        if let Some(installed_trust_tier) = resolve_installed_trust_tier(summary) {
            if trust_tier_rank(&package.publisher.trust_tier) < trust_tier_rank(&installed_trust_tier) {
                consent_reasons.push("trust-tier-downgrade".to_string());
            }
        }
    }
    if package.publisher.trust_tier == "community" {
        consent_reasons.push("community-package".to_string());
    }
    if !advisory_ids.is_empty() {
        consent_reasons.push("advisory-review".to_string());
    }
    consent_reasons.sort();
    consent_reasons.dedup();
    CatalogConsentDecision {
        requires_user_consent: !consent_reasons.is_empty(),
        consent_reasons,
        added_capabilities,
    }
}

fn verify_release_signature(
    package: &CatalogPackageRecordPayload,
    release: &CatalogReleaseRecordPayload,
) -> Result<(), String> {
    let signer = package
        .signers
        .iter()
        .find(|item| item.signer_id == release.signer_id)
        .ok_or_else(|| format!("未找到 signer: {}", release.signer_id))?;
    if !signer.algorithm.trim().eq_ignore_ascii_case("ed25519") {
        return Err(format!("暂不支持的 signer algorithm: {}", signer.algorithm));
    }
    let verifying_key = if signer.public_key.contains("BEGIN PUBLIC KEY") {
        VerifyingKey::from_public_key_pem(&signer.public_key)
            .map_err(|error| format!("解析 signer public key 失败: {error}"))?
    } else {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(signer.public_key.trim())
            .map_err(|error| format!("解码 signer public key 失败: {error}"))?;
        let raw_bytes: [u8; 32] = bytes
            .as_slice()
            .try_into()
            .map_err(|_| "Ed25519 public key 长度非法".to_string())?;
        VerifyingKey::from_bytes(&raw_bytes)
            .map_err(|error| format!("解析 signer public key 失败: {error}"))?
    };
    let signature_bytes = base64::engine::general_purpose::STANDARD
        .decode(release.signature.trim())
        .map_err(|error| format!("解码 release signature 失败: {error}"))?;
    let signature = Signature::from_slice(&signature_bytes)
        .map_err(|error| format!("解析 release signature 失败: {error}"))?;
    let payload = serde_json::to_vec(&normalize_release_manifest_payload(release))
        .map_err(|error| format!("序列化 release signature payload 失败: {error}"))?;
    verifying_key
        .verify(&payload, &signature)
        .map_err(|error| format!("release signature 校验失败: {error}"))
}

fn validate_catalog_release(
    package: &CatalogPackageRecordPayload,
    release: &CatalogReleaseRecordPayload,
    revocations: &CatalogRevocationsPayload,
    advisories: &CatalogAdvisoriesPayload,
) -> Result<Vec<String>, String> {
    if release.package_type != "desktop-mod" {
        return Err(format!(
            "Desktop v1 暂不支持安装 packageType={}，packageId={}",
            release.package_type, release.package_id
        ));
    }
    if package.state.quarantined || release.state.quarantined {
        return Err(format!("package 已隔离，禁止安装: {}", package.package_id));
    }
    if package.state.yanked || release.state.yanked {
        return Err(format!("release 已下架，禁止安装: {}@{}", release.package_id, release.version));
    }
    if compare_semver_like(CURRENT_DESKTOP_VERSION, &release.min_desktop_version).is_lt() {
        return Err(format!(
            "Desktop 版本不兼容。required>={} current={}",
            release.min_desktop_version, CURRENT_DESKTOP_VERSION
        ));
    }
    if compare_hook_api_version(CURRENT_HOOK_API_VERSION, &release.min_hook_api_version).is_lt() {
        return Err(format!(
            "Hook API 版本不兼容。required>={} current={}",
            release.min_hook_api_version, CURRENT_HOOK_API_VERSION
        ));
    }
    if has_revocation(revocations, "package", &release.package_id)
        || has_revocation(revocations, "release", &format!("{}@{}", release.package_id, release.version))
        || has_revocation(revocations, "signer", &release.signer_id)
    {
        return Err(format!("package 命中撤销列表: {}@{}", release.package_id, release.version));
    }
    let matching_advisories = advisories
        .items
        .iter()
        .filter(|item| advisory_matches(item, &release.package_id, &release.version))
        .cloned()
        .collect::<Vec<_>>();
    if matching_advisories.iter().any(|item| item.action == "block") {
        return Err(format!("package 命中阻断公告: {}@{}", release.package_id, release.version));
    }
    verify_release_signature(package, release)?;
    Ok(matching_advisories
        .iter()
        .map(|item| item.advisory_id.clone())
        .collect())
}

fn download_release_archive(
    release: &CatalogReleaseRecordPayload,
) -> Result<(tempfile::TempDir, String), String> {
    let temp = tempfile::tempdir().map_err(|error| format!("创建 mod 下载临时目录失败: {error}"))?;
    let archive_path = temp.path().join(format!(
        "{}-{}.zip",
        sanitize_mod_dir_name(&release.package_id),
        release.version
    ));
    let client = BlockingHttpClient::new();
    let mut response = client
        .get(release.artifact_url.as_str())
        .send()
        .map_err(|error| format!("下载 catalog mod 失败: {error}"))?
        .error_for_status()
        .map_err(|error| format!("下载 catalog mod 失败: {error}"))?;
    let mut output = StdFile::create(&archive_path)
        .map_err(|error| format!("创建临时 mod archive 失败: {error}"))?;
    let mut hasher = sha2::Sha256::new();
    let mut buffer = [0u8; 8192];
    loop {
        let read = response
            .read(&mut buffer)
            .map_err(|error| format!("读取 catalog mod 响应失败: {error}"))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
        output
            .write_all(&buffer[..read])
            .map_err(|error| format!("写入临时 mod archive 失败: {error}"))?;
    }
    let digest = format!("{:x}", hasher.finalize());
    if digest != release.sha256.trim().to_ascii_lowercase() {
        return Err(format!(
            "mod archive SHA256 不匹配。expected={} actual={}",
            release.sha256, digest
        ));
    }
    Ok((temp, archive_path.display().to_string()))
}

fn load_catalog_package(base_url: &str, package_id: &str) -> Result<CatalogPackageRecordPayload, String> {
    let mut package = normalize_catalog_package_record(base_url, fetch_catalog_json::<CatalogPackageRecordPayload>(
        base_url,
        &format!("index/v1/packages/{}.json", package_id),
    )?);
    if package.releases.is_empty() {
        let mut seen_versions = HashSet::<String>::new();
        let mut releases = Vec::<CatalogReleaseRecordPayload>::new();
        for version in package.channels.values() {
            let normalized = version.trim();
            if normalized.is_empty() || !seen_versions.insert(normalized.to_string()) {
                continue;
            }
            releases.push(fetch_catalog_json::<CatalogReleaseRecordPayload>(
                base_url,
                &format!("index/v1/releases/{}/{}.json", package.package_id, normalized),
            )?);
        }
        package.releases = releases;
    }
    Ok(package)
}

fn load_catalog_supplements(base_url: &str) -> Result<(CatalogRevocationsPayload, CatalogAdvisoriesPayload), String> {
    let revocations = fetch_catalog_json_optional::<CatalogRevocationsPayload>(
        base_url,
        "index/v1/revocations.json",
    )?
    .unwrap_or(CatalogRevocationsPayload { items: Vec::new() });
    let advisories = fetch_catalog_json_optional::<CatalogAdvisoriesPayload>(
        base_url,
        "index/v1/advisories.json",
    )?
    .unwrap_or(CatalogAdvisoriesPayload { items: Vec::new() });
    Ok((revocations, advisories))
}

fn select_channel_release<'a>(
    package: &'a CatalogPackageRecordPayload,
    channel: Option<&str>,
) -> Result<&'a CatalogReleaseRecordPayload, String> {
    let resolved_channel = channel
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "stable".to_string());
    let version = package
        .channels
        .get(&resolved_channel)
        .ok_or_else(|| format!("package 未发布 channel: {}", resolved_channel))?;
    package
        .releases
        .iter()
        .find(|item| item.version == *version)
        .ok_or_else(|| format!("未找到 channel release: {}@{}", package.package_id, version))
}

pub fn list_catalog_mods() -> Result<Vec<CatalogPackageSummaryPayload>, String> {
    let Some(base_url) = resolve_catalog_base_url() else {
        return Ok(Vec::new());
    };
    Ok(fetch_catalog_json::<Vec<CatalogPackageSummaryPayload>>(&base_url, "index/v1/packages.json")?
        .into_iter()
        .map(|item| normalize_catalog_package_summary(&base_url, item))
        .collect())
}

pub fn get_catalog_mod(package_id: &str) -> Result<Option<CatalogPackageRecordPayload>, String> {
    let normalized_package_id = package_id.trim();
    if normalized_package_id.is_empty() {
        return Err("packageId 不能为空".to_string());
    }
    let Some(base_url) = resolve_catalog_base_url() else {
        return Ok(None);
    };
    load_catalog_package(&base_url, normalized_package_id).map(Some)
}

pub fn check_catalog_mod_updates(app: &AppHandle) -> Result<Vec<AvailableModUpdatePayload>, String> {
    let Some(base_url) = resolve_catalog_base_url() else {
        return Ok(Vec::new());
    };
    let (revocations, advisories) = load_catalog_supplements(&base_url)?;
    let installed = list_installed_runtime_mods(app)?;
    let mut updates = Vec::<AvailableModUpdatePayload>::new();
    for summary in installed {
        let package_id = resolve_installed_release_record(&summary)
            .map(|item| item.package_id)
            .unwrap_or_else(|| summary.id.clone());
        let Ok(package) = load_catalog_package(&base_url, &package_id) else {
            continue;
        };
        if package.package_type != "desktop-mod" {
            continue;
        }
        let policy = resolve_installed_policy(&summary, &package);
        let Ok(release) = select_channel_release(&package, Some(&policy.channel)) else {
            continue;
        };
        let installed_version = summary.version.clone().unwrap_or_default().trim().to_string();
        if installed_version.is_empty()
            || compare_semver_like(&installed_version, &release.version) != std::cmp::Ordering::Less
        {
            continue;
        }
        if has_revocation(&revocations, "package", &release.package_id)
            || has_revocation(&revocations, "release", &format!("{}@{}", release.package_id, release.version))
            || has_revocation(&revocations, "signer", &release.signer_id)
        {
            continue;
        }
        let matching_advisories = advisories
            .items
            .iter()
            .filter(|item| advisory_matches(item, &release.package_id, &release.version))
            .cloned()
            .collect::<Vec<_>>();
        if matching_advisories.iter().any(|item| item.action == "block") {
            continue;
        }
        let advisory_ids = matching_advisories
            .iter()
            .map(|item| item.advisory_id.clone())
            .collect::<Vec<_>>();
        let consent = evaluate_catalog_consent(&package, release, &advisory_ids, Some(&summary));
        updates.push(AvailableModUpdatePayload {
            package_id: package.package_id.clone(),
            installed_version,
            target_version: release.version.clone(),
            policy,
            trust_tier: package.publisher.trust_tier.clone(),
            requires_user_consent: consent.requires_user_consent,
            consent_reasons: consent.consent_reasons,
            added_capabilities: consent.added_capabilities,
            advisory_ids,
        });
    }
    Ok(updates)
}

pub fn install_catalog_mod(
    app: &AppHandle,
    package_id: &str,
    channel: Option<&str>,
) -> Result<CatalogInstallResultPayload, String> {
    let normalized_package_id = package_id.trim();
    if normalized_package_id.is_empty() {
        return Err("packageId 不能为空".to_string());
    }
    let base_url = resolve_catalog_base_url()
        .ok_or_else(|| format!("未设置 {}", MOD_CATALOG_BASE_URL_ENV))?;
    let package = load_catalog_package(&base_url, normalized_package_id)?;
    let release = select_channel_release(&package, channel)?.clone();
    let (revocations, advisories) = load_catalog_supplements(&base_url)?;
    let advisory_ids = validate_catalog_release(&package, &release, &revocations, &advisories)?;
    let (_temp, archive_path) = download_release_archive(&release)?;
    let install = install_runtime_mod_common(
        app,
        &archive_path,
        Some("archive"),
        false,
        "install",
        None,
    )?;
    let consent = evaluate_catalog_consent(&package, &release, &advisory_ids, None);
    Ok(CatalogInstallResultPayload {
        install,
        package: package.clone(),
        release: release.clone(),
        policy: InstalledModPolicyPayload {
            channel: release.channel.clone(),
            auto_update: trust_tier_default_auto_update(&package.publisher.trust_tier, &release.channel),
        },
        requires_user_consent: consent.requires_user_consent,
        consent_reasons: consent.consent_reasons,
        added_capabilities: consent.added_capabilities,
        advisory_ids,
    })
}

pub fn update_installed_catalog_mod(
    app: &AppHandle,
    package_id: &str,
    channel: Option<&str>,
) -> Result<CatalogInstallResultPayload, String> {
    let normalized_package_id = package_id.trim();
    if normalized_package_id.is_empty() {
        return Err("packageId 不能为空".to_string());
    }
    let installed_summary = list_installed_runtime_mods(app)?
        .into_iter()
        .find(|item| item.id == normalized_package_id)
        .ok_or_else(|| format!("未找到已安装 mod: {}", normalized_package_id))?;
    let base_url = resolve_catalog_base_url()
        .ok_or_else(|| format!("未设置 {}", MOD_CATALOG_BASE_URL_ENV))?;
    let package = load_catalog_package(&base_url, normalized_package_id)?;
    let policy = resolve_installed_policy(&installed_summary, &package);
    let release = select_channel_release(&package, channel.or(Some(&policy.channel)))?.clone();
    let (revocations, advisories) = load_catalog_supplements(&base_url)?;
    let advisory_ids = validate_catalog_release(&package, &release, &revocations, &advisories)?;
    let (_temp, archive_path) = download_release_archive(&release)?;
    let install = install_runtime_mod_common(
        app,
        &archive_path,
        Some("archive"),
        true,
        "update",
        Some(normalized_package_id),
    )?;
    let consent = evaluate_catalog_consent(&package, &release, &advisory_ids, Some(&installed_summary));
    Ok(CatalogInstallResultPayload {
        install,
        package: package.clone(),
        release: release.clone(),
        policy,
        requires_user_consent: consent.requires_user_consent,
        consent_reasons: consent.consent_reasons,
        added_capabilities: consent.added_capabilities,
        advisory_ids,
    })
}
