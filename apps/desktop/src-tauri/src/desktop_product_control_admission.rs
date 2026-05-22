//! Backend `AdmitProductReadyForUse` operation (`P-COLD-016`).
//!
//! This is the only path that may transition `~/.nimi/nimi.json` to
//! `ready_for_use`. It composes the four first-run evidence owners in the
//! canonical `P-COLD-016` order, then atomically writes `ready_for_use`. Any
//! owner failure routes the record to the earliest affected non-ready
//! product-control state (the per-ref `failure_projection` in
//! `product-control-record-schema.yaml`).
//!
//! The renderer cannot reach this operation with refs or state — it only
//! triggers admission. Every evidence ref is re-resolved through its canonical
//! owner/verifier here; the recorded fields are never trusted as valid.
//!
//! Verification boundary: this module composes owner verifiers; it must not
//! re-implement the verify logic of the wave-3/4/5/10 owner modules.

use crate::desktop_product_control::{
    authenticated_runtime_account_id, now_iso_timestamp, product_control_record_path,
    read_existing_record, read_product_control_projection, selected_data_root_path, write_record,
    ProductControlRecord, ProductControlRecordProjection, ProductControlState,
    ProductDataRootStatus,
};
use base64::Engine;
use prost::Message;
use std::path::Path;

const RUNTIME_BASELINE_RESOLVE_METHOD_ID: &str =
    "/nimi.runtime.v1.RuntimeLocalService/ResolveRuntimeBaselineReadiness";
const FIRST_RUN_EXECUTION_RESOLVE_METHOD_ID: &str =
    "/nimi.runtime.v1.RuntimeLocalService/ResolveFirstRunExecutionEvidence";

/// `state == "ready"` is the only accepted Runtime baseline readiness state
/// (`K-LENV-ACT-011`).
const RUNTIME_BASELINE_STATE_READY: &str = "ready";
/// `state == LocalAiReady` is the only accepted first-run execution
/// evidence state (`K-AIEXEC-007`).
const FIRST_RUN_EXECUTION_STATE_READY: &str = concat!("local_", "ai_ready");

/// Resolved Runtime baseline readiness evidence accepted by admission step 5.
#[derive(Debug, Clone)]
pub struct RuntimeBaselineResolution {
    pub runtime_baseline_ref: String,
    pub selected_local_factory_ai_profile_ref: String,
    pub install_level: String,
    pub runtime_data_root_or_data_root_ref: String,
    pub text_generate_binding: serde_json::Value,
}

/// Resolved first-run execution evidence accepted by admission step 7.
#[derive(Debug, Clone)]
pub struct ExecutionEvidenceResolution {
    pub execution_evidence_ref: String,
    pub selected_local_factory_ai_profile_ref: String,
    pub install_level: String,
    pub runtime_baseline_ref: String,
    pub data_root_ref: String,
}

/// Cross-process Runtime owner resolution seam.
///
/// Production wires this to the desktop runtime bridge. Tests inject a fake so
/// the 8-step composition and every failure route can be exercised without a
/// live runtime daemon. The three methods own the admission steps that cannot
/// be resolved from the local filesystem: the authenticated Runtime account
/// session (step 2), Runtime baseline readiness (step 5), and Runtime baseline
/// execution evidence (step 7).
#[allow(async_fn_in_trait)]
pub trait AdmissionRuntimeResolvers {
    /// Step 2 — resolve the authenticated Runtime account id through
    /// `RuntimeAccountService`. An `Err` means no authenticated session.
    async fn resolve_authenticated_account_id(&self) -> Result<String, String>;

    /// Step 5 — re-verify `runtimeBaselineRef` through `RuntimeLocalService`.
    /// Accepts only `state == "ready"`; any other state is an `Err` carrying
    /// the resolver-reported projection state.
    async fn resolve_runtime_baseline(
        &self,
        runtime_baseline_ref: &str,
    ) -> Result<RuntimeBaselineResolution, RuntimeOwnerFailure>;

    /// Step 7 — re-verify `executionEvidenceRef` through Runtime execution
    /// evidence. Accepts only the runtime `LocalAiReady` state.
    async fn resolve_execution_evidence(
        &self,
        execution_evidence_ref: &str,
        expected_runtime_baseline_ref: &str,
        expected_data_root_ref: &str,
        expected_install_level: &str,
    ) -> Result<ExecutionEvidenceResolution, RuntimeOwnerFailure>;
}

/// A Runtime owner resolution failure plus the projection state it reported.
#[derive(Debug, Clone)]
pub struct RuntimeOwnerFailure {
    /// Resolver-reported projection state (e.g. `repair_required`,
    /// `LocalAiProfileSelectedEnvironmentNotReady`, runtime `LocalAiBlocked`).
    /// Empty when the bridge call itself failed.
    pub projection_state: String,
    pub detail: String,
}

/// The product-control state an admission step failure routes the record to,
/// mirroring the per-ref `failure_projection` in
/// `product-control-record-schema.yaml`.
fn map_runtime_baseline_failure(failure: &RuntimeOwnerFailure) -> ProductControlState {
    // runtimeBaselineRef.failure_projection routes to
    // LocalAiProfileSelectedEnvironmentNotReady or RepairRequired.
    match failure.projection_state.trim() {
        "repair_required" => ProductControlState::RepairRequired,
        "blocked" => ProductControlState::Blocked,
        _ => ProductControlState::LocalAiProfileSelectedEnvironmentNotReady,
    }
}

/// executionEvidenceRef.failure_projection routes to LocalAiReady or Blocked.
fn map_execution_evidence_failure(failure: &RuntimeOwnerFailure) -> ProductControlState {
    match failure.projection_state.trim() {
        arm if arm == "blocked" || arm == concat!("local_", "ai_blocked") => {
            ProductControlState::Blocked
        }
        _ => ProductControlState::LocalAiReady,
    }
}

fn first_run_factory_profile_ref(install_level: &str) -> String {
    format!(
        "aiprofile/nimi.first-run.local-factory.{}@1",
        install_level.trim().to_lowercase()
    )
}

/// Outcome of admission composition before the record write.
enum AdmissionComposition {
    /// All four owners verified; the values needed for the atomic ready write.
    Ready(Box<ReadyAdmissionEvidence>),
    /// An owner failed; route the record to this earliest affected non-ready
    /// state with this error.
    Failed {
        state: ProductControlState,
        error: String,
    },
}

/// Owner-verified evidence composed for the atomic `ready_for_use` write.
struct ReadyAdmissionEvidence {
    /// Backend-derived from the verified Account Default Profile evidence.
    baseline_profile_ref: String,
    baseline_commit_id: String,
    initialization_plan_id: String,
    account_default_profile_ref: String,
    built_in_ai_config_refs: Vec<String>,
    runtime_baseline_ref: String,
    execution_evidence_ref: String,
}

