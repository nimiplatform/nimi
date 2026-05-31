//! Shared host projection helpers derived from Platform catalog truth.
//!
//! These modules own deterministic record construction and structural
//! validation for host-local projection files. App crates remain responsible
//! for choosing an admitted storage root, materializing files, and exposing
//! app-specific Tauri commands.

pub mod apps_bridge;
pub mod apps_packages;
pub mod apps_registry;
pub mod factory_profile_index;
