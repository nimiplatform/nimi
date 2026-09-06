#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InstalledAppLaunchOutcome {
    pub launch_id: [u8; 32],
    pub process_id: u32,
    pub app_id: String,
    pub version: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InstalledAppRunAccess {
    pub available: bool,
    pub reason_code: String,
}