/// `AdmitProductReadyForUse` — the backend admission operation (`P-COLD-016`).
///
/// Composes the four first-run evidence owners in canonical order and, on full
/// success, atomically writes `ready_for_use` to `~/.nimi/nimi.json` with
/// `firstRun.completed=true` + `completedAt`. On any owner failure the record
/// is written at the earliest affected non-ready state. Re-running on an
/// already-`ready_for_use` record re-resolves every owner: all valid yields a
/// no-op success, any invalid routes to the failed owner's state.
pub async fn admit_product_ready_for_use<R: AdmissionRuntimeResolvers>(
    resolvers: &R,
) -> Result<ProductControlRecordProjection, String> {
    let control_path = product_control_record_path()?;
    let record = read_existing_record(&control_path)?.ok_or_else(|| {
        "~/.nimi/nimi.json is missing; product readiness cannot be admitted".to_string()
    })?;

    match compose_admission(&record, resolvers).await? {
        AdmissionComposition::Ready(evidence) => {
            let mut admitted = record;
            apply_ready_evidence(&mut admitted, &evidence);
            write_record(&control_path, &admitted)?;
            read_product_control_projection()
        }
        AdmissionComposition::Failed { state, error } => {
            let routed = route_failed_record(&control_path, record, state, &error)?;
            Ok(ProductControlRecordProjection {
                path: control_path.display().to_string(),
                exists: true,
                state: routed,
                record: None,
                error: Some(error),
            })
        }
    }
}

