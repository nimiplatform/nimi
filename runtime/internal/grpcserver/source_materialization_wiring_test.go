package grpcserver

import "testing"

func TestResolveSourceMaterializationWiringBuildsCanonicalJWKSURL(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		baseURL  string
		expected string
	}{
		{
			name:     "https origin",
			baseURL:  "https://realm.example.test",
			expected: "https://realm.example.test/api/auth/jwks/source-materialization",
		},
		{
			name:     "base path is replaced",
			baseURL:  "https://realm.example.test/deployment/api/v2/",
			expected: "https://realm.example.test/api/auth/jwks/source-materialization",
		},
		{
			name:     "localhost http",
			baseURL:  "http://localhost:3002/realm",
			expected: "http://localhost:3002/api/auth/jwks/source-materialization",
		},
		{
			name:     "ipv4 loopback http",
			baseURL:  "http://127.0.0.1:3002/realm",
			expected: "http://127.0.0.1:3002/api/auth/jwks/source-materialization",
		},
		{
			name:     "ipv6 loopback http",
			baseURL:  "http://[::1]:3002/realm",
			expected: "http://[::1]:3002/api/auth/jwks/source-materialization",
		},
	}

	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			resolved, err := resolveSourceMaterializationWiring("https://issuer.example.test", test.baseURL)
			if err != nil {
				t.Fatalf("resolveSourceMaterializationWiring: %v", err)
			}
			if resolved.disposition != sourceMaterializationWiringReady {
				t.Fatalf("disposition = %d, want ready", resolved.disposition)
			}
			if resolved.issuer != "https://issuer.example.test" {
				t.Fatalf("issuer = %q", resolved.issuer)
			}
			if resolved.jwksURL != test.expected {
				t.Fatalf("jwksURL = %q, want %q", resolved.jwksURL, test.expected)
			}
		})
	}
}

func TestResolveSourceMaterializationWiringRejectsUnsafeRealmBaseURL(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		baseURL string
	}{
		{name: "remote http", baseURL: "http://realm.example.test"},
		{name: "relative", baseURL: "/realm"},
		{name: "userinfo", baseURL: "https://account:secret@realm.example.test"},
		{name: "query", baseURL: "https://realm.example.test/root?tenant=one"},
		{name: "empty query", baseURL: "https://realm.example.test/root?"},
		{name: "fragment", baseURL: "https://realm.example.test/root#section"},
		{name: "empty fragment", baseURL: "https://realm.example.test/root#"},
		{name: "surrounding whitespace", baseURL: " https://realm.example.test"},
	}

	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			resolved, err := resolveSourceMaterializationWiring("https://issuer.example.test", test.baseURL)
			if err == nil {
				t.Fatal("expected strict Realm base URL rejection")
			}
			if resolved.disposition != sourceMaterializationWiringRejected {
				t.Fatalf("disposition = %d, want rejected", resolved.disposition)
			}
			if resolved.issuer != "" || resolved.jwksURL != "" {
				t.Fatalf("rejected configuration exposed admission values: %+v", resolved)
			}
		})
	}
}

func TestResolveSourceMaterializationWiringConfigurationDisposition(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name            string
		issuer          string
		baseURL         string
		wantDisposition sourceMaterializationWiringDisposition
		wantError       bool
	}{
		{
			name:            "empty pair is unconfigured",
			wantDisposition: sourceMaterializationWiringUnconfigured,
		},
		{
			name:            "issuer only is rejected",
			issuer:          "https://issuer.example.test",
			wantDisposition: sourceMaterializationWiringRejected,
			wantError:       true,
		},
		{
			name:            "Realm base only is rejected",
			baseURL:         "https://realm.example.test",
			wantDisposition: sourceMaterializationWiringRejected,
			wantError:       true,
		},
		{
			name:            "whitespace issuer is rejected",
			issuer:          " ",
			baseURL:         "https://realm.example.test",
			wantDisposition: sourceMaterializationWiringRejected,
			wantError:       true,
		},
	}

	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			resolved, err := resolveSourceMaterializationWiring(test.issuer, test.baseURL)
			if (err != nil) != test.wantError {
				t.Fatalf("error = %v, wantError = %t", err, test.wantError)
			}
			if resolved.disposition != test.wantDisposition {
				t.Fatalf("disposition = %d, want %d", resolved.disposition, test.wantDisposition)
			}
			if resolved.issuer != "" || resolved.jwksURL != "" {
				t.Fatalf("non-ready configuration exposed admission values: %+v", resolved)
			}
		})
	}
}
