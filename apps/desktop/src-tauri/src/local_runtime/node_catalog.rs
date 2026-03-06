use std::collections::HashSet;

use super::capability_matrix::list_nodes_from_matrix;
use super::types::{
    LocalAiCapabilityMatrixEntry, LocalAiNodeDescriptor, LocalAiServiceDescriptor,
    LocalAiServiceStatus,
};

fn matches_filter(value: &str, filter: Option<&str>) -> bool {
    match filter {
        None => true,
        Some(expected) => value.trim().eq_ignore_ascii_case(expected.trim()),
    }
}

pub fn list_nodes_from_services(
    services: &[LocalAiServiceDescriptor],
    capability_matrix: &[LocalAiCapabilityMatrixEntry],
    capability: Option<&str>,
    service_id: Option<&str>,
    provider: Option<&str>,
) -> Vec<LocalAiNodeDescriptor> {
    let mut output = list_nodes_from_matrix(capability_matrix, capability, service_id, provider);
    let allowed_service_ids = services
        .iter()
        .filter(|service| service.status != LocalAiServiceStatus::Removed)
        .map(|service| service.service_id.to_ascii_lowercase())
        .collect::<HashSet<_>>();

    output.retain(|node| {
        if !matches_filter(node.service_id.as_str(), service_id) {
            return false;
        }
        if !matches_filter(node.provider.as_str(), provider) {
            return false;
        }
        let normalized = node.service_id.to_ascii_lowercase();
        allowed_service_ids.contains(normalized.as_str())
    });

    output.sort_by(|left, right| {
        left
            .provider
            .cmp(&right.provider)
            .then(left.node_id.cmp(&right.node_id))
    });
    output
}