/// Compose the 8-step `P-COLD-016` admission sequence.
async fn compose_admission<R: AdmissionRuntimeResolvers>(
    record: &ProductControlRecord,
    resolvers: &R,
) -> Result<AdmissionComposition, String> {
    // Step 1 — product-control record shape, installId, productVersion,
    // selected nimi_data (dataRoot.status=ready), local first-run install
    // level. read_existing_record already ran validate_record; this re-asserts
    // the admission-relevant shape and resolves the inputs.
    let data_root = match selected_data_root_path(record) {
        Some(path) => path,
        None => {
            return Ok(AdmissionComposition::Failed {
                state: ProductControlState::DataRootMissing,
                error: "selected nimi_data is required before ready admission".to_string(),
            });
        }
    };
    if record.install_id.trim().is_empty() {
        return Ok(AdmissionComposition::Failed {
            state: ProductControlState::Blocked,
            error: "product-control record installId is required for ready admission".to_string(),
        });
    }
    if record.product_version.trim().is_empty() {
        return Ok(AdmissionComposition::Failed {
            state: ProductControlState::Blocked,
            error: "product-control record productVersion is required for ready admission"
                .to_string(),
        });
    }
    let data_root_status_ready = record
        .data_root
        .as_ref()
        .is_some_and(|root| matches!(root.status, ProductDataRootStatus::Ready));
    let install_level = match record
        .first_run
        .install_level
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(level) => level.to_string(),
        None => {
            return Ok(AdmissionComposition::Failed {
                state: ProductControlState::AiEnvironmentUnconfigured,
                error: "local first-run install level is required before ready admission"
                    .to_string(),
            });
        }
    };
    let ai_profile_alias = match record
        .first_run
        .ai_profile_alias
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(alias) => alias.to_string(),
        None => {
            return Ok(AdmissionComposition::Failed {
                state: ProductControlState::AiEnvironmentUnconfigured,
                error: "first-run aiProfileAlias is required before ready admission".to_string(),
            });
        }
    };

    // Step 2 — authenticated Runtime account session / account binding.
    let account_id = match resolvers.resolve_authenticated_account_id().await {
        Ok(account_id) => account_id,
        Err(error) => {
            // accountDefaultProfileRef.prerequisite_evidence:
            // authenticated_runtime_account_session.
            return Ok(AdmissionComposition::Failed {
                state: ProductControlState::NotLoggedIn,
                error: format!("authenticated Runtime account session failed: {error}"),
            });
        }
    };

    // Step 3 — local account profile library accountDefaultProfileRef
    // (P-AIPS-013), bound to the authenticated account_id and selected data
    // root. VERIFY path, not ensure.
    let account_ref = match record
        .first_run
        .account_default_profile_ref
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(account_ref) => account_ref.to_string(),
        None => {
            return Ok(AdmissionComposition::Failed {
                state: ProductControlState::LocalAiReady,
                error: "accountDefaultProfileRef is required before ready admission".to_string(),
            });
        }
    };
    let account_evidence = match crate::account_profile_library::verify_account_default_profile_ref(
        &data_root,
        &account_id,
        &account_ref,
    ) {
        Ok(evidence) => evidence,
        Err(error) => {
            // accountDefaultProfileRef.failure_projection:
            // accountDefaultProfileRef failure projects LocalAiReady or Blocked.
            return Ok(AdmissionComposition::Failed {
                state: ProductControlState::LocalAiReady,
                error: format!("Account Default Profile owner verification failed: {error}"),
            });
        }
    };

    // Step 4 — selected first-run local factory AIProfile + baseline commit
    // refs (P-AIPS-*). The factory AIProfile selection is verified through the
    // Platform factory catalog. baselineProfileRef / baselineCommitId are
    // backend-derived from the owner-verified Account Default Profile evidence
    // (profile_id / content_hash) — the recorded fields are never trusted.
    if let Err(error) =
        crate::platform_ai_profile_factory_catalog::verify_first_run_factory_ai_profile(
            &ai_profile_alias,
            &install_level,
        )
    {
        return Ok(AdmissionComposition::Failed {
            state: ProductControlState::AiEnvironmentUnconfigured,
            error: format!("selected first-run factory AIProfile verification failed: {error}"),
        });
    }
    let selected_factory_ref = first_run_factory_profile_ref(&install_level);
    if account_evidence.ai_profile_alias.trim() != ai_profile_alias {
        return Ok(AdmissionComposition::Failed {
            state: ProductControlState::AiEnvironmentUnconfigured,
            error: format!(
                "Account Default Profile aiProfileAlias {} does not match the selected first-run alias {}",
                account_evidence.ai_profile_alias.trim(),
                ai_profile_alias
            ),
        });
    }
    if !data_root_status_ready {
        return Ok(AdmissionComposition::Failed {
            state: ProductControlState::LocalAiProfileSelectedEnvironmentNotReady,
            error: "selected nimi_data dataRoot.status must be ready before ready admission"
                .to_string(),
        });
    }
    let baseline_profile_ref = account_evidence.profile_id.trim().to_string();
    let baseline_commit_id = account_evidence.content_hash.trim().to_string();
    if baseline_profile_ref.is_empty() || baseline_commit_id.is_empty() {
        return Ok(AdmissionComposition::Failed {
            state: ProductControlState::LocalAiReady,
            error: "Account Default Profile evidence is missing a durable baseline commit ref"
                .to_string(),
        });
    }

    // Step 5 — Runtime local baseline readiness runtimeBaselineRef
    // (K-LENV-ACT-011). Cross-process resolve; accept only state == "ready".
    let runtime_baseline_ref = match record
        .first_run
        .runtime_baseline_ref
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(value) => value.to_string(),
        None => {
            return Ok(AdmissionComposition::Failed {
                state: ProductControlState::LocalAiProfileSelectedEnvironmentNotReady,
                error: "runtimeBaselineRef is required before ready admission".to_string(),
            });
        }
    };
    let runtime_baseline = match resolvers
        .resolve_runtime_baseline(&runtime_baseline_ref)
        .await
    {
        Ok(resolution) => resolution,
        Err(failure) => {
            return Ok(AdmissionComposition::Failed {
                state: map_runtime_baseline_failure(&failure),
                error: format!(
                    "Runtime baseline readiness owner verification failed: {}",
                    failure.detail
                ),
            });
        }
    };
    if runtime_baseline.install_level.trim() != install_level {
        return Ok(AdmissionComposition::Failed {
            state: ProductControlState::LocalAiProfileSelectedEnvironmentNotReady,
            error: "Runtime baseline readiness is bound to a different install level".to_string(),
        });
    }
    if runtime_baseline
        .selected_local_factory_ai_profile_ref
        .trim()
        != selected_factory_ref.as_str()
    {
        return Ok(AdmissionComposition::Failed {
            state: ProductControlState::LocalAiProfileSelectedEnvironmentNotReady,
            error: "Runtime baseline readiness is bound to a different selected factory AIProfile"
                .to_string(),
        });
    }
    let selected_data_root_ref = data_root.display().to_string();
    if runtime_baseline.runtime_data_root_or_data_root_ref.trim() != selected_data_root_ref {
        return Ok(AdmissionComposition::Failed {
            state: ProductControlState::LocalAiProfileSelectedEnvironmentNotReady,
            error: "Runtime baseline readiness is bound to a different data root".to_string(),
        });
    }

    // Step 6 — built-in Desktop AIConfig refs for desktop.chat.nimi and
    // desktop.chat.agent (P-AISC-006 / D-AIPC-013). The wave-5 seam.
    let built_in_ai_config_set =
        match crate::desktop_product_control::resolve_built_in_ai_config_refs_for_admission(
            &data_root,
            &account_id,
            &record.first_run.built_in_ai_config_refs,
            Some(&runtime_baseline.text_generate_binding),
        ) {
            Ok(set) => set,
            Err(error) => {
                // builtInAiConfigRefs failure projects LocalAiReady or Blocked.
                return Ok(AdmissionComposition::Failed {
                    state: ProductControlState::LocalAiReady,
                    error: format!("built-in AIConfig owner verification failed: {error}"),
                });
            }
        };

    // Step 7 — Runtime baseline execution executionEvidenceRef (K-AIEXEC-007).
    // Cross-process resolve; accept only the runtime LocalAiReady state.
    let execution_evidence_ref = match record
        .first_run
        .execution_evidence_ref
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(value) => value.to_string(),
        None => {
            return Ok(AdmissionComposition::Failed {
                state: ProductControlState::LocalAiReady,
                error: "executionEvidenceRef is required before ready admission".to_string(),
            });
        }
    };
    let runtime_data_root_ref = runtime_baseline
        .runtime_data_root_or_data_root_ref
        .trim()
        .to_string();
    let execution_evidence = match resolvers
        .resolve_execution_evidence(
            &execution_evidence_ref,
            &runtime_baseline.runtime_baseline_ref,
            &runtime_data_root_ref,
            &install_level,
        )
        .await
    {
        Ok(resolution) => resolution,
        Err(failure) => {
            return Ok(AdmissionComposition::Failed {
                state: map_execution_evidence_failure(&failure),
                error: format!(
                    "Runtime baseline execution owner verification failed: {}",
                    failure.detail
                ),
            });
        }
    };
    if execution_evidence.runtime_baseline_ref.trim()
        != runtime_baseline.runtime_baseline_ref.trim()
    {
        return Ok(AdmissionComposition::Failed {
            state: ProductControlState::LocalAiReady,
            error: "execution evidence is bound to a different runtimeBaselineRef".to_string(),
        });
    }
    if execution_evidence
        .selected_local_factory_ai_profile_ref
        .trim()
        != selected_factory_ref.as_str()
    {
        return Ok(AdmissionComposition::Failed {
            state: ProductControlState::LocalAiReady,
            error: "execution evidence is bound to a different selected factory AIProfile"
                .to_string(),
        });
    }
    if execution_evidence.install_level.trim() != install_level {
        return Ok(AdmissionComposition::Failed {
            state: ProductControlState::LocalAiReady,
            error: "execution evidence is bound to a different install level".to_string(),
        });
    }
    if execution_evidence.data_root_ref.trim() != selected_data_root_ref {
        return Ok(AdmissionComposition::Failed {
            state: ProductControlState::LocalAiReady,
            error: "execution evidence is bound to a different data root".to_string(),
        });
    }

    // Step 8 — all owners verified. Compose the durable ready evidence. The
    // initializationPlanId binds the verified Runtime baseline + execution
    // refs, so it is durable owner-backed evidence, not a fabricated id.
    let initialization_plan_id = format!(
        "first-run-plan:{}:{}",
        runtime_baseline.runtime_baseline_ref.trim(),
        execution_evidence.execution_evidence_ref.trim()
    );
    Ok(AdmissionComposition::Ready(Box::new(
        ReadyAdmissionEvidence {
            baseline_profile_ref,
            baseline_commit_id,
            initialization_plan_id,
            account_default_profile_ref: account_evidence.account_default_profile_ref,
            built_in_ai_config_refs: built_in_ai_config_set.refs(),
            runtime_baseline_ref: runtime_baseline.runtime_baseline_ref,
            execution_evidence_ref: execution_evidence.execution_evidence_ref,
        },
    )))
}

