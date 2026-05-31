//! Packaged Platform catalog projections for Rust host consumers.
//!
//! The canonical row sources live under `.nimi/spec/platform/kernel/tables/**`.
//! This module exposes generated, read-only projections for Tauri host code that
//! must materialize or verify local Platform projections.

pub mod ai_profile_factory;
pub mod nimi_app_registry;
