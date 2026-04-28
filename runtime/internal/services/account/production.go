package account

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/appregistry"
	keyring "github.com/zalando/go-keyring"
)

const accountCustodyServicePrefix = "nimi/runtime/account"

type ProductionConfig struct {
	RealmBaseURL     string
	AuthorizationURL string
	TokenURL         string
	ClientID         string
	RedirectURI      string
	HTTPClient       *http.Client
	AppRegistry      *appregistry.Registry
}

type custodySnapshot struct {
	AccountID          string          `json:"accountId"`
	DisplayName        string          `json:"displayName,omitempty"`
	RealmEnvironmentID string          `json:"realmEnvironmentId,omitempty"`
	AccessToken        string          `json:"accessToken"`
	AccessTokenExpires string          `json:"accessTokenExpires"`
	RefreshToken       string          `json:"refreshToken"`
	RefreshTokenHashes map[string]bool `json:"refreshTokenHashes,omitempty"`
}

type osKeychainCustody struct{}

type realmOAuthExchanger struct {
	httpClient       *http.Client
	authorizationURL string
	tokenURL         string
	clientID         string
	redirectURI      string
}

type realmTokenRefresher struct {
	httpClient *http.Client
	tokenURL   string
}

func NewProduction(logger *slog.Logger, cfg ProductionConfig) *Service {
	resolved := resolveProductionConfig(cfg)
	if strings.TrimSpace(resolved.RealmBaseURL) == "" && logger != nil {
		logger.Warn("runtime account production activation has no Realm auth base URL; login exchange will fail closed")
	}
	return New(logger,
		WithProductionActivation(),
		WithCustody(osKeychainCustody{}),
		WithLoginExchanger(newRealmOAuthExchanger(resolved)),
		WithRefresher(newRealmTokenRefresher(resolved)),
		WithAppRegistry(resolved.AppRegistry),
	)
}

func resolveProductionConfig(cfg ProductionConfig) ProductionConfig {
	realmBaseURL := trimURL(firstNonEmpty(
		cfg.RealmBaseURL,
		os.Getenv("NIMI_RUNTIME_ACCOUNT_REALM_BASE_URL"),
		os.Getenv("NIMI_REALM_URL"),
	))
	authorizationURL := firstNonEmpty(
		cfg.AuthorizationURL,
		os.Getenv("NIMI_RUNTIME_ACCOUNT_AUTHORIZATION_URL"),
		os.Getenv("NIMI_WEB_URL"),
		"http://localhost",
	)
	tokenURL := firstNonEmpty(
		cfg.TokenURL,
		os.Getenv("NIMI_RUNTIME_ACCOUNT_TOKEN_URL"),
		joinURL(realmBaseURL, "/api/auth/oauth/token"),
	)
	clientID := firstNonEmpty(
		cfg.ClientID,
		os.Getenv("NIMI_RUNTIME_ACCOUNT_CLIENT_ID"),
		"nimi-desktop",
	)
	redirectURI := firstNonEmpty(
		cfg.RedirectURI,
		os.Getenv("NIMI_RUNTIME_ACCOUNT_REDIRECT_URI"),
		"http://localhost:46373/auth/callback",
	)
	httpClient := cfg.HTTPClient
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 20 * time.Second}
	}
	return ProductionConfig{
		RealmBaseURL:     realmBaseURL,
		AuthorizationURL: strings.TrimSpace(authorizationURL),
		TokenURL:         strings.TrimSpace(tokenURL),
		ClientID:         strings.TrimSpace(clientID),
		RedirectURI:      strings.TrimSpace(redirectURI),
		HTTPClient:       httpClient,
		AppRegistry:      cfg.AppRegistry,
	}
}

func newRealmOAuthExchanger(cfg ProductionConfig) realmOAuthExchanger {
	return realmOAuthExchanger{
		httpClient:       cfg.HTTPClient,
		authorizationURL: cfg.AuthorizationURL,
		tokenURL:         cfg.TokenURL,
		clientID:         cfg.ClientID,
		redirectURI:      cfg.RedirectURI,
	}
}

func newRealmTokenRefresher(cfg ProductionConfig) realmTokenRefresher {
	return realmTokenRefresher{
		httpClient: cfg.HTTPClient,
		tokenURL:   strings.TrimSuffix(cfg.TokenURL, "/oauth/token") + "/refresh",
	}
}

func (osKeychainCustody) Load(_ context.Context, partition string) (AccountMaterial, error) {
	payload, err := keyring.Get(accountCustodyServiceName(partition), "account-session")
	if err != nil {
		if errors.Is(err, keyring.ErrNotFound) {
			return AccountMaterial{}, ErrNoStoredAccount
		}
		return AccountMaterial{}, fmt.Errorf("%w: %v", ErrCustodyUnavailable, err)
	}
	var snapshot custodySnapshot
	if err := json.Unmarshal([]byte(payload), &snapshot); err != nil {
		return AccountMaterial{}, fmt.Errorf("%w: invalid custody snapshot", ErrCustodyUnavailable)
	}
	expiresAt, _ := time.Parse(time.RFC3339Nano, snapshot.AccessTokenExpires)
	return normalizeMaterial(AccountMaterial{
		AccountID:          snapshot.AccountID,
		DisplayName:        snapshot.DisplayName,
		RealmEnvironmentID: snapshot.RealmEnvironmentID,
		AccessToken:        snapshot.AccessToken,
		AccessTokenExpires: expiresAt,
		RefreshToken:       snapshot.RefreshToken,
		RefreshTokenHashes: snapshot.RefreshTokenHashes,
	}), nil
}