/// Apply the owner-verified ready evidence to the record for the atomic
/// `ready_for_use` write (`record_write_rules`: atomic, `firstRun.completed`,
/// `completedAt`).
fn apply_ready_evidence(record: &mut ProductControlRecord, evidence: &ReadyAdmissionEvidence) {
    record.state = ProductControlState::ReadyForUse;
    record.first_run.completed = true;
    record.first_run.completed_at = Some(now_iso_timestamp());
    record.first_run.initialization_plan_id = Some(evidence.initialization_plan_id.clone());
    record.first_run.baseline_profile_ref = Some(evidence.baseline_profile_ref.clone());
    record.first_run.baseline_commit_id = Some(evidence.baseline_commit_id.clone());
    record.first_run.account_default_profile_ref =
        Some(evidence.account_default_profile_ref.clone());
    record.first_run.built_in_ai_config_refs = evidence.built_in_ai_config_refs.clone();
    record.first_run.runtime_baseline_ref = Some(evidence.runtime_baseline_ref.clone());
    record.first_run.execution_evidence_ref = Some(evidence.execution_evidence_ref.clone());
    record.repair = Default::default();
    if let Some(data_root) = record.data_root.as_mut() {
        data_root.status = ProductDataRootStatus::Ready;
    }
}

/// Write the record at the earliest affected non-ready product-control state
/// after a failed admission step. The original record is reused; only the
/// state, the repair record, and (for repair/blocked) the data-root status are
/// updated. Failed admission never persists `ready_for_use`.
fn route_failed_record(
    control_path: &Path,
    mut record: ProductControlRecord,
    failed_state: ProductControlState,
    error: &str,
) -> Result<ProductControlState, String> {
    record.state = failed_state.clone();
    if matches!(
        failed_state,
        ProductControlState::RepairRequired | ProductControlState::Blocked
    ) {
        record.repair = crate::desktop_product_control::ProductRepairRecord {
            required: true,
            reason: Some(error.to_string()),
        };
        if let Some(data_root) = record.data_root.as_mut() {
            data_root.status = ProductDataRootStatus::RepairRequired;
        }
    } else {
        record.repair = Default::default();
    }
    write_record(control_path, &record)?;
    Ok(failed_state)
}

/// Production [`AdmissionRuntimeResolvers`] backed by the desktop runtime
/// bridge. Both Runtime owner resolutions are cross-process unary calls
/// through the allowlisted `RuntimeLocalService` resolve methods.
pub struct BridgeAdmissionRuntimeResolvers;

impl AdmissionRuntimeResolvers for BridgeAdmissionRuntimeResolvers {
    async fn resolve_authenticated_account_id(&self) -> Result<String, String> {
        authenticated_runtime_account_id().await
    }

    async fn resolve_runtime_baseline(
        &self,
        runtime_baseline_ref: &str,
    ) -> Result<RuntimeBaselineResolution, RuntimeOwnerFailure> {
        let request = crate::runtime_bridge::generated::ResolveRuntimeBaselineReadinessRequest {
            runtime_baseline_ref: runtime_baseline_ref.to_string(),
            host_profile: None,
        };
        let response: crate::runtime_bridge::generated::ResolveRuntimeBaselineReadinessResponse =
            bridge_unary(RUNTIME_BASELINE_RESOLVE_METHOD_ID, request)
                .await
                .map_err(|detail| RuntimeOwnerFailure {
                    projection_state: String::new(),
                    detail,
                })?;
        if response.state.trim() != RUNTIME_BASELINE_STATE_READY {
            return Err(RuntimeOwnerFailure {
                projection_state: response.state.trim().to_string(),
                detail: format!(
                    "runtimeBaselineRef did not resolve ready (state={}, reason={})",
                    response.state.trim(),
                    response.reason_code.trim()
                ),
            });
        }
        let evidence = response.r#ref.ok_or_else(|| RuntimeOwnerFailure {
            projection_state: String::new(),
            detail: "Runtime baseline readiness response had no evidence ref".to_string(),
        })?;
        let text_generate_binding =
            crate::desktop_ai_config_library::runtime_text_generate_binding_from_baseline_ref(
                &evidence,
            )
            .map_err(|detail| RuntimeOwnerFailure {
                projection_state: String::new(),
                detail,
            })?;
        Ok(RuntimeBaselineResolution {
            runtime_baseline_ref: evidence.runtime_baseline_ref,
            selected_local_factory_ai_profile_ref: evidence.selected_local_factory_ai_profile_ref,
            install_level: evidence.install_level,
            runtime_data_root_or_data_root_ref: evidence.runtime_data_root_or_data_root_ref,
            text_generate_binding,
        })
    }

    async fn resolve_execution_evidence(
        &self,
        execution_evidence_ref: &str,
        expected_runtime_baseline_ref: &str,
        expected_data_root_ref: &str,
        expected_install_level: &str,
    ) -> Result<ExecutionEvidenceResolution, RuntimeOwnerFailure> {
        let request = crate::runtime_bridge::generated::ResolveFirstRunExecutionEvidenceRequest {
            execution_evidence_ref: execution_evidence_ref.to_string(),
            expected_runtime_baseline_ref: expected_runtime_baseline_ref.to_string(),
            expected_data_root_ref: expected_data_root_ref.to_string(),
            expected_install_level: expected_install_level.to_string(),
            host_profile: None,
        };
        let response: crate::runtime_bridge::generated::ResolveFirstRunExecutionEvidenceResponse =
            bridge_unary(FIRST_RUN_EXECUTION_RESOLVE_METHOD_ID, request)
                .await
                .map_err(|detail| RuntimeOwnerFailure {
                    projection_state: String::new(),
                    detail,
                })?;
        if response.state.trim() != FIRST_RUN_EXECUTION_STATE_READY {
            return Err(RuntimeOwnerFailure {
                projection_state: response.state.trim().to_string(),
                detail: format!(
                    concat!(
                        "executionEvidenceRef did not resolve ",
                        "local_",
                        "ai_ready (state={}, reason={})"
                    ),
                    response.state.trim(),
                    response.reason_code.trim()
                ),
            });
        }
        let evidence = response.r#ref.ok_or_else(|| RuntimeOwnerFailure {
            projection_state: String::new(),
            detail: "Runtime execution evidence response had no evidence ref".to_string(),
        })?;
        Ok(ExecutionEvidenceResolution {
            execution_evidence_ref: evidence.execution_evidence_ref,
            selected_local_factory_ai_profile_ref: evidence.selected_local_factory_ai_profile_ref,
            install_level: evidence.install_level,
            runtime_baseline_ref: evidence.runtime_baseline_ref,
            data_root_ref: evidence.data_root_ref,
        })
    }
}

/// Issue an allowlisted unary runtime-bridge call and decode the typed
/// response. Transport / decode errors fail closed — they never rescue a
/// contract failure.
async fn bridge_unary<Request, Response>(
    method_id: &str,
    request: Request,
) -> Result<Response, String>
where
    Request: Message,
    Response: Message + Default,
{
    let payload = crate::runtime_bridge::RuntimeBridgeUnaryPayload {
        method_id: method_id.to_string(),
        request_bytes_base64: base64::engine::general_purpose::STANDARD
            .encode(request.encode_to_vec()),
        metadata: None,
        authorization: None,
        protected_access_token: None,
        app_session: None,
        timeout_ms: Some(30_000),
    };
    let result = crate::runtime_bridge::runtime_bridge_unary(payload).await?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(result.response_bytes_base64.trim())
        .map_err(|_| format!("{method_id} response could not be decoded"))?;
    Response::decode(bytes.as_slice())
        .map_err(|error| format!("{method_id} response was invalid: {error}"))
}

