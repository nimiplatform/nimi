const PARENT_PIN_KEY_SERVICE: &str = "nimiplatform-shiji-parent-mode";
const PARENT_PIN_KEY_ACCOUNT: &str = "parent-pin";

fn keyring_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(PARENT_PIN_KEY_SERVICE, PARENT_PIN_KEY_ACCOUNT)
        .map_err(|error| format!("failed to initialize parent PIN keyring: {error}"))
}

fn normalize_pin(pin: &str) -> Result<String, String> {
    let trimmed = pin.trim();
    if trimmed.len() != 4 || !trimmed.chars().all(|ch| ch.is_ascii_digit()) {
        return Err("parent PIN must be exactly 4 digits".to_string());
    }
    Ok(trimmed.to_string())
}

#[tauri::command]
pub fn parent_pin_exists() -> Result<bool, String> {
    match keyring_entry()?.get_password() {
        Ok(value) => Ok(!value.trim().is_empty()),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(error) => Err(format!("failed to read parent PIN keyring state: {error}")),
    }
}

#[tauri::command]
pub fn parent_pin_set(pin: String) -> Result<(), String> {
    let normalized = normalize_pin(pin.as_str())?;
    keyring_entry()?
        .set_password(normalized.as_str())
        .map_err(|error| format!("failed to store parent PIN in keyring: {error}"))
}

#[tauri::command]
pub fn parent_pin_verify(pin: String) -> Result<bool, String> {
    let normalized = normalize_pin(pin.as_str())?;
    match keyring_entry()?.get_password() {
        Ok(stored) => Ok(stored.trim() == normalized),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(error) => Err(format!("failed to verify parent PIN from keyring: {error}")),
    }
}
