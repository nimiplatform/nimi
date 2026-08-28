use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};

const MAX_BACKGROUND_BYTES: u64 = 20_971_520;
const MAX_BACKGROUND_PIXELS: u32 = 8_192;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StandardAgentCenterAvatarMaterialSelectPayload {
    pub backend_kind: StandardAgentCenterAvatarBackendKind,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StandardAgentCenterBackgroundMaterialSelectPayload {}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StandardAgentCenterAvatarMaterialSelectResult {
    pub role: String,
    pub file_name: String,
    pub media_type: String,
    pub content: Vec<u8>,
    pub sha256: String,
    pub custody_ref: String,
    pub backend_kind: StandardAgentCenterAvatarBackendKind,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StandardAgentCenterBackgroundMaterialSelectResult {
    pub role: String,
    pub file_name: String,
    pub media_type: String,
    pub content: Vec<u8>,
    pub sha256: String,
    pub custody_ref: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StandardAgentCenterAvatarBackendKind {
    Live2d,
    Vrm,
}

#[path = "standard_agent_center/commands.rs"]
pub(crate) mod commands;
pub(crate) use commands::{AgentCenterHostError, AgentCenterHostResult};
#[path = "standard_agent_center/resources_material_selection.rs"]
mod resources_material_selection;
#[path = "standard_agent_center/shell_projection.rs"]
pub(crate) mod shell_projection;

use resources_material_selection::*;

pub(crate) fn avatar_backend_kind_label(
    kind: StandardAgentCenterAvatarBackendKind,
) -> &'static str {
    match kind {
        StandardAgentCenterAvatarBackendKind::Live2d => "live2d",
        StandardAgentCenterAvatarBackendKind::Vrm => "vrm",
    }
}

#[cfg(test)]
mod tests;
