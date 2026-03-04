#[cfg(test)]
mod tests {
    use super::{
        allowed_http_origins, is_private_lan_http_origin, normalize_origin, runtime_defaults,
    };
    use reqwest::Url;
    use std::collections::HashMap;

    fn with_env(updates: &[(&str, Option<&str>)], run: impl FnOnce()) {
        let mut previous = HashMap::<String, Option<String>>::new();
        for (key, value) in updates {
            previous.insert(
                (*key).to_string(),
                std::env::var(key).ok(),
            );
            match value {
                Some(next) => std::env::set_var(key, next),
                None => std::env::remove_var(key),
            }
        }
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(run));
        for (key, value) in previous {
            match value {
                Some(prev) => std::env::set_var(key, prev),
                None => std::env::remove_var(key),
            }
        }
        if let Err(payload) = result {
            std::panic::resume_unwind(payload);
        }
    }

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
        with_env(
            &[
                ("NIMI_REALM_URL", Some("https://gateway.nimi.xyz/v1")),
                (
                    "NIMI_LOCAL_PROVIDER_ENDPOINT",
                    Some("http://127.0.0.1:1234/v1"),
                ),
                (
                    "NIMI_LOCAL_OPENAI_ENDPOINT",
                    Some("http://localhost:1234/v1"),
                ),
            ],
            || {
                let origins = allowed_http_origins();
                assert!(origins.contains("https://gateway.nimi.xyz:443"));
                assert!(origins.contains("http://127.0.0.1:1234"));
                assert!(origins.contains("http://localhost:1234"));
            },
        );
    }

    #[test]
    fn runtime_defaults_normalizes_loopback_realm_jwt_fields() {
        with_env(
            &[
                ("NIMI_REALM_URL", Some("http://localhost")),
                ("NIMI_REALM_JWKS_URL", None),
                ("NIMI_REALM_JWT_ISSUER", None),
            ],
            || {
                let defaults = runtime_defaults();
                assert_eq!(defaults.realm.realm_base_url, "http://localhost:3002");
                assert_eq!(defaults.realm.jwks_url, "http://localhost:3002/api/auth/jwks");
                assert_eq!(defaults.realm.jwt_issuer, "http://localhost:3002");
            },
        );
    }

    #[test]
    fn runtime_defaults_normalizes_explicit_loopback_jwt_overrides() {
        with_env(
            &[
                ("NIMI_REALM_URL", Some("http://localhost")),
                ("NIMI_REALM_JWKS_URL", Some("http://localhost/api/auth/jwks")),
                ("NIMI_REALM_JWT_ISSUER", Some("http://localhost")),
            ],
            || {
                let defaults = runtime_defaults();
                assert_eq!(defaults.realm.jwks_url, "http://localhost:3002/api/auth/jwks");
                assert_eq!(defaults.realm.jwt_issuer, "http://localhost:3002");
            },
        );
    }

    #[test]
    fn private_lan_http_origin_allows_common_ipv4_ranges() {
        let a = Url::parse("http://192.168.31.175/api/human/me").expect("valid url");
        let b = Url::parse("http://10.0.0.22:8080/healthz").expect("valid url");
        let c = Url::parse("http://172.16.5.9:3002/api").expect("valid url");
        let d = Url::parse("http://172.31.255.10:9000/api").expect("valid url");
        let e = Url::parse("http://172.32.0.1:3002/api").expect("valid url");
        let f = Url::parse("http://8.8.8.8:80/").expect("valid url");

        assert!(is_private_lan_http_origin(&a));
        assert!(is_private_lan_http_origin(&b));
        assert!(is_private_lan_http_origin(&c));
        assert!(is_private_lan_http_origin(&d));
        assert!(!is_private_lan_http_origin(&e));
        assert!(!is_private_lan_http_origin(&f));
    }
}
