package account

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/appregistry"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type ProductionConfig struct {
	RealmBaseURL        string
	AuthorizationURL    string
	TokenURL            string
	ClientID            string
	RedirectURI         string
	CustodyPartition    string
	Custody             Custody
	HTTPClient          *http.Client
	AppRegistry         *appregistry.Registry
	AppSessionValidator AppSessionValidator
}

type custodySnapshot struct {
	AccountID            string                        `json:"accountId"`
	DisplayName          string                        `json:"displayName,omitempty"`
	RealmEnvironmentID   string                        `json:"realmEnvironmentId,omitempty"`
	WorkspaceMemberships []workspaceMembershipSnapshot `json:"workspaceMemberships,omitempty"`
	AccessToken          string                        `json:"accessToken"`
	AccessTokenExpires   string                        `json:"accessTokenExpires"`
	RefreshToken         string                        `json:"refreshToken"`
	RefreshTokenHashes   map[string]bool               `json:"refreshTokenHashes,omitempty"`
}

type workspaceMembershipSnapshot struct {
	WorkspaceID        string            `json:"workspaceId"`
	MembershipState    string            `json:"membershipState"`
	RealmEnvironmentID string            `json:"realmEnvironmentId,omitempty"`
	ObservedAt         string            `json:"observedAt,omitempty"`
	DisplayMetadata    map[string]string `json:"displayMetadata,omitempty"`
}

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

type realmTokenResponse struct {
	AccessToken          string                          `json:"access_token"`
	RefreshToken         string                          `json:"refresh_token"`
	TokenType            string                          `json:"token_type"`
	ExpiresIn            *int64                          `json:"expires_in"`
	AccountID            string                          `json:"account_id"`
	DisplayName          string                          `json:"display_name"`
	RealmEnvironmentID   string                          `json:"realm_environment_id"`
	WorkspaceMemberships []realmWorkspaceMembershipShape `json:"workspace_memberships,omitempty"`
}

type realmWorkspaceMembershipShape struct {
	WorkspaceID        string            `json:"workspace_id"`
	MembershipState    string            `json:"membership_state"`
	RealmEnvironmentID string            `json:"realm_environment_id"`
	ObservedAt         string            `json:"observed_at"`
	DisplayMetadata    map[string]string `json:"display_metadata,omitempty"`
}

func NewProduction(logger *slog.Logger, cfg ProductionConfig) *Service {
	resolved := resolveProductionConfig(cfg)
	if strings.TrimSpace(resolved.AuthorizationURL) == "" && logger != nil {
		logger.Warn("runtime account production activation has no Realm auth base URL; login exchange will fail closed")
	}
	custody := Custody(unavailableCustody{})
	if resolved.Custody != nil && resolved.CustodyPartition != "" {
		custody = resolved.Custody
	}
	return New(logger,
		WithProductionActivation(),
		WithCustody(custody),
		WithCustodyPartition(resolved.CustodyPartition),
		WithLoginExchanger(newRealmOAuthExchanger(resolved)),
		WithRefresher(newRealmTokenRefresher(resolved)),
		WithPresenceVerifier(newProductionPresenceVerifier(resolved)),
		WithRealmHTTPClient(resolved.HTTPClient),
		WithRealmBaseURL(resolved.RealmBaseURL),
		WithAppRegistry(resolved.AppRegistry),
		WithAppSessionValidator(resolved.AppSessionValidator),
	)
}

func newProductionPresenceVerifier(cfg ProductionConfig) PresenceVerifier {
	return newHostPresenceVerifier(
		newPlatformHostPresenceProvider(),
		newRealmOAuthPresenceProvider(realmOAuthPresenceProviderConfig{
			AuthorizationURL: cfg.AuthorizationURL,
			TokenURL:         cfg.TokenURL,
			ClientID:         cfg.ClientID,
			HTTPClient:       cfg.HTTPClient,
		}),
	)
}

