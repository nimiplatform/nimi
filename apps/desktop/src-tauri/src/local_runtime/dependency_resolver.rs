use std::collections::{HashMap, HashSet};

use super::provider_adapter::provider_from_engine;
use super::service_lifecycle::preflight_dependency;
use super::types::{
    LocalAiCapabilityMatrixEntry, LocalAiDependencyDescriptor, LocalAiDependencyKind,
    LocalAiDependencySelectionRationale, LocalAiDeviceProfile, LocalAiPreflightDecision,
};

#[derive(Debug, Clone)]
pub struct DependencyOptionInput {
    pub dependency_id: String,
    pub kind: LocalAiDependencyKind,
    pub capability: Option<String>,
    pub title: Option<String>,
    pub model_id: Option<String>,
    pub repo: Option<String>,
    pub engine: Option<String>,
    pub service_id: Option<String>,
    pub node_id: Option<String>,
    pub workflow_id: Option<String>,
}

#[derive(Debug, Clone)]
pub struct DependencyAlternativeInput {
    pub alternative_id: String,
    pub preferred_dependency_id: Option<String>,
    pub options: Vec<DependencyOptionInput>,
}

#[derive(Debug, Clone, Default)]
pub struct DependencyDeclarationInput {
    pub required: Vec<DependencyOptionInput>,
    pub optional: Vec<DependencyOptionInput>,
    pub alternatives: Vec<DependencyAlternativeInput>,
    pub preferred: HashMap<String, String>,
}

#[derive(Debug, Clone)]
pub struct DependencyResolveInput {
    pub capability_filter: Option<String>,
    pub device_profile: LocalAiDeviceProfile,
    pub capability_matrix: Vec<LocalAiCapabilityMatrixEntry>,
    pub declaration: DependencyDeclarationInput,
}

#[derive(Debug, Clone)]
pub struct DependencyResolveOutput {
    pub dependencies: Vec<LocalAiDependencyDescriptor>,
    pub warnings: Vec<String>,
    pub reason_code: Option<String>,
    pub selection_rationale: Vec<LocalAiDependencySelectionRationale>,
    pub preflight_decisions: Vec<LocalAiPreflightDecision>,
}