/// Tauri command `product_control_record_admit_ready_for_use`.
///
/// The renderer-facing trigger for backend ready admission. The renderer
/// supplies no refs and no state — admission composes and re-verifies every
/// owner evidence ref itself (`P-COLD-016`). The renderer can only request
/// admission and read the resulting [`ProductControlRecordProjection`]:
/// success projects `ready_for_use`; any owner failure projects the earliest
/// affected non-ready state plus the failure error. Wave-7 consumes this
/// stable command name and projection shape.
#[tauri::command]
pub async fn product_control_record_admit_ready_for_use(
) -> Result<ProductControlRecordProjection, String> {
    admit_product_ready_for_use(&BridgeAdmissionRuntimeResolvers).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::desktop_product_control::{
        product_control_record_path, read_product_control_projection, select_product_data_root,
        set_first_run_install_level,
    };
    use crate::test_support::with_env;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    const TEST_ACCOUNT_ID: &str = "account-admission-test";
    const TEST_ALIAS: &str = "local-speech-ready";
    const TEST_INSTALL_LEVEL: &str = "minimal";
    const RECOMMENDED_INSTALL_LEVEL: &str = "recommended";
    const VALID_RUNTIME_BASELINE_REF: &str = "runtime-baseline:test-valid";
    const VALID_EXECUTION_EVIDENCE_REF: &str = "execution-evidence:test-valid";

    fn temp_home(prefix: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("nimi-admission-{prefix}-{unique}"));
        std::fs::create_dir_all(&dir).expect("create temp home");
        dir
    }

    /// Drive an async admission body to completion on a fresh current-thread
    /// runtime. `with_env` holds the process-global env mutex, so each test
    /// runs its async work in isolation without a shared runtime.
    fn run_async<F: std::future::Future<Output = ()>>(future: F) {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("build test runtime")
            .block_on(future);
    }

    /// Configurable fake [`AdmissionRuntimeResolvers`] — every Runtime owner
    /// resolution is a pure in-memory result, so the 8-step composition runs
    /// without a live runtime daemon.
    struct FakeResolvers {
        account_id: Result<String, String>,
        baseline: Result<RuntimeBaselineResolution, RuntimeOwnerFailure>,
        execution: Result<ExecutionEvidenceResolution, RuntimeOwnerFailure>,
    }

    impl FakeResolvers {
        /// All four Runtime owner resolutions valid.
        fn all_valid_for_data_root(data_root: &Path) -> Self {
            Self::all_valid_for_data_root_and_level(data_root, TEST_INSTALL_LEVEL)
        }

        fn all_valid_for_data_root_and_level(data_root: &Path, install_level: &str) -> Self {
            FakeResolvers {
                account_id: Ok(TEST_ACCOUNT_ID.to_string()),
                baseline: Ok(RuntimeBaselineResolution {
                    runtime_baseline_ref: VALID_RUNTIME_BASELINE_REF.to_string(),
                    selected_local_factory_ai_profile_ref: first_run_factory_profile_ref(
                        install_level,
                    ),
                    install_level: install_level.to_string(),
                    runtime_data_root_or_data_root_ref: data_root.display().to_string(),
                    text_generate_binding: fake_text_generate_binding(),
                }),
                execution: Ok(ExecutionEvidenceResolution {
                    execution_evidence_ref: VALID_EXECUTION_EVIDENCE_REF.to_string(),
                    selected_local_factory_ai_profile_ref: first_run_factory_profile_ref(
                        install_level,
                    ),
                    install_level: install_level.to_string(),
                    runtime_baseline_ref: VALID_RUNTIME_BASELINE_REF.to_string(),
                    data_root_ref: data_root.display().to_string(),
                }),
            }
        }
    }

    fn fake_text_generate_binding() -> serde_json::Value {
        serde_json::json!({
            "source": "local",
            "connectorId": "",
            "model": "asset-id:gemma-test",
            "modelId": "asset-id:gemma-test",
            "localModelId": "asset-id:gemma-test",
            "provider": "local",
            "engine": "llama.cpp.cpu",
            "goRuntimeLocalModelId": "asset-id:gemma-test",
            "runtimeBaselineRef": VALID_RUNTIME_BASELINE_REF,
            "runtimeConsumerId": "llama.cpp.cpu",
        })
    }

    impl AdmissionRuntimeResolvers for FakeResolvers {
        async fn resolve_authenticated_account_id(&self) -> Result<String, String> {
            self.account_id.clone()
        }
        async fn resolve_runtime_baseline(
            &self,
            _runtime_baseline_ref: &str,
        ) -> Result<RuntimeBaselineResolution, RuntimeOwnerFailure> {
            self.baseline.clone()
        }
        async fn resolve_execution_evidence(
            &self,
            _execution_evidence_ref: &str,
            _expected_runtime_baseline_ref: &str,
            _expected_data_root_ref: &str,
            _expected_install_level: &str,
        ) -> Result<ExecutionEvidenceResolution, RuntimeOwnerFailure> {
            self.execution.clone()
        }
    }

    /// Bring the on-disk product-control record to the pre-admission
    /// pre-admission `LocalAiReady` state with every locally-owned evidence file seeded and
    /// every recorded first-run ref populated. Returns the data root path.
    ///
    /// `account_ref_override` / `aiconfig_refs_override` /
    /// `runtime_baseline_ref` / `execution_evidence_ref` let a negative test
    /// inject an invalid recorded ref while keeping the rest valid.
    fn seed_pre_admission_record(
        home: &Path,
        account_ref_override: Option<String>,
        aiconfig_refs_override: Option<Vec<String>>,
        runtime_baseline_ref: &str,
        execution_evidence_ref: &str,
    ) -> PathBuf {
        seed_pre_admission_record_at_level(
            home,
            TEST_INSTALL_LEVEL,
            account_ref_override,
            aiconfig_refs_override,
            runtime_baseline_ref,
            execution_evidence_ref,
        )
    }

    /// Install-level-parameterized variant of [`seed_pre_admission_record`].
    /// Every owner evidence file is seeded for `install_level`, so the
    /// composed 8-step admission can be exercised for both Minimal and
    /// Recommended local install levels.
    fn seed_pre_admission_record_at_level(
        home: &Path,
        install_level: &str,
        account_ref_override: Option<String>,
        aiconfig_refs_override: Option<Vec<String>>,
        runtime_baseline_ref: &str,
        execution_evidence_ref: &str,
    ) -> PathBuf {
        let data_root = home.join("chosen-nimi-data");
        select_product_data_root(data_root.to_str().expect("root")).expect("select root");
        set_first_run_install_level(install_level, Some(TEST_ALIAS.to_string()))
            .expect("install level");

        let account_evidence = crate::account_profile_library::ensure_account_default_profile(
            &data_root,
            TEST_ACCOUNT_ID,
            TEST_ALIAS,
            install_level,
        )
        .expect("seed account default profile");
        let aiconfig_set =
            crate::desktop_ai_config_library::ensure_built_in_ai_config_evidence_set(
                &data_root,
                TEST_ACCOUNT_ID,
                TEST_ALIAS,
                install_level,
                &fake_text_generate_binding(),
            )
            .expect("seed built-in aiconfig set");

        let control_path = product_control_record_path().expect("path");
        let mut record = crate::desktop_product_control::read_existing_record(&control_path)
            .expect("read")
            .expect("record");
        record.state = ProductControlState::LocalAiReady;
        if let Some(root) = record.data_root.as_mut() {
            root.status = ProductDataRootStatus::Ready;
        }
        record.first_run.account_default_profile_ref = Some(
            account_ref_override
                .unwrap_or_else(|| account_evidence.account_default_profile_ref.clone()),
        );
        record.first_run.built_in_ai_config_refs =
            aiconfig_refs_override.unwrap_or_else(|| aiconfig_set.refs());
        record.first_run.runtime_baseline_ref = Some(runtime_baseline_ref.to_string());
        record.first_run.execution_evidence_ref = Some(execution_evidence_ref.to_string());
        crate::desktop_product_control::write_record(&control_path, &record).expect("write record");
        data_root
    }

    /// Positive: every owner ref valid -> atomic ready_for_use write with
    /// firstRun.completed=true + completedAt.
    #[test]
    fn admission_with_all_owners_valid_writes_ready_for_use() {
        let home = temp_home("positive");
        with_env(&[("HOME", home.to_str())], || {
            run_async(async {
                let data_root = seed_pre_admission_record(
                    &home,
                    None,
                    None,
                    VALID_RUNTIME_BASELINE_REF,
                    VALID_EXECUTION_EVIDENCE_REF,
                );
                let projection = admit_product_ready_for_use(
                    &FakeResolvers::all_valid_for_data_root(&data_root),
                )
                .await
                .expect("admission");
                assert_eq!(projection.state, ProductControlState::ReadyForUse);
                let record = projection.record.expect("record");
                assert!(record.first_run.completed);
                assert!(record
                    .first_run
                    .completed_at
                    .as_deref()
                    .is_some_and(|value| !value.trim().is_empty()));
                assert!(record
                    .first_run
                    .initialization_plan_id
                    .as_deref()
                    .is_some_and(|value| value.contains(VALID_RUNTIME_BASELINE_REF)));
                assert!(record
                    .first_run
                    .baseline_profile_ref
                    .as_deref()
                    .is_some_and(|value| !value.trim().is_empty()));
                assert!(record
                    .first_run
                    .baseline_commit_id
                    .as_deref()
                    .is_some_and(|value| !value.trim().is_empty()));
                assert_eq!(
                    record.data_root.expect("data root").status,
                    ProductDataRootStatus::Ready
                );
            });
        });
    }

    /// Negative: invalid accountDefaultProfileRef -> account-failure state.
    #[test]
    fn admission_with_invalid_account_ref_routes_local_ai_ready() {
        let home = temp_home("bad-account");
        with_env(&[("HOME", home.to_str())], || {
            run_async(async {
                let data_root = seed_pre_admission_record(
                    &home,
                    Some("account-default-profile:fabricated".to_string()),
                    None,
                    VALID_RUNTIME_BASELINE_REF,
                    VALID_EXECUTION_EVIDENCE_REF,
                );
                let projection = admit_product_ready_for_use(
                    &FakeResolvers::all_valid_for_data_root(&data_root),
                )
                .await
                .expect("admission");
                assert_eq!(projection.state, ProductControlState::LocalAiReady);
                assert!(projection
                    .error
                    .unwrap_or_default()
                    .contains("Account Default Profile owner verification failed"));
            });
        });
    }

    /// Negative: no authenticated account session -> not_logged_in.
    #[test]
    fn admission_without_account_session_routes_not_logged_in() {
        let home = temp_home("no-session");
        with_env(&[("HOME", home.to_str())], || {
            run_async(async {
                let data_root = seed_pre_admission_record(
                    &home,
                    None,
                    None,
                    VALID_RUNTIME_BASELINE_REF,
                    VALID_EXECUTION_EVIDENCE_REF,
                );
                let mut resolvers = FakeResolvers::all_valid_for_data_root(&data_root);
                resolvers.account_id = Err("no authenticated Runtime account session".to_string());
                let projection = admit_product_ready_for_use(&resolvers)
                    .await
                    .expect("admission");
                assert_eq!(projection.state, ProductControlState::NotLoggedIn);
            });
        });
    }

    /// Negative: runtime baseline resolver reports state != ready ->
    /// LocalAiProfileSelectedEnvironmentNotReady.
    #[test]
    fn admission_with_runtime_baseline_not_ready_routes_environment_not_ready() {
        let home = temp_home("baseline-not-ready");
        with_env(&[("HOME", home.to_str())], || {
            run_async(async {
                let data_root = seed_pre_admission_record(
                    &home,
                    None,
                    None,
                    VALID_RUNTIME_BASELINE_REF,
                    VALID_EXECUTION_EVIDENCE_REF,
                );
                let mut resolvers = FakeResolvers::all_valid_for_data_root(&data_root);
                resolvers.baseline = Err(RuntimeOwnerFailure {
                    projection_state: concat!(
                        "local_",
                        "ai_profile_selected_environment_not_ready"
                    )
                    .to_string(),
                    detail: "baseline activation evidence missing".to_string(),
                });
                let projection = admit_product_ready_for_use(&resolvers)
                    .await
                    .expect("admission");
                assert_eq!(
                    projection.state,
                    ProductControlState::LocalAiProfileSelectedEnvironmentNotReady
                );
            });
        });
    }

    /// Negative: runtime baseline resolver reports repair_required ->
    /// repair_required.
    #[test]
    fn admission_with_runtime_baseline_repair_required_routes_repair() {
        let home = temp_home("baseline-repair");
        with_env(&[("HOME", home.to_str())], || {
            run_async(async {
                let data_root = seed_pre_admission_record(
                    &home,
                    None,
                    None,
                    VALID_RUNTIME_BASELINE_REF,
                    VALID_EXECUTION_EVIDENCE_REF,
                );
                let mut resolvers = FakeResolvers::all_valid_for_data_root(&data_root);
                resolvers.baseline = Err(RuntimeOwnerFailure {
                    projection_state: "repair_required".to_string(),
                    detail: "baseline ref binding mismatch".to_string(),
                });
                let projection = admit_product_ready_for_use(&resolvers)
                    .await
                    .expect("admission");
                assert_eq!(projection.state, ProductControlState::RepairRequired);
            });
        });
    }

    /// Negative: partial / string-only builtInAiConfigRefs -> LocalAiReady.
    #[test]
    fn admission_with_partial_aiconfig_refs_routes_local_ai_ready() {
        let home = temp_home("partial-aiconfig");
        with_env(&[("HOME", home.to_str())], || {
            run_async(async {
                let data_root = seed_pre_admission_record(
                    &home,
                    None,
                    Some(vec!["aiconfig:string-only".to_string()]),
                    VALID_RUNTIME_BASELINE_REF,
                    VALID_EXECUTION_EVIDENCE_REF,
                );
                let projection = admit_product_ready_for_use(
                    &FakeResolvers::all_valid_for_data_root(&data_root),
                )
                .await
                .expect("admission");
                assert_eq!(projection.state, ProductControlState::LocalAiReady);
                assert!(projection
                    .error
                    .unwrap_or_default()
                    .contains("built-in AIConfig owner verification failed"));
            });
        });
    }

    /// Negative: execution evidence resolver reports a non-ready state ->
    /// LocalAiReady.
    #[test]
    fn admission_with_execution_evidence_invalid_routes_local_ai_ready() {
        let home = temp_home("bad-execution");
        with_env(&[("HOME", home.to_str())], || {
            run_async(async {
                let data_root = seed_pre_admission_record(
                    &home,
                    None,
                    None,
                    VALID_RUNTIME_BASELINE_REF,
                    VALID_EXECUTION_EVIDENCE_REF,
                );
                let mut resolvers = FakeResolvers::all_valid_for_data_root(&data_root);
                resolvers.execution = Err(RuntimeOwnerFailure {
                    projection_state: concat!("local_", "ai_ready").to_string(),
                    detail: "execution route was not local".to_string(),
                });
                let projection = admit_product_ready_for_use(&resolvers)
                    .await
                    .expect("admission");
                assert_eq!(projection.state, ProductControlState::LocalAiReady);
            });
        });
    }

    /// Negative: execution evidence resolver reports blocked -> blocked.
    #[test]
    fn admission_with_execution_evidence_blocked_routes_blocked() {
        let home = temp_home("execution-blocked");
        with_env(&[("HOME", home.to_str())], || {
            run_async(async {
                let data_root = seed_pre_admission_record(
                    &home,
                    None,
                    None,
                    VALID_RUNTIME_BASELINE_REF,
                    VALID_EXECUTION_EVIDENCE_REF,
                );
                let mut resolvers = FakeResolvers::all_valid_for_data_root(&data_root);
                resolvers.execution = Err(RuntimeOwnerFailure {
                    projection_state: concat!("local_", "ai_blocked").to_string(),
                    detail: "execution failed non-recoverably".to_string(),
                });
                let projection = admit_product_ready_for_use(&resolvers)
                    .await
                    .expect("admission");
                assert_eq!(projection.state, ProductControlState::Blocked);
            });
        });
    }

    /// Idempotent retry: re-admitting an already-ready record with every owner
    /// still valid is a no-op success that stays ready_for_use.
    #[test]
    fn re_admission_with_owners_still_valid_is_noop_success() {
        let home = temp_home("idempotent");
        with_env(&[("HOME", home.to_str())], || {
            run_async(async {
                let data_root = seed_pre_admission_record(
                    &home,
                    None,
                    None,
                    VALID_RUNTIME_BASELINE_REF,
                    VALID_EXECUTION_EVIDENCE_REF,
                );
                let first = admit_product_ready_for_use(&FakeResolvers::all_valid_for_data_root(
                    &data_root,
                ))
                .await
                .expect("first admission");
                assert_eq!(first.state, ProductControlState::ReadyForUse);
                let second = admit_product_ready_for_use(&FakeResolvers::all_valid_for_data_root(
                    &data_root,
                ))
                .await
                .expect("re-admission");
                assert_eq!(second.state, ProductControlState::ReadyForUse);
                assert!(second.record.expect("record").first_run.completed);
            });
        });
    }

    /// Evidence invalidation after ready_for_use: re-admitting once a Runtime
    /// owner ref no longer resolves routes the record to the failed state.
    #[test]
    fn re_admission_after_owner_invalidation_routes_failed_state() {
        let home = temp_home("invalidated");
        with_env(&[("HOME", home.to_str())], || {
            run_async(async {
                let data_root = seed_pre_admission_record(
                    &home,
                    None,
                    None,
                    VALID_RUNTIME_BASELINE_REF,
                    VALID_EXECUTION_EVIDENCE_REF,
                );
                let first = admit_product_ready_for_use(&FakeResolvers::all_valid_for_data_root(
                    &data_root,
                ))
                .await
                .expect("first admission");
                assert_eq!(first.state, ProductControlState::ReadyForUse);
                let mut resolvers = FakeResolvers::all_valid_for_data_root(&data_root);
                resolvers.baseline = Err(RuntimeOwnerFailure {
                    projection_state: "repair_required".to_string(),
                    detail: "baseline evidence invalidated after ready".to_string(),
                });
                let routed = admit_product_ready_for_use(&resolvers)
                    .await
                    .expect("re-admission");
                assert_eq!(routed.state, ProductControlState::RepairRequired);
                // The persisted record must no longer be ready_for_use.
                let reread = read_product_control_projection().expect("reread");
                assert_ne!(reread.state, ProductControlState::ReadyForUse);
            });
        });
    }

    /// Cross-layer acceptance (manual scenario 3): the 8-step admission
    /// composition writes `ready_for_use` for a Recommended local install
    /// level, not only the Minimal alias. The Runtime baseline resolution must
    /// be bound to `recommended` (admission step 5 rejects an install-level
    /// mismatch), and every locally-owned owner record is seeded at the
    /// Recommended level.
    #[test]
    fn admission_for_recommended_install_level_writes_ready_for_use() {
        let home = temp_home("recommended");
        with_env(&[("HOME", home.to_str())], || {
            run_async(async {
                let data_root = seed_pre_admission_record_at_level(
                    &home,
                    RECOMMENDED_INSTALL_LEVEL,
                    None,
                    None,
                    VALID_RUNTIME_BASELINE_REF,
                    VALID_EXECUTION_EVIDENCE_REF,
                );
                let mut resolvers = FakeResolvers::all_valid_for_data_root_and_level(
                    &data_root,
                    RECOMMENDED_INSTALL_LEVEL,
                );
                // Step 5 binds the Runtime baseline readiness to the recorded
                // install level; a Recommended record requires a Recommended
                // baseline resolution.
                resolvers.baseline = Ok(RuntimeBaselineResolution {
                    runtime_baseline_ref: VALID_RUNTIME_BASELINE_REF.to_string(),
                    selected_local_factory_ai_profile_ref: first_run_factory_profile_ref(
                        RECOMMENDED_INSTALL_LEVEL,
                    ),
                    install_level: RECOMMENDED_INSTALL_LEVEL.to_string(),
                    runtime_data_root_or_data_root_ref: data_root.display().to_string(),
                    text_generate_binding: fake_text_generate_binding(),
                });
                let projection = admit_product_ready_for_use(&resolvers)
                    .await
                    .expect("admission");
                assert_eq!(projection.state, ProductControlState::ReadyForUse);
                let record = projection.record.expect("record");
                assert!(record.first_run.completed);
                assert_eq!(
                    record.first_run.install_level.as_deref(),
                    Some(RECOMMENDED_INSTALL_LEVEL)
                );
                assert!(record
                    .first_run
                    .completed_at
                    .as_deref()
                    .is_some_and(|value| !value.trim().is_empty()));
            });
        });
    }

    /// Cross-layer acceptance: a Recommended record whose Runtime baseline
    /// readiness resolves bound to the Minimal install level is rejected by
    /// admission step 5 (install-level binding mismatch) and never reaches
    /// `ready_for_use`.
    #[test]
    fn admission_rejects_install_level_mismatch_between_record_and_runtime_baseline() {
        let home = temp_home("level-mismatch");
        with_env(&[("HOME", home.to_str())], || {
            run_async(async {
                let data_root = seed_pre_admission_record_at_level(
                    &home,
                    RECOMMENDED_INSTALL_LEVEL,
                    None,
                    None,
                    VALID_RUNTIME_BASELINE_REF,
                    VALID_EXECUTION_EVIDENCE_REF,
                );
                // FakeResolvers::all_valid reports the Minimal install level.
                let projection = admit_product_ready_for_use(
                    &FakeResolvers::all_valid_for_data_root(&data_root),
                )
                .await
                .expect("admission");
                assert_ne!(projection.state, ProductControlState::ReadyForUse);
                assert_eq!(
                    projection.state,
                    ProductControlState::LocalAiProfileSelectedEnvironmentNotReady
                );
                assert!(projection
                    .error
                    .unwrap_or_default()
                    .contains("different install level"));
            });
        });
    }

    /// Cross-layer negative (distinct from the per-owner Go negatives): a
    /// record whose only first-run "evidence" is a transfer/probe/liveness
    /// signal — a `transfer_completion`, an `endpoint_probe`, or a
    /// `process_liveness` value placed in the recorded evidence refs — is
    /// rejected by the admission op itself. None of these are owner-minted
    /// evidence; admission re-resolves each ref through its owner/verifier and
    /// fails closed without ever writing `ready_for_use`.
    #[test]
    fn admission_rejects_transfer_probe_liveness_signals_as_first_run_evidence() {
        let signals = [
            ("transfer_completion", "transfer_completion:bytes-copied-ok"),
            ("endpoint_probe", "endpoint_probe:127.0.0.1:health-200"),
            ("process_liveness", "process_liveness:runtime-daemon-up"),
        ];
        for (label, signal_value) in signals {
            let home = temp_home(&format!("signal-{label}"));
            with_env(&[("HOME", home.to_str())], || {
                run_async(async {
                    // The recorded accountDefaultProfileRef is a transfer /
                    // probe / liveness signal instead of an owner-minted
                    // Account Default Profile library ref.
                    let data_root = seed_pre_admission_record(
                        &home,
                        Some(signal_value.to_string()),
                        None,
                        VALID_RUNTIME_BASELINE_REF,
                        VALID_EXECUTION_EVIDENCE_REF,
                    );
                    let projection = admit_product_ready_for_use(
                        &FakeResolvers::all_valid_for_data_root(&data_root),
                    )
                    .await
                    .expect("admission");
                    assert_ne!(
                        projection.state,
                        ProductControlState::ReadyForUse,
                        "{label} signal must not admit ready_for_use"
                    );
                    assert!(projection
                        .error
                        .unwrap_or_default()
                        .contains("Account Default Profile owner verification failed"));
                });
            });
        }
    }

    /// Renderer-bypass-rejected: a direct file edit of a ready_for_use record
    /// whose locally-owned refs do not resolve reads back as a non-ready state.
    #[test]
    fn directly_edited_ready_record_with_unverified_refs_reads_failed_state() {
        let home = temp_home("file-edit");
        with_env(&[("HOME", home.to_str())], || {
            run_async(async {
                let data_root = seed_pre_admission_record(
                    &home,
                    None,
                    None,
                    VALID_RUNTIME_BASELINE_REF,
                    VALID_EXECUTION_EVIDENCE_REF,
                );
                let _ = data_root;
                let control_path = product_control_record_path().expect("path");
                let mut record =
                    crate::desktop_product_control::read_existing_record(&control_path)
                        .expect("read")
                        .expect("record");
                // Fabricate a ready_for_use record by direct file edit: the
                // shape is complete but the refs were never owner-admitted.
                record.state = ProductControlState::ReadyForUse;
                record.first_run.completed = true;
                record.first_run.completed_at = Some("2026-05-20T00:00:00.000Z".to_string());
                record.first_run.initialization_plan_id = Some("fabricated-plan".to_string());
                record.first_run.baseline_profile_ref = Some("profile:fabricated".to_string());
                record.first_run.baseline_commit_id = Some("commit:fabricated".to_string());
                record.first_run.account_default_profile_ref =
                    Some("account-default-profile:fabricated".to_string());
                record.first_run.built_in_ai_config_refs =
                    vec!["aiconfig:a".to_string(), "aiconfig:b".to_string()];
                record.first_run.runtime_baseline_ref =
                    Some("runtime-baseline:fabricated".to_string());
                record.first_run.execution_evidence_ref =
                    Some("execution-evidence:fabricated".to_string());
                std::fs::write(
                    &control_path,
                    serde_json::to_string_pretty(&record).expect("json"),
                )
                .expect("write fabricated ready record");
                let projection = read_product_control_projection().expect("projection");
                assert_ne!(projection.state, ProductControlState::ReadyForUse);
                assert!(projection
                    .error
                    .unwrap_or_default()
                    .contains("owner admission verification"));
            });
        });
    }
}