func resolveProductionConfig(cfg ProductionConfig) ProductionConfig {
	realmBaseURL := trimURL(cfg.RealmBaseURL)
	// Authorization URL must point at the realm OAuth authorize endpoint
	// (R-OAUTH-002 / R-OAUTH-011). Web-relay shapes (NIMI_WEB_URL with
	// #/login?desktop_callback=...) are no longer admitted; the runtime
	// hands the user agent directly to the realm authorize endpoint and
	// the realm 302-redirects to the loopback redirect_uri.
	authorizationURL := firstNonEmpty(
		cfg.AuthorizationURL,
		joinURL(realmBaseURL, "/api/auth/oauth/authorize"),
	)
	tokenURL := firstNonEmpty(
		cfg.TokenURL,
		joinURL(realmBaseURL, "/api/auth/oauth/token"),
	)
	clientID := firstNonEmpty(
		cfg.ClientID,
		"nimi-desktop",
	)
	redirectURI := firstNonEmpty(
		cfg.RedirectURI,
		"http://localhost:46373/oauth/callback",
	)
	custodyPartition := strings.TrimSpace(cfg.CustodyPartition)
	httpClient := cfg.HTTPClient
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 20 * time.Second}
	}
	return ProductionConfig{
		RealmBaseURL:        realmBaseURL,
		AuthorizationURL:    normalizeOAuthAuthorizeEndpoint(authorizationURL),
		TokenURL:            strings.TrimSpace(tokenURL),
		ClientID:            strings.TrimSpace(clientID),
		RedirectURI:         strings.TrimSpace(redirectURI),
		CustodyPartition:    strings.TrimSpace(custodyPartition),
		Custody:             cfg.Custody,
		HTTPClient:          httpClient,
		AppRegistry:         cfg.AppRegistry,
		AppSessionValidator: cfg.AppSessionValidator,
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
	defer func() { _ = resp.Body.Close() }()
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
	defer func() { _ = resp.Body.Close() }()
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
	var parsed realmTokenResponse
	if err := json.Unmarshal(payload, &parsed); err != nil {
		return AccountMaterial{}, fmt.Errorf("%w: decode response", ErrLoginExchangeFailure)
	}
	accessToken := strings.TrimSpace(parsed.AccessToken)
	refreshToken := strings.TrimSpace(parsed.RefreshToken)
	accountID := strings.TrimSpace(parsed.AccountID)
	displayName := strings.TrimSpace(parsed.DisplayName)
	realmEnvironmentID := strings.TrimSpace(parsed.RealmEnvironmentID)
	if accessToken == "" ||
		refreshToken == "" ||
		parsed.TokenType != "Bearer" ||
		parsed.ExpiresIn == nil ||
		*parsed.ExpiresIn < 0 ||
		accountID == "" ||
		displayName == "" ||
		realmEnvironmentID == "" {
		return AccountMaterial{}, fmt.Errorf("%w: invalid token response", ErrLoginExchangeFailure)
	}
	expiresAt := time.Now().UTC().Add(time.Duration(*parsed.ExpiresIn) * time.Second)
	memberships, err := workspaceMembershipsFromTokenPayload(parsed.WorkspaceMemberships, realmEnvironmentID)
	if err != nil {
		return AccountMaterial{}, err
	}
	return AccountMaterial{
		AccountID:            accountID,
		DisplayName:          displayName,
		RealmEnvironmentID:   realmEnvironmentID,
		WorkspaceMemberships: memberships,
		AccessToken:          accessToken,
		AccessTokenExpires:   expiresAt,
		RefreshToken:         refreshToken,
	}, nil
}

func workspaceMembershipsFromTokenPayload(items []realmWorkspaceMembershipShape, defaultRealmEnvironmentID string) ([]*runtimev1.WorkspaceMembershipProjection, error) {
	if len(items) == 0 {
		return nil, nil
	}
	out := make([]*runtimev1.WorkspaceMembershipProjection, 0, len(items))
	for _, item := range items {
		workspaceID := strings.TrimSpace(item.WorkspaceID)
		if workspaceID == "" {
			return nil, fmt.Errorf("%w: invalid workspace membership response", ErrLoginExchangeFailure)
		}
		var observedAt *timestamppb.Timestamp
		if text := strings.TrimSpace(item.ObservedAt); text != "" {
			parsedTime, err := time.Parse(time.RFC3339Nano, text)
			if err != nil {
				return nil, fmt.Errorf("%w: invalid workspace membership response", ErrLoginExchangeFailure)
			}
			observedAt = timestamppb.New(parsedTime)
		}
		out = append(out, &runtimev1.WorkspaceMembershipProjection{
			WorkspaceId:        workspaceID,
			MembershipState:    workspaceMembershipStateFromString(item.MembershipState),
			RealmEnvironmentId: firstNonEmpty(item.RealmEnvironmentID, defaultRealmEnvironmentID),
			ObservedAt:         observedAt,
			DisplayMetadata:    item.DisplayMetadata,
		})
	}
	return out, nil
}

func workspaceMembershipsFromSnapshots(in []workspaceMembershipSnapshot) []*runtimev1.WorkspaceMembershipProjection {
	out := make([]*runtimev1.WorkspaceMembershipProjection, 0, len(in))
	for _, snapshot := range in {
		var observedAt *timestamppb.Timestamp
		if snapshot.ObservedAt != "" {
			parsed, _ := time.Parse(time.RFC3339Nano, snapshot.ObservedAt)
			observedAt = timestamppb.New(parsed)
		}
		out = append(out, &runtimev1.WorkspaceMembershipProjection{
			WorkspaceId:        snapshot.WorkspaceID,
			MembershipState:    workspaceMembershipStateFromString(snapshot.MembershipState),
			RealmEnvironmentId: snapshot.RealmEnvironmentID,
			ObservedAt:         observedAt,
			DisplayMetadata:    snapshot.DisplayMetadata,
		})
	}
	return out
}