fn normalize_optional(input: Option<&str>) -> Option<String> {
    input
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn dependency_matches_capability(option: &DependencyOptionInput, filter: Option<&str>) -> bool {
    let Some(filter) = filter else {
        return true;
    };
    match option.capability.as_ref() {
        Some(value) => value.trim().eq_ignore_ascii_case(filter),
        None => true,
    }
}

fn to_descriptor(
    option: &DependencyOptionInput,
    required: bool,
    selected: bool,
    preferred: bool,
) -> LocalAiDependencyDescriptor {
    let mut warnings = Vec::<String>::new();
    if option.dependency_id.trim().is_empty() {
        warnings.push("LOCAL_AI_DEPENDENCY_ID_MISSING".to_string());
    }
    if selected && option.kind == LocalAiDependencyKind::Model {
        if option
            .model_id
            .as_deref()
            .unwrap_or_default()
            .trim()
            .is_empty()
        {
            warnings.push("LOCAL_AI_DEPENDENCY_MODEL_ID_MISSING".to_string());
        }
        if option.repo.as_deref().unwrap_or_default().trim().is_empty() {
            warnings.push("LOCAL_AI_DEPENDENCY_REPO_MISSING".to_string());
        }
    }
    if selected && option.kind == LocalAiDependencyKind::Service {
        if option
            .service_id
            .as_deref()
            .unwrap_or_default()
            .trim()
            .is_empty()
        {
            warnings.push("LOCAL_AI_DEPENDENCY_SERVICE_ID_MISSING".to_string());
        }
    }
    if selected && option.kind == LocalAiDependencyKind::Node {
        if option
            .node_id
            .as_deref()
            .unwrap_or_default()
            .trim()
            .is_empty()
        {
            warnings.push("LOCAL_AI_DEPENDENCY_NODE_ID_MISSING".to_string());
        }
    }
    if selected && option.kind == LocalAiDependencyKind::Workflow {
        if option
            .workflow_id
            .as_deref()
            .unwrap_or_default()
            .trim()
            .is_empty()
        {
            warnings.push("LOCAL_AI_DEPENDENCY_WORKFLOW_ID_MISSING".to_string());
        }
    }
    LocalAiDependencyDescriptor {
        dependency_id: option.dependency_id.clone(),
        kind: option.kind.clone(),
        capability: option.capability.clone(),
        required,
        selected,
        preferred,
        model_id: option.model_id.clone(),
        repo: option.repo.clone(),
        engine: option.engine.clone(),
        service_id: option.service_id.clone(),
        node_id: option.node_id.clone(),
        workflow_id: option.workflow_id.clone(),
        reason_code: warnings.first().cloned(),
        warnings,
    }
}

fn to_descriptor_with_reason(
    option: &DependencyOptionInput,
    required: bool,
    selected: bool,
    preferred: bool,
    reason_code: Option<String>,
    warning: Option<String>,
) -> LocalAiDependencyDescriptor {
    let mut descriptor = to_descriptor(option, required, selected, preferred);
    if let Some(value) = normalize_optional(reason_code.as_deref()) {
        descriptor.reason_code = Some(value);
    }
    if let Some(value) = normalize_optional(warning.as_deref()) {
        if !descriptor.warnings.iter().any(|item| item == &value) {
            descriptor.warnings.push(value);
        }
    }
    if descriptor.reason_code.is_none() {
        descriptor.reason_code = descriptor.warnings.first().cloned();
    }
    descriptor
}

fn evaluate_option_fit(
    option: &DependencyOptionInput,
    profile: &LocalAiDeviceProfile,
    capability_matrix: &[LocalAiCapabilityMatrixEntry],
) -> Result<(bool, Vec<LocalAiPreflightDecision>), String> {
    let requested_provider = option
        .engine
        .as_deref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(provider_from_engine);
    let mut decisions = preflight_dependency(
        Some(option.dependency_id.as_str()),
        &option.kind,
        option.service_id.as_deref(),
        option.engine.as_deref(),
        option.node_id.as_deref(),
        option.workflow_id.as_deref(),
        profile,
    )?;
    let mut ok = decisions.iter().all(|item| item.ok);
    if !capability_matrix.is_empty()
        && (option.kind == LocalAiDependencyKind::Node
            || option.kind == LocalAiDependencyKind::Service)
    {
        let rows = capability_matrix
            .iter()
            .filter(|entry| {
                if option.kind == LocalAiDependencyKind::Node {
                    let Some(node_id) = option.node_id.as_ref() else {
                        return false;
                    };
                    if !entry.node_id.trim().eq_ignore_ascii_case(node_id.trim()) {
                        return false;
                    }
                }
                if let Some(service_id) = option.service_id.as_ref() {
                    if !entry
                        .service_id
                        .trim()
                        .eq_ignore_ascii_case(service_id.trim())
                    {
                        return false;
                    }
                }
                if let Some(capability) = option.capability.as_ref() {
                    if !entry
                        .capability
                        .trim()
                        .eq_ignore_ascii_case(capability.trim())
                    {
                        return false;
                    }
                }
                if let Some(provider) = requested_provider.as_ref() {
                    if !entry
                        .provider
                        .trim()
                        .eq_ignore_ascii_case(provider.as_str())
                    {
                        return false;
                    }
                }
                true
            })
            .collect::<Vec<_>>();
        if rows.is_empty() {
            ok = false;
            decisions.push(LocalAiPreflightDecision {
                dependency_id: Some(option.dependency_id.clone()),
                target: "capability-matrix".to_string(),
                check: "capability-available".to_string(),
                ok: false,
                reason_code: "LOCAL_AI_CAPABILITY_MISSING".to_string(),
                detail: "capability matrix has no matching node/service row".to_string(),
            });
        } else if !rows.iter().any(|entry| entry.available) {
            ok = false;
            let reason_code = rows
                .iter()
                .find_map(|entry| entry.reason_code.clone())
                .unwrap_or_else(|| "LOCAL_AI_CAPABILITY_MISSING".to_string());
            decisions.push(LocalAiPreflightDecision {
                dependency_id: Some(option.dependency_id.clone()),
                target: "capability-matrix".to_string(),
                check: "capability-available".to_string(),
                ok: false,
                reason_code: reason_code.clone(),
                detail: format!(
                    "capability matrix mismatch: dependencyId={} reasonCode={reason_code}",
                    option.dependency_id
                ),
            });
        }
    }
    Ok((ok, decisions))
}

fn option_label(option: &DependencyOptionInput) -> String {
    option
        .title
        .as_ref()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| option.dependency_id.clone())
}

