package account

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestRealmPresenceCallbackStaysBelowOSDynamicPortRange(t *testing.T) {
	provider := realmOAuthPresenceProvider{}
	callback, err := provider.startLoopbackCallback(context.Background())
	if err != nil {
		t.Fatalf("startLoopbackCallback: %v", err)
	}
	defer callback.close()

	parsed, err := url.Parse(callback.redirectURI)
	if err != nil {
		t.Fatalf("parse callback redirect: %v", err)
	}
	port, err := strconv.Atoi(parsed.Port())
	if err != nil {
		t.Fatalf("parse callback port: %v", err)
	}
	if parsed.Scheme != "http" || parsed.Hostname() != "127.0.0.1" || parsed.Path != realmPresenceCallbackPath {
		t.Fatalf("callback redirect = %q, want exact loopback callback", callback.redirectURI)
	}
	if port < 1_024 || port > realmPresenceCallbackPortMax {
		t.Fatalf("callback port = %d, want 1024-%d", port, realmPresenceCallbackPortMax)
	}
}

func TestRealmOAuthPresenceProviderCompletesFreshReauth(t *testing.T) {
	var authorizeQuery url.Values
	var tokenForm url.Values
	realm := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/auth/oauth/authorize":
			authorizeQuery = r.URL.Query()
			callback := authorizeQuery.Get("redirect_uri")
			if callback == "" {
				t.Fatalf("authorize redirect_uri missing")
			}
			target, err := url.Parse(callback)
			if err != nil {
				t.Fatalf("parse callback: %v", err)
			}
			q := target.Query()
			q.Set("code", "presence-code")
			q.Set("state", authorizeQuery.Get("state"))
			target.RawQuery = q.Encode()
			http.Redirect(w, r, target.String(), http.StatusFound)
		case "/api/auth/oauth/token":
			if err := r.ParseForm(); err != nil {
				t.Fatalf("parse token form: %v", err)
			}
			tokenForm = r.PostForm
			w.Header().Set("content-type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"access_token":          "fresh-access",
				"refresh_token":         "fresh-refresh",
				"token_type":            "Bearer",
				"expires_in":            300,
				"account_id":            "acct-1",
				"display_name":          "Alice",
				"realm_environment_id": "realm-local",
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer realm.Close()

	provider := newRealmOAuthPresenceProvider(realmOAuthPresenceProviderConfig{
		AuthorizationURL: realm.URL + "/api/auth/oauth/authorize",
		TokenURL:         realm.URL + "/api/auth/oauth/token",
		ClientID:         "nimi-desktop",
		HTTPClient:       realm.Client(),
		OpenURL: func(context.Context, string) error {
			t.Fatal("request-scoped protected Desktop launcher was not used")
			return nil
		},
	})

	result, err := provider.RequestHostPresence(context.Background(), hostPresenceRequest{
		AccountID:   "acct-1",
		DisplayName: "Alice",
		Purpose:     "shijing.profile.reveal",
		BrowserLauncher: func(ctx context.Context, raw string) error {
			req, err := http.NewRequestWithContext(ctx, http.MethodGet, raw, nil)
			if err != nil {
				return err
			}
			resp, err := realm.Client().Do(req)
			if err != nil {
				return err
			}
			defer func() { _ = resp.Body.Close() }()
			return nil
		},
	})
	if err != nil {
		t.Fatalf("RequestHostPresence: %v", err)
	}
	if result.Outcome != hostPresenceVerified {
		t.Fatalf("outcome = %v, want verified", result.Outcome)
	}
	if result.Method != runtimev1.PresenceVerificationMethod_PRESENCE_VERIFICATION_METHOD_NIMI_REAUTH {
		t.Fatalf("method = %v, want NIMI_REAUTH", result.Method)
	}
	if authorizeQuery.Get("prompt") != "login" {
		t.Fatalf("authorize prompt = %q, want login", authorizeQuery.Get("prompt"))
	}
	if authorizeQuery.Get("presence_purpose") != "shijing.profile.reveal" {
		t.Fatalf("authorize presence_purpose = %q", authorizeQuery.Get("presence_purpose"))
	}
	if tokenForm.Get("code") != "presence-code" || tokenForm.Get("code_verifier") == "" {
		t.Fatalf("token form = %v, want code + verifier", tokenForm)
	}
}

func TestRealmOAuthPresenceProviderRejectsMismatchedAccount(t *testing.T) {
	realm := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/auth/oauth/authorize":
			callback := r.URL.Query().Get("redirect_uri")
			target, err := url.Parse(callback)
			if err != nil {
				t.Fatalf("parse callback: %v", err)
			}
			q := target.Query()
			q.Set("code", "presence-code")
			q.Set("state", r.URL.Query().Get("state"))
			target.RawQuery = q.Encode()
			http.Redirect(w, r, target.String(), http.StatusFound)
		case "/api/auth/oauth/token":
			w.Header().Set("content-type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"access_token":         "fresh-access",
				"refresh_token":        "fresh-refresh",
				"token_type":           "Bearer",
				"expires_in":           300,
				"account_id":           "acct-other",
				"display_name":         "Mallory",
				"realm_environment_id": "realm-local",
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer realm.Close()

	provider := newRealmOAuthPresenceProvider(realmOAuthPresenceProviderConfig{
		AuthorizationURL: realm.URL + "/api/auth/oauth/authorize",
		TokenURL:         realm.URL + "/api/auth/oauth/token",
		ClientID:         "nimi-desktop",
		HTTPClient:       realm.Client(),
		OpenURL: func(ctx context.Context, raw string) error {
			req, err := http.NewRequestWithContext(ctx, http.MethodGet, raw, nil)
			if err != nil {
				return err
			}
			resp, err := realm.Client().Do(req)
			if err != nil {
				return err
			}
			defer func() { _ = resp.Body.Close() }()
			return nil
		},
		Now: func() time.Time {
			return time.Date(2026, 6, 24, 12, 0, 0, 0, time.UTC)
		},
	})

	result, err := provider.RequestHostPresence(context.Background(), hostPresenceRequest{
		AccountID: "acct-1",
		Purpose:   "shijing.profile.reveal",
	})
	if err != nil {
		t.Fatalf("RequestHostPresence: %v", err)
	}
	if result.Outcome != hostPresenceRejected {
		t.Fatalf("outcome = %v, want rejected", result.Outcome)
	}
}
