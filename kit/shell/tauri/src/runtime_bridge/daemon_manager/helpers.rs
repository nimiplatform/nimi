use super::DEFAULT_GRPC_ADDR;

pub(crate) fn grpc_addr() -> String {
    if let Some(value) = read_non_empty_env("NIMI_RUNTIME_GRPC_ADDR") {
        return value;
    }
    DEFAULT_GRPC_ADDR.to_string()
}

pub fn http_addr() -> String {
    if let Some(value) = read_non_empty_env("NIMI_RUNTIME_HTTP_ADDR") {
        return value;
    }
    "127.0.0.1:46372".to_string()
}

pub(super) fn read_non_empty_env(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .and_then(|value| normalize_non_empty(value.as_str()))
}

fn normalize_non_empty(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}