fn select_alternative(
    alternative: &DependencyAlternativeInput,
    preferred_ids: &HashSet<String>,
    capability_preferred_id: Option<&str>,
    profile: &LocalAiDeviceProfile,
    capability_matrix: &[LocalAiCapabilityMatrixEntry],
    output_preflight: &mut Vec<LocalAiPreflightDecision>,
    output_rationale: &mut Vec<LocalAiDependencySelectionRationale>,
) -> Result<Option<String>, String> {
    if alternative.options.is_empty() {
        return Ok(None);
    }

    let mut fit_cache = HashMap::<String, bool>::new();
    for option in &alternative.options {
        let (ok, decisions) = evaluate_option_fit(option, profile, capability_matrix)?;
        output_preflight.extend(decisions);
        fit_cache.insert(option.dependency_id.clone(), ok);
    }

    let explicit_preferred = normalize_optional(alternative.preferred_dependency_id.as_deref());
    if let Some(candidate) = explicit_preferred {
        if fit_cache.get(candidate.as_str()) == Some(&true) {
            return Ok(Some(candidate));
        }
    }

    if let Some(candidate) = capability_preferred_id {
        if fit_cache.get(candidate) == Some(&true) {
            return Ok(Some(candidate.to_string()));
        }
    }

    let preferred_candidates = alternative
        .options
        .iter()
        .filter(|item| preferred_ids.contains(item.dependency_id.as_str()))
        .map(|item| item.dependency_id.clone())
        .collect::<Vec<_>>();
    for candidate in preferred_candidates {
        if fit_cache.get(candidate.as_str()) == Some(&true) {
            return Ok(Some(candidate));
        }
    }

    for option in &alternative.options {
        if fit_cache.get(option.dependency_id.as_str()) == Some(&true) {
            return Ok(Some(option.dependency_id.clone()));
        }
    }

    output_rationale.push(LocalAiDependencySelectionRationale {
        dependency_id: alternative.alternative_id.clone(),
        selected: false,
        reason_code: "LOCAL_AI_DEPENDENCY_ALTERNATIVE_NO_FIT".to_string(),
        detail: "no alternative option satisfies preflight/device constraints".to_string(),
    });
    Ok(None)
}

