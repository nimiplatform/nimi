use serde::{Deserialize, Serialize};

use super::LocalAiAssetKind;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LocalAiModelType {
    Chat,
    Embedding,
    Image,
    Video,
    Tts,
    Stt,
    Music,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum LocalAiSuggestionSource {
    Manifest,
    Folder,
    DownloadMetadata,
    Filename,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LocalAiSuggestionConfidence {
    High,
    Low,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiAssetDeclaration {
    pub asset_kind: Option<LocalAiAssetKind>,
    pub engine: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiUnregisteredAssetDescriptor {
    pub filename: String,
    pub path: String,
    pub size_bytes: u64,
    pub declaration: Option<LocalAiAssetDeclaration>,
    pub suggestion_source: LocalAiSuggestionSource,
    pub confidence: LocalAiSuggestionConfidence,
    pub auto_importable: bool,
    pub requires_manual_review: bool,
    pub folder_name: Option<String>,
}