func workspaceMembershipSnapshotsFromProjections(in []*runtimev1.WorkspaceMembershipProjection) []workspaceMembershipSnapshot {
	out := make([]workspaceMembershipSnapshot, 0, len(in))
	for _, projection := range in {
		if projection == nil {
			continue
		}
		observedAt := ""
		if projection.GetObservedAt() != nil {
			observedAt = projection.GetObservedAt().AsTime().UTC().Format(time.RFC3339Nano)
		}
		out = append(out, workspaceMembershipSnapshot{
			WorkspaceID:        projection.GetWorkspaceId(),
			MembershipState:    workspaceMembershipStateString(projection.GetMembershipState()),
			RealmEnvironmentID: projection.GetRealmEnvironmentId(),
			ObservedAt:         observedAt,
			DisplayMetadata:    projection.GetDisplayMetadata(),
		})
	}
	return out
}

// AuthorizationURL constructs the realm OAuth 2.0 authorize URL the user
// agent must visit. The shape is normative against
// .nimi/spec/realm/kernel/oauth-authority-contract.md (R-OAUTH-002 /
// R-OAUTH-003 / R-OAUTH-005 / R-OAUTH-011): response_type=code,
// client_id, redirect_uri, code_challenge, code_challenge_method=S256,
// state. No desktop_callback / desktop_state web-relay fragment is
// admitted.
func (r realmOAuthExchanger) AuthorizationURL(attempt LoginAttempt) string {
	if strings.TrimSpace(r.authorizationURL) == "" {
		return ""
	}
	u, err := url.Parse(r.authorizationURL)
	if err != nil {
		return ""
	}
	callbackURL := firstNonEmpty(attempt.RedirectURI, r.redirectURI)
	q := u.Query()
	q.Set("response_type", "code")
	q.Set("client_id", r.clientID)
	q.Set("redirect_uri", callbackURL)
	q.Set("code_challenge", attempt.PKCEChallenge)
	q.Set("code_challenge_method", "S256")
	q.Set("state", attempt.State)
	u.RawQuery = q.Encode()
	u.Fragment = ""
	return u.String()
}

func normalizeOAuthAuthorizeEndpoint(raw string) string {
	value := strings.TrimSpace(raw)
	if value == "" {
		return ""
	}
	if strings.Contains(value, "desktop_callback=") ||
		strings.Contains(value, "desktop_state=") ||
		strings.Contains(value, "#/login") {
		return ""
	}
	u, err := url.Parse(value)
	if err != nil {
		return ""
	}
	if u.Scheme != "https" && u.Scheme != "http" {
		return ""
	}
	if strings.TrimSpace(u.Host) == "" {
		return ""
	}
	if strings.EqualFold(u.Hostname(), "auth.nimi.invalid") {
		return ""
	}
	if u.Fragment != "" {
		return ""
	}
	if !strings.HasSuffix(strings.TrimRight(u.EscapedPath(), "/"), "/oauth/authorize") {
		return ""
	}
	q := u.Query()
	if q.Has("desktop_callback") || q.Has("desktop_state") {
		return ""
	}
	return u.String()
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

func workspaceMembershipStateFromString(value string) runtimev1.WorkspaceMembershipState {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "active":
		return runtimev1.WorkspaceMembershipState_WORKSPACE_MEMBERSHIP_STATE_ACTIVE
	case "suspended":
		return runtimev1.WorkspaceMembershipState_WORKSPACE_MEMBERSHIP_STATE_SUSPENDED
	case "revoked":
		return runtimev1.WorkspaceMembershipState_WORKSPACE_MEMBERSHIP_STATE_REVOKED
	default:
		return runtimev1.WorkspaceMembershipState_WORKSPACE_MEMBERSHIP_STATE_UNKNOWN
	}
}

func workspaceMembershipStateString(value runtimev1.WorkspaceMembershipState) string {
	switch value {
	case runtimev1.WorkspaceMembershipState_WORKSPACE_MEMBERSHIP_STATE_ACTIVE:
		return "active"
	case runtimev1.WorkspaceMembershipState_WORKSPACE_MEMBERSHIP_STATE_SUSPENDED:
		return "suspended"
	case runtimev1.WorkspaceMembershipState_WORKSPACE_MEMBERSHIP_STATE_REVOKED:
		return "revoked"
	default:
		return "unknown"
	}
}
