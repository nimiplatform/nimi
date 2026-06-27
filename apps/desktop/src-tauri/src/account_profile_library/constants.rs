pub(crate) use nimi_shell_tauri::capabilities::ai_profile::{
    PLATFORM_AI_PROFILE_FACTORY_CATALOG_ID, PLATFORM_AI_PROFILE_FACTORY_CATALOG_VERSION,
    PLATFORM_AI_PROFILE_SELECTION_POLICY_REF,
};

pub(crate) const ACCOUNT_PROFILE_SCHEMA_VERSION: u32 = 1;
pub(crate) const ACCOUNT_DEFAULT_PROFILE_ID: &str = "default";
pub(crate) const ACCOUNT_DEFAULT_PROFILE_REF_PREFIX: &str = "account-default-profile:v1";
pub(crate) const ACCOUNT_PROFILE_LOCAL_LIBRARY_SOURCE: &str = "local_account_profile_library";
pub(crate) const PROFILE_REVISION_FACTORY_SEED: &str = "factory_seed";
pub(crate) const PROFILE_REVISION_LOCAL_EDIT: &str = "local_edit";
pub(crate) const PROFILE_REVISION_LOCAL_REPLACEMENT: &str = "local_replacement";
/// Account Default Profile `source.kind` per the product manual
/// `~/.nimi/accounts/<account-id>/profiles/default.json` schema.
pub(crate) const ACCOUNT_DEFAULT_PROFILE_SOURCE_KIND: &str = "factory-policy";
/// Manual fixed `displayName` for the seeded Account Default Profile template.
pub(crate) const ACCOUNT_DEFAULT_PROFILE_DISPLAY_NAME: &str = "Default Profile";