pub fn resolve_dependencies(
    input: &DependencyResolveInput,
) -> Result<DependencyResolveOutput, String> {
    let capability_filter = normalize_optional(input.capability_filter.as_deref());
    let preferred_ids = input
        .declaration
        .preferred
        .values()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect::<HashSet<_>>();

    let capability_preferred_id = capability_filter
        .as_ref()
        .and_then(|capability| input.declaration.preferred.get(capability))
        .map(|value| value.as_str());

    let mut dependencies = Vec::<LocalAiDependencyDescriptor>::new();
    let mut warnings = Vec::<String>::new();
    let mut selection_rationale = Vec::<LocalAiDependencySelectionRationale>::new();
    let mut preflight_decisions = Vec::<LocalAiPreflightDecision>::new();
    let mut required_missing_count = 0usize;
    let mut alternative_no_fit_count = 0usize;

    for option in &input.declaration.required {
        if !dependency_matches_capability(option, capability_filter.as_deref()) {
            continue;
        }
        let preferred = preferred_ids.contains(option.dependency_id.as_str());
        let (ok, decisions) = evaluate_option_fit(
            option,
            &input.device_profile,
            input.capability_matrix.as_slice(),
        )?;
        preflight_decisions.extend(decisions);
        if !ok {
            required_missing_count += 1;
            let reason_code = preflight_decisions
                .iter()
                .rev()
                .find(|item| {
                    item.dependency_id.as_deref() == Some(option.dependency_id.as_str()) && !item.ok
                })
                .map(|item| item.reason_code.clone())
                .unwrap_or_else(|| "LOCAL_AI_DEPENDENCY_REQUIRED_PREFLIGHT_FAILED".to_string());
            let warning = format!(
                "required dependency failed preflight: dependencyId={} reasonCode={}",
                option.dependency_id, reason_code
            );
            warnings.push(format!(
                "LOCAL_AI_REQUIRED_DEPENDENCY_NOT_SELECTED: dependencyId={} reasonCode={}",
                option.dependency_id, reason_code
            ));
            dependencies.push(to_descriptor_with_reason(
                option,
                true,
                false,
                preferred,
                Some(reason_code.clone()),
                Some(warning),
            ));
            selection_rationale.push(LocalAiDependencySelectionRationale {
                dependency_id: option.dependency_id.clone(),
                selected: false,
                reason_code: "LOCAL_AI_REQUIRED_DEPENDENCY_NOT_SELECTED".to_string(),
                detail: format!(
                    "required dependency skipped by preflight/device constraints: {}",
                    option_label(option)
                ),
            });
            continue;
        }
        dependencies.push(to_descriptor(option, true, true, preferred));
        selection_rationale.push(LocalAiDependencySelectionRationale {
            dependency_id: option.dependency_id.clone(),
            selected: true,
            reason_code: "LOCAL_AI_DEPENDENCY_REQUIRED_SELECTED".to_string(),
            detail: format!("required dependency selected: {}", option_label(option)),
        });
    }

    for option in &input.declaration.optional {
        if !dependency_matches_capability(option, capability_filter.as_deref()) {
            continue;
        }
        let preferred = preferred_ids.contains(option.dependency_id.as_str());
        let (ok, decisions) = evaluate_option_fit(
            option,
            &input.device_profile,
            input.capability_matrix.as_slice(),
        )?;
        preflight_decisions.extend(decisions);
        let selected = ok;
        if !ok {
            warnings.push(format!(
                "LOCAL_AI_OPTIONAL_DEPENDENCY_SKIPPED: dependencyId={}",
                option.dependency_id
            ));
        }
        dependencies.push(to_descriptor(option, false, selected, preferred));
        selection_rationale.push(LocalAiDependencySelectionRationale {
            dependency_id: option.dependency_id.clone(),
            selected,
            reason_code: if selected {
                "LOCAL_AI_OPTIONAL_DEPENDENCY_SELECTED".to_string()
            } else {
                "LOCAL_AI_OPTIONAL_DEPENDENCY_SKIPPED".to_string()
            },
            detail: if selected {
                format!(
                    "optional dependency selected by fit: {}",
                    option_label(option)
                )
            } else {
                format!(
                    "optional dependency skipped due to preflight constraints: {}",
                    option_label(option)
                )
            },
        });
    }

    for alternative in &input.declaration.alternatives {
        let selected = select_alternative(
            alternative,
            &preferred_ids,
            capability_preferred_id,
            &input.device_profile,
            input.capability_matrix.as_slice(),
            &mut preflight_decisions,
            &mut selection_rationale,
        )?;
        let selected_id = selected.unwrap_or_default();
        if selected_id.is_empty() {
            alternative_no_fit_count += 1;
            warnings.push(format!(
                "LOCAL_AI_DEPENDENCY_ALTERNATIVE_NO_FIT: alternativeId={}",
                alternative.alternative_id
            ));
        }
        for option in &alternative.options {
            if !dependency_matches_capability(option, capability_filter.as_deref()) {
                continue;
            }
            let is_selected = !selected_id.is_empty() && option.dependency_id == selected_id;
            let preferred = preferred_ids.contains(option.dependency_id.as_str()) || is_selected;
            let descriptor = if is_selected {
                to_descriptor(option, false, true, preferred)
            } else if selected_id.is_empty() {
                to_descriptor_with_reason(
                    option,
                    false,
                    false,
                    preferred,
                    Some("LOCAL_AI_DEPENDENCY_ALTERNATIVE_NO_FIT".to_string()),
                    Some(format!(
                        "alternative has no fit: alternativeId={} dependencyId={}",
                        alternative.alternative_id, option.dependency_id
                    )),
                )
            } else {
                to_descriptor(option, false, false, preferred)
            };
            dependencies.push(descriptor);
            selection_rationale.push(LocalAiDependencySelectionRationale {
                dependency_id: option.dependency_id.clone(),
                selected: is_selected,
                reason_code: if is_selected {
                    "LOCAL_AI_ALTERNATIVE_SELECTED".to_string()
                } else if selected_id.is_empty() {
                    "LOCAL_AI_DEPENDENCY_ALTERNATIVE_NO_FIT".to_string()
                } else {
                    "LOCAL_AI_ALTERNATIVE_NOT_SELECTED".to_string()
                },
                detail: if is_selected {
                    format!(
                        "alternative {} selected dependency {}",
                        alternative.alternative_id,
                        option_label(option)
                    )
                } else if selected_id.is_empty() {
                    format!(
                        "alternative {} has no dependency that satisfies preflight/device constraints",
                        alternative.alternative_id
                    )
                } else {
                    format!(
                        "alternative {} did not select dependency {}",
                        alternative.alternative_id,
                        option_label(option)
                    )
                },
            });
        }
    }

    if dependencies.is_empty() {
        warnings.push(
            "LOCAL_AI_DEPENDENCY_EMPTY_PLAN: no dependencies matched capability filter".to_string(),
        );
    }

    let reason_code = if required_missing_count > 0 {
        Some("LOCAL_AI_REQUIRED_DEPENDENCY_NOT_SELECTED".to_string())
    } else if alternative_no_fit_count > 0 {
        Some("LOCAL_AI_DEPENDENCY_ALTERNATIVE_NO_FIT".to_string())
    } else if dependencies.is_empty() {
        Some("LOCAL_AI_DEPENDENCY_EMPTY_PLAN".to_string())
    } else {
        None
    };

    Ok(DependencyResolveOutput {
        dependencies,
        warnings,
        reason_code,
        selection_rationale,
        preflight_decisions,
    })
}