func (osKeychainCustody) Store(_ context.Context, partition string, material AccountMaterial) error {
	material = normalizeMaterial(material)
	payload, err := json.Marshal(custodySnapshot{
		AccountID:          material.AccountID,
		DisplayName:        material.DisplayName,
		RealmEnvironmentID: material.RealmEnvironmentID,
		AccessToken:        material.AccessToken,
		AccessTokenExpires: material.AccessTokenExpires.UTC().Format(time.RFC3339Nano),
		RefreshToken:       material.RefreshToken,
		RefreshTokenHashes: material.RefreshTokenHashes,
	})
	if err != nil {
		return fmt.Errorf("%w: encode custody snapshot", ErrCustodyUnavailable)
	}
	if err := keyring.Set(accountCustodyServiceName(partition), "account-session", string(payload)); err != nil {
		return fmt.Errorf("%w: %v", ErrCustodyUnavailable, err)
	}
	return nil
}

func (osKeychainCustody) Clear(_ context.Context, partition string) error {
	err := keyring.Delete(accountCustodyServiceName(partition), "account-session")
	if err != nil && !errors.Is(err, keyring.ErrNotFound) {
		return fmt.Errorf("%w: %v", ErrCustodyUnavailable, err)
	}
	return nil
}

func (r realmOAuthExchanger) Exchange(ctx context.Context, attempt LoginAttempt, code string) (AccountMaterial, error) {
	if strings.TrimSpace(r.tokenURL) == "" || strings.TrimSpace(r.clientID) == "" {
		return AccountMaterial{}, ErrLoginExchangeFailure
	}
	form := url.Values{}
	form.Set("grant_type", "authorization_code")
	form.Set("client_id", r.clientID)
	form.Set("code", strings.TrimSpace(code))
	form.Set("code_verifier", attempt.PKCEVerifier)
	form.Set("redirect_uri", firstNonEmpty(attempt.RedirectURI, r.redirectURI))
	return r.exchangeForm(ctx, form)
}

func (r realmOAuthExchanger) AdoptBrowserCallbackTokens(_ context.Context, _ LoginAttempt, accessToken string, refreshToken string) (AccountMaterial, error) {
	accessToken = strings.TrimSpace(accessToken)
	refreshToken = strings.TrimSpace(refreshToken)
	if accessToken == "" || refreshToken == "" {
		return AccountMaterial{}, ErrLoginExchangeFailure
	}
	return normalizeMaterial(AccountMaterial{
		AccountID:          jwtSubject(accessToken),
		AccessToken:        accessToken,
		AccessTokenExpires: accessTokenExpiry(accessToken, time.Now().UTC().Add(5*time.Minute)),
		RefreshToken:       refreshToken,
		RefreshTokenHashes: map[string]bool{},
	}), nil
}

func (r realmOAuthExchanger) exchangeForm(ctx context.Context, form url.Values) (AccountMaterial, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, r.tokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return AccountMaterial{}, ErrLoginExchangeFailure
	}
	req.Header.Set("content-type", "application/x-www-form-urlencoded")
	resp, err := r.httpClient.Do(req)
	if err != nil {
		return AccountMaterial{}, fmt.Errorf("%w: %v", ErrLoginExchangeFailure, err)
	}
	defer resp.Body.Close()
	return materialFromTokenResponse(resp)
}

func (r realmTokenRefresher) Refresh(ctx context.Context, material AccountMaterial) (AccountMaterial, error) {
	if strings.TrimSpace(r.tokenURL) == "" || strings.TrimSpace(material.RefreshToken) == "" {
		return AccountMaterial{}, ErrLoginExchangeFailure
	}
	body, _ := json.Marshal(map[string]string{"refreshToken": material.RefreshToken})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, r.tokenURL, bytes.NewReader(body))
	if err != nil {
		return AccountMaterial{}, ErrLoginExchangeFailure
	}
	req.Header.Set("content-type", "application/json")
	resp, err := r.httpClient.Do(req)
	if err != nil {
		return AccountMaterial{}, fmt.Errorf("%w: %v", ErrLoginExchangeFailure, err)
	}
	defer resp.Body.Close()
	next, err := materialFromTokenResponse(resp)
	if err != nil {
		return AccountMaterial{}, err
	}
	if next.AccountID == "" {
		next.AccountID = material.AccountID
		next.DisplayName = material.DisplayName
		next.RealmEnvironmentID = material.RealmEnvironmentID
	}
	return next, nil
}

