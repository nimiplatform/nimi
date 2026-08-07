package account

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCurrentUserProfileFetchUsesAccountCredentialAndProjectsExactlyThreeFields(t *testing.T) {
	var authorization string
	var path string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authorization = r.Header.Get("Authorization")
		path = r.URL.Path
		w.Header().Set("content-type", "application/json")
		_, _ = w.Write([]byte(`{
			"id":"private-account-id","email":"private@example.invalid","role":"HUMAN",
			"handle":"halliday","displayName":"Halliday","avatarUrl":"https://cdn.example/avatar.png"
		}`))
	}))
	defer server.Close()

	profile, err := fetchCurrentUserProfile(context.Background(), server.Client(), server.URL, "access-1")
	if err != nil {
		t.Fatalf("fetchCurrentUserProfile: %v", err)
	}
	if authorization != "Bearer access-1" || path != "/api/human/me" {
		t.Fatalf("owner request = authorization %q path %q", authorization, path)
	}
	if profile.AccountID != "private-account-id" || profile.Display.Handle != "halliday" ||
		profile.Display.DisplayName != "Halliday" || profile.Display.AvatarURL == nil ||
		*profile.Display.AvatarURL != "https://cdn.example/avatar.png" {
		t.Fatalf("Current User profile = %+v", profile)
	}
}

func TestOAuthExchangeInstallsCurrentUserIntoExistingAccountMaterial(t *testing.T) {
	var profileCalls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("content-type", "application/json")
		switch r.URL.Path {
		case "/oauth/token":
			_, _ = w.Write([]byte(`{
				"access_token":"access-1","refresh_token":"refresh-1","token_type":"Bearer",
				"expires_in":300,"account_id":"account-1","display_name":"Token Name","realm_environment_id":"local"
			}`))
		case "/api/human/me":
			profileCalls++
			_, _ = w.Write([]byte(`{
				"id":"account-1","handle":"halliday","displayName":"Halliday","avatarUrl":null
			}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	exchanger := realmOAuthExchanger{
		httpClient: server.Client(), realmOrigin: server.URL, tokenURL: server.URL + "/oauth/token",
		clientID: "nimi-desktop", redirectURI: "http://localhost:46373/oauth/callback",
	}
	material, err := exchanger.Exchange(context.Background(), LoginAttempt{
		PKCEVerifier: "verifier", RedirectURI: "http://localhost:46373/oauth/callback",
	}, "authorization-code")
	if err != nil {
		t.Fatalf("Exchange: %v", err)
	}
	if profileCalls != 1 || material.CurrentUserHandle != "halliday" || material.DisplayName != "Halliday" ||
		material.CurrentUserAvatarURL != nil {
		t.Fatalf("installed Account material = %+v, profile calls = %d", material, profileCalls)
	}
}

func TestCurrentUserDisplayReadsExistingAccountGenerationWithoutPerAppRealmFetch(t *testing.T) {
	svc := newRealmUnaryHarnessService(t, "https://realm.invalid.test")
	completeLogin(t, svc)
	avatar := "https://cdn.example/avatar.png"
	svc.mu.Lock()
	svc.material.CurrentUserHandle = "halliday"
	svc.material.CurrentUserAvatarURL = &avatar
	svc.mu.Unlock()
	for range 3 {
		projection, err := svc.CurrentUserDisplay(context.Background())
		if err != nil {
			t.Fatalf("CurrentUserDisplay: %v", err)
		}
		if projection.Handle != "halliday" || projection.DisplayName != "Nimi User" ||
			projection.AvatarURL == nil || *projection.AvatarURL != avatar {
			t.Fatalf("Current User projection = %+v", projection)
		}
	}
}

func TestCurrentUserProfileFailureIsBoundedAndCredentialLikeResponseFailsClosed(t *testing.T) {
	for name, body := range map[string]string{
		"missing display": `{"id":"private","handle":"halliday"}`,
		"credential":      `{"id":"private","handle":"halliday","displayName":"Halliday","accessToken":"secret"}`,
		"signed avatar":   `{"id":"private","handle":"halliday","displayName":"Halliday","avatarUrl":"https://cdn.example/a.png?token=secret"}`,
	} {
		t.Run(name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("content-type", "application/json")
				_, _ = w.Write([]byte(body))
			}))
			defer server.Close()
			projection, err := fetchCurrentUserProfile(context.Background(), server.Client(), server.URL, "access-1")
			if !errors.Is(err, ErrCurrentUserDisplayUnavailable) || projection != (currentUserProfile{}) {
				t.Fatalf("fetchCurrentUserProfile = %+v, %v", projection, err)
			}
		})
	}
}

func TestCurrentUserDisplayDoesNotEstablishAnotherAccountSession(t *testing.T) {
	svc := newRealmUnaryHarnessService(t, "https://realm.invalid.test")
	projection, err := svc.CurrentUserDisplay(context.Background())
	if !errors.Is(err, ErrCurrentUserDisplayUnavailable) || projection != (CurrentUserDisplay{}) {
		t.Fatalf("CurrentUserDisplay = %+v, %v", projection, err)
	}
}
