//! Shared host projection helpers derived from Platform catalog truth.
//!
//! These modules own deterministic record construction and structural
//! validation for host-local projection files. App crates remain responsible
//! for choosing an admitted storage root and exposing app-specific Tauri
//! commands; materializers in this module write only absent projections and
//! route existing faults to repair without overwrite.

pub mod factory_profile_index;