func materialFromTokenResponse(resp *http.Response) (AccountMaterial, error) {
	payload, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return AccountMaterial{}, fmt.Errorf("%w: read response", ErrLoginExchangeFailure)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return AccountMaterial{}, fmt.Errorf("%w: http %d", ErrLoginExchangeFailure, resp.StatusCode)
	}
	var parsed map[string]any
	if err := json.Unmarshal(payload, &parsed); err != nil {
		return AccountMaterial{}, fmt.Errorf("%w: decode response", ErrLoginExchangeFailure)
	}
	accessToken := readString(parsed, "access_token", "accessToken")
	refreshToken := readString(parsed, "refresh_token", "refreshToken")
	if accessToken == "" || refreshToken == "" {
		if tokens, ok := parsed["tokens"].(map[string]any); ok {
			accessToken = firstNonEmpty(accessToken, readString(tokens, "access_token", "accessToken"))
			refreshToken = firstNonEmpty(refreshToken, readString(tokens, "refresh_token", "refreshToken"))
		}
	}
	expiresAt := time.Now().UTC().Add(5 * time.Minute)
	if expiresIn := readNumber(parsed, "expires_in", "expiresIn"); expiresIn > 0 {
		expiresAt = time.Now().UTC().Add(time.Duration(expiresIn) * time.Second)
	}
	accountID := readString(parsed, "account_id", "accountId", "user_id", "userId", "sub")
	displayName := readString(parsed, "display_name", "displayName", "name")
	if user, ok := parsed["user"].(map[string]any); ok {
		accountID = firstNonEmpty(accountID, readString(user, "id", "account_id", "accountId", "userId"))
		displayName = firstNonEmpty(displayName, readString(user, "displayName", "display_name", "name", "email"))
	}
	accountID = firstNonEmpty(accountID, jwtSubject(accessToken))
	return AccountMaterial{
		AccountID:          accountID,
		DisplayName:        displayName,
		RealmEnvironmentID: readString(parsed, "realm_environment_id", "realmEnvironmentId"),
		AccessToken:        accessToken,
		AccessTokenExpires: expiresAt,
		RefreshToken:       refreshToken,
	}, nil
}

func (r realmOAuthExchanger) AuthorizationURL(attempt LoginAttempt) string {
	if strings.TrimSpace(r.authorizationURL) == "" {
		return ""
	}
	u, err := url.Parse(r.authorizationURL)
	if err != nil {
		return ""
	}
	callbackURL := firstNonEmpty(attempt.RedirectURI, r.redirectURI)
	if u.Fragment != "" {
		hashRaw := strings.TrimPrefix(u.Fragment, "#")
		hashPath, hashQueryRaw, _ := strings.Cut(hashRaw, "?")
		if strings.TrimSpace(hashPath) == "" {
			hashPath = "/login"
		}
		hashQuery, _ := url.ParseQuery(hashQueryRaw)
		hashQuery.Set("desktop_callback", callbackURL)
		hashQuery.Set("desktop_state", attempt.State)
		u.Fragment = hashPath + "?" + hashQuery.Encode()
		return u.String()
	}
	u.Fragment = "/login?desktop_callback=" + url.QueryEscape(callbackURL) + "&desktop_state=" + url.QueryEscape(attempt.State)
	return u.String()
}

func accessTokenExpiry(token string, fallback time.Time) time.Time {
	raw := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(token), "Bearer "))
	parts := strings.Split(raw, ".")
	if len(parts) < 2 {
		return fallback
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return fallback
	}
	var parsed map[string]any
	if err := json.Unmarshal(payload, &parsed); err != nil {
		return fallback
	}
	if exp := readNumber(parsed, "exp"); exp > 0 {
		return time.Unix(exp, 0).UTC()
	}
	return fallback
}

func accountCustodyServiceName(partition string) string {
	return accountCustodyServicePrefix + "/" + strings.NewReplacer("/", "_", ":", "_").Replace(strings.TrimSpace(partition))
}

func joinURL(base string, path string) string {
	trimmed := strings.TrimRight(strings.TrimSpace(base), "/")
	if trimmed == "" {
		return ""
	}
	return trimmed + path
}

func trimURL(value string) string {
	return strings.TrimRight(strings.TrimSpace(value), "/")
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func readString(values map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := values[key]; ok {
			if text := strings.TrimSpace(fmt.Sprint(value)); text != "" && text != "<nil>" {
				return text
			}
		}
	}
	return ""
}

func readNumber(values map[string]any, keys ...string) int64 {
	for _, key := range keys {
		switch value := values[key].(type) {
		case float64:
			return int64(value)
		case int64:
			return value
		case json.Number:
			parsed, _ := value.Int64()
			return parsed
		}
	}
	return 0
}

func jwtSubject(token string) string {
	raw := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(token), "Bearer "))
	parts := strings.Split(raw, ".")
	if len(parts) < 2 {
		return ""
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return ""
	}
	var parsed map[string]any
	if err := json.Unmarshal(payload, &parsed); err != nil {
		return ""
	}
	return readString(parsed, "sub")
}
