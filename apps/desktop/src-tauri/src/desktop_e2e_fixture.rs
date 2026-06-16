#[cfg(any(test, feature = "desktop-e2e-fixture"))]
#[path = "desktop_e2e_fixture/enabled.rs"]
mod enabled;

#[cfg(any(test, feature = "desktop-e2e-fixture"))]
pub use enabled::*;

#[cfg(not(any(test, feature = "desktop-e2e-fixture")))]
#[allow(dead_code)]
#[path = "desktop_e2e_fixture/disabled.rs"]
mod disabled;

#[cfg(not(any(test, feature = "desktop-e2e-fixture")))]
pub use disabled::*;
