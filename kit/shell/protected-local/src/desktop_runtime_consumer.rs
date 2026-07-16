use std::time::Duration;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DesktopRuntimeConsumerMethod {
    ListLocalAssets,
    ListNodeCatalog,
    CheckLocalAssetHealth,
    ListConnectors,
    GetRuntimeHealth,
    ListAiProviderHealth,
    ListDesktopAuditEvents,
    ListUsageStats,
    PeekScheduling,
    ExecuteScenario,
    ListAgents,
}

impl DesktopRuntimeConsumerMethod {
    pub fn from_method_id(method_id: &str) -> Option<Self> {
        Some(match method_id {
            "/nimi.runtime.v1.RuntimeLocalService/ListLocalAssets" => Self::ListLocalAssets,
            "/nimi.runtime.v1.RuntimeLocalService/ListNodeCatalog" => Self::ListNodeCatalog,
            "/nimi.runtime.v1.RuntimeLocalService/CheckLocalAssetHealth" => {
                Self::CheckLocalAssetHealth
            }
            "/nimi.runtime.v1.RuntimeConnectorService/ListConnectors" => Self::ListConnectors,
            "/nimi.runtime.v1.RuntimeAuditService/GetRuntimeHealth" => Self::GetRuntimeHealth,
            "/nimi.runtime.v1.RuntimeAuditService/ListAIProviderHealth" => {
                Self::ListAiProviderHealth
            }
            "/nimi.runtime.v1.RuntimeAuditService/ListDesktopAuditEvents" => {
                Self::ListDesktopAuditEvents
            }
            "/nimi.runtime.v1.RuntimeAuditService/ListUsageStats" => Self::ListUsageStats,
            "/nimi.runtime.v1.RuntimeAiService/PeekScheduling" => Self::PeekScheduling,
            "/nimi.runtime.v1.RuntimeAiService/ExecuteScenario" => Self::ExecuteScenario,
            "/nimi.runtime.v1.RuntimeAgentService/ListAgents" => Self::ListAgents,
            _ => return None,
        })
    }

    pub const fn method_id(self) -> &'static str {
        match self {
            Self::ListLocalAssets => "/nimi.runtime.v1.RuntimeLocalService/ListLocalAssets",
            Self::ListNodeCatalog => "/nimi.runtime.v1.RuntimeLocalService/ListNodeCatalog",
            Self::CheckLocalAssetHealth => {
                "/nimi.runtime.v1.RuntimeLocalService/CheckLocalAssetHealth"
            }
            Self::ListConnectors => "/nimi.runtime.v1.RuntimeConnectorService/ListConnectors",
            Self::GetRuntimeHealth => "/nimi.runtime.v1.RuntimeAuditService/GetRuntimeHealth",
            Self::ListAiProviderHealth => {
                "/nimi.runtime.v1.RuntimeAuditService/ListAIProviderHealth"
            }
            Self::ListDesktopAuditEvents => {
                "/nimi.runtime.v1.RuntimeAuditService/ListDesktopAuditEvents"
            }
            Self::ListUsageStats => "/nimi.runtime.v1.RuntimeAuditService/ListUsageStats",
            Self::PeekScheduling => "/nimi.runtime.v1.RuntimeAiService/PeekScheduling",
            Self::ExecuteScenario => "/nimi.runtime.v1.RuntimeAiService/ExecuteScenario",
            Self::ListAgents => "/nimi.runtime.v1.RuntimeAgentService/ListAgents",
        }
    }
}

pub struct DesktopRuntimeConsumerRequest {
    pub method: DesktopRuntimeConsumerMethod,
    pub request_bytes: Vec<u8>,
    pub timeout: Option<Duration>,
}

pub struct DesktopRuntimeConsumerResponse {
    pub response_bytes: Vec<u8>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DesktopRuntimeConsumerError {
    reason_code: String,
    retryable: bool,
}

impl DesktopRuntimeConsumerError {
    pub fn reason_code(&self) -> &str {
        self.reason_code.as_str()
    }

    pub const fn retryable(&self) -> bool {
        self.retryable
    }
}

impl From<crate::desktop_unary::DesktopUnaryError> for DesktopRuntimeConsumerError {
    fn from(error: crate::desktop_unary::DesktopUnaryError) -> Self {
        Self {
            reason_code: error.reason_code().to_string(),
            retryable: error.retryable(),
        }
    }
}

#[cfg(target_os = "windows")]
pub(crate) async fn invoke(
    channel: tonic::transport::Channel,
    request: DesktopRuntimeConsumerRequest,
) -> Result<DesktopRuntimeConsumerResponse, DesktopRuntimeConsumerError> {
    let response_bytes = crate::desktop_unary::invoke(
        channel,
        request.method.method_id(),
        request.request_bytes,
        request.timeout,
    )
    .await
    .map_err(DesktopRuntimeConsumerError::from)?;
    Ok(DesktopRuntimeConsumerResponse { response_bytes })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_runtime_consumer_method_set_round_trips() {
        let methods = [
            DesktopRuntimeConsumerMethod::ListLocalAssets,
            DesktopRuntimeConsumerMethod::ListNodeCatalog,
            DesktopRuntimeConsumerMethod::CheckLocalAssetHealth,
            DesktopRuntimeConsumerMethod::ListConnectors,
            DesktopRuntimeConsumerMethod::GetRuntimeHealth,
            DesktopRuntimeConsumerMethod::ListAiProviderHealth,
            DesktopRuntimeConsumerMethod::ListDesktopAuditEvents,
            DesktopRuntimeConsumerMethod::ListUsageStats,
            DesktopRuntimeConsumerMethod::PeekScheduling,
            DesktopRuntimeConsumerMethod::ExecuteScenario,
            DesktopRuntimeConsumerMethod::ListAgents,
        ];
        for method in methods {
            assert_eq!(
                DesktopRuntimeConsumerMethod::from_method_id(method.method_id()),
                Some(method)
            );
        }
        for denied in [
            "/nimi.runtime.v1.RuntimeConnectorService/ListConnectorModels",
            "/nimi.runtime.v1.RuntimeAuditService/ListAuditEvents",
            "/nimi.runtime.v1.RuntimeAuditService/SubscribeRuntimeHealthEvents",
            "/nimi.runtime.v1.RuntimeAiService/StreamScenario",
            "/nimi.runtime.v1.RuntimeLocalService/CollectDeviceProfile",
        ] {
            assert!(DesktopRuntimeConsumerMethod::from_method_id(denied).is_none());
        }
    }
}
