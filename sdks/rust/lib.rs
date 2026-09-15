pub mod core_client;
pub mod core_generated;
pub mod realm;
pub mod runtime;
pub mod types;

#[cfg(test)]
mod behavior {
    include!("../conformance/behavior/rust.rs");
}
