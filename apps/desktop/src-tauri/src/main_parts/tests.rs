#[cfg(test)]
mod tests {
    use super::{allowed_http_origins, normalize_origin};
    use reqwest::Url;

    #[test]
    fn normalize_origin_keeps_scheme_host_and_default_port() {
        let parsed = Url::parse("https://api.example.com/v1/chat").expect("valid url");
        let origin = normalize_origin(&parsed).expect("origin");
        assert_eq!(origin, "https://api.example.com:443");
    }

    #[test]
    fn normalize_origin_rejects_non_http_scheme() {
        let parsed = Url::parse("file:///tmp/data.txt").expect("valid url");
        let result = normalize_origin(&parsed);
        assert!(result.is_err());
    }

    #[test]
    fn allowed_http_origins_contains_runtime_defaults() {
        std::env::set_var("NIMI_REALM_URL", "https://gateway.nimi.local/v1");
        std::env::set_var("NIMI_LOCAL_PROVIDER_ENDPOINT", "http://127.0.0.1:1234/v1");
        std::env::set_var("NIMI_LOCAL_OPENAI_ENDPOINT", "http://localhost:1234/v1");

        let origins = allowed_http_origins();

        assert!(origins.contains("https://gateway.nimi.local:443"));
        assert!(origins.contains("http://127.0.0.1:1234"));
        assert!(origins.contains("http://localhost:1234"));
    }
}
