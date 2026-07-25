package account

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math"
	"mime"
	"net/http"
	"net/http/httptrace"
	"net/url"
	"strings"
	"time"

	realmv1 "github.com/nimiplatform/nimi/runtime/gen/realm/v1"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/appregistry"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/jsonstrict"
	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
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
	LocalAppKernel      *localappkernel.Kernel
	AuditStore          *auditlog.Store
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

const realmRefreshTokenResponseMaxBytes int64 = 1 << 20

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
		WithLocalAppKernel(resolved.LocalAppKernel),
		WithAuditStore(resolved.AuditStore),
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
		realmv1.OauthAuthorizeOperation.ResolveBaseURL(realmBaseURL),
	)
	tokenURL := firstNonEmpty(
		cfg.TokenURL,
		realmv1.OauthTokenOperation.ResolveBaseURL(realmBaseURL),
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
		TokenURL:            normalizeRealmOperationEndpoint(tokenURL, realmv1.OauthTokenOperation),
		ClientID:            strings.TrimSpace(clientID),
		RedirectURI:         strings.TrimSpace(redirectURI),
		CustodyPartition:    strings.TrimSpace(custodyPartition),
		Custody:             cfg.Custody,
		HTTPClient:          httpClient,
		AppRegistry:         cfg.AppRegistry,
		AppSessionValidator: cfg.AppSessionValidator,
		LocalAppKernel:      cfg.LocalAppKernel,
		AuditStore:          cfg.AuditStore,
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
		tokenURL:   realmv1.RefreshTokenOperation.ResolveBaseURL(cfg.RealmBaseURL),
	}
}

func (r realmOAuthExchanger) Exchange(ctx context.Context, attempt LoginAttempt, code string) (AccountMaterial, error) {
	if strings.TrimSpace(r.tokenURL) == "" || strings.TrimSpace(r.clientID) == "" || r.httpClient == nil {
		return AccountMaterial{}, ErrLoginExchangeFailure
	}
	request := realmv1.OAuthTokenRequestDto{
		GrantType:    "authorization_code",
		ClientId:     r.clientID,
		Code:         strings.TrimSpace(code),
		CodeVerifier: attempt.PKCEVerifier,
		RedirectUri:  firstNonEmpty(attempt.RedirectURI, r.redirectURI),
	}
	return r.exchangeForm(ctx, request)
}

func (r realmOAuthExchanger) exchangeForm(ctx context.Context, carrier realmv1.OAuthTokenRequestDto) (AccountMaterial, error) {
	req, err := http.NewRequestWithContext(ctx, realmv1.OauthTokenOperation.Method(), r.tokenURL, strings.NewReader(carrier.FormValues().Encode()))
	if err != nil {
		return AccountMaterial{}, ErrLoginExchangeFailure
	}
	req.Header.Set("content-type", realmv1.OauthTokenOperation.RequestContentType())
	client := *r.httpClient
	client.CheckRedirect = func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	}
	resp, err := client.Do(req)
	if err != nil {
		return AccountMaterial{}, fmt.Errorf("%w: %v", ErrLoginExchangeFailure, err)
	}
	defer func() { _ = resp.Body.Close() }()
	return materialFromTokenResponse(resp)
}

func (r realmTokenRefresher) Refresh(ctx context.Context, material AccountMaterial) (AccountMaterial, error) {
	if strings.TrimSpace(r.tokenURL) == "" || strings.TrimSpace(material.RefreshToken) == "" || r.httpClient == nil {
		return AccountMaterial{}, ErrLoginExchangeFailure
	}
	body, err := json.Marshal(realmv1.RefreshTokenDto{RefreshToken: material.RefreshToken})
	if err != nil {
		return AccountMaterial{}, newRefreshFailure(refreshFailurePreDispatch, err)
	}
	req, err := http.NewRequestWithContext(ctx, realmv1.RefreshTokenOperation.Method(), r.tokenURL, bytes.NewReader(body))
	if err != nil {
		return AccountMaterial{}, newRefreshFailure(refreshFailurePreDispatch, err)
	}
	req.Header.Set("content-type", realmv1.RefreshTokenOperation.RequestContentType())
	wroteRequest := false
	req = req.WithContext(httptrace.WithClientTrace(req.Context(), &httptrace.ClientTrace{
		WroteRequest: func(httptrace.WroteRequestInfo) { wroteRequest = true },
	}))
	client := *r.httpClient
	client.CheckRedirect = func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	}
	resp, err := client.Do(req)
	if err != nil {
		if wroteRequest {
			return AccountMaterial{}, newRefreshFailure(refreshFailureOutcomeAmbiguous, err)
		}
		return AccountMaterial{}, newRefreshFailure(refreshFailurePreDispatch, err)
	}
	defer func() { _ = resp.Body.Close() }()
	return materialFromRefreshTokenResponse(resp, material)
}

func materialFromRefreshTokenResponse(resp *http.Response, current AccountMaterial) (AccountMaterial, error) {
	if resp == nil || resp.Body == nil {
		return AccountMaterial{}, newRefreshFailure(refreshFailureOutcomeAmbiguous, errors.New("refresh response is unavailable"))
	}
	if resp.StatusCode != realmv1.RefreshTokenOperation.SuccessStatus() {
		disposition := refreshFailureContractInvalid
		switch resp.StatusCode {
		case http.StatusBadRequest, http.StatusUnauthorized, http.StatusForbidden, http.StatusUnprocessableEntity:
			disposition = refreshFailureTokenInvalid
		case http.StatusRequestTimeout, http.StatusBadGateway, http.StatusServiceUnavailable, http.StatusGatewayTimeout:
			disposition = refreshFailureOutcomeAmbiguous
		default:
			if resp.StatusCode >= 500 {
				disposition = refreshFailureOutcomeAmbiguous
			}
		}
		return AccountMaterial{}, newRefreshFailure(disposition, fmt.Errorf("refresh endpoint returned http %d", resp.StatusCode))
	}
	mediaType, _, err := mime.ParseMediaType(resp.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		return AccountMaterial{}, newRefreshFailure(refreshFailureContractInvalid, errors.New("refresh response content type is invalid"))
	}
	limited := &io.LimitedReader{R: resp.Body, N: realmRefreshTokenResponseMaxBytes + 1}
	payload, err := io.ReadAll(limited)
	if err != nil {
		return AccountMaterial{}, newRefreshFailure(refreshFailureOutcomeAmbiguous, fmt.Errorf("read refresh response: %w", err))
	}
	if int64(len(payload)) > realmRefreshTokenResponseMaxBytes {
		return AccountMaterial{}, newRefreshFailure(refreshFailureContractInvalid, errors.New("refresh response exceeds fixed bound"))
	}
	var parsed realmv1.AuthTokensDto
	if err := jsonstrict.Decode(payload, &parsed); err != nil {
		return AccountMaterial{}, newRefreshFailure(refreshFailureContractInvalid, fmt.Errorf("decode refresh response: %w", err))
	}

	accessToken := strings.TrimSpace(parsed.AccessToken)
	refreshToken := strings.TrimSpace(parsed.RefreshToken)
	if accessToken == "" || accessToken != parsed.AccessToken ||
		refreshToken == "" || refreshToken != parsed.RefreshToken ||
		parsed.TokenType != "Bearer" || parsed.ExpiresIn <= 0 || math.Trunc(parsed.ExpiresIn) != parsed.ExpiresIn || parsed.User != nil ||
		refreshToken == strings.TrimSpace(current.RefreshToken) ||
		current.RefreshTokenHashes[refreshHash(refreshToken)] {
		return AccountMaterial{}, newRefreshFailure(refreshFailureContractInvalid, errors.New("invalid refresh response"))
	}
	maxExpiresInSeconds := int64((time.Duration(1<<63 - 1)) / time.Second)
	if parsed.ExpiresIn > float64(maxExpiresInSeconds) {
		return AccountMaterial{}, newRefreshFailure(refreshFailureContractInvalid, errors.New("invalid refresh response"))
	}
	expiresIn := int64(parsed.ExpiresIn)

	// Preserve every Runtime-custodied identity projection. Only the rotated
	// token pair and its expiry may change here; refresh_internal commits the
	// resulting material to custody before exposing the authenticated state.
	next := current
	next.WorkspaceMemberships = cloneWorkspaceMemberships(current.WorkspaceMemberships)
	next.RefreshTokenHashes = copyRefreshHashes(current.RefreshTokenHashes)
	next.AccessToken = accessToken
	next.AccessTokenExpires = time.Now().UTC().Add(time.Duration(expiresIn) * time.Second)
	next.RefreshToken = refreshToken
	return next, nil
}

func materialFromTokenResponse(resp *http.Response) (AccountMaterial, error) {
	if resp == nil || resp.Body == nil {
		return AccountMaterial{}, fmt.Errorf("%w: token response is unavailable", ErrLoginExchangeFailure)
	}
	if resp.StatusCode != realmv1.OauthTokenOperation.SuccessStatus() {
		return AccountMaterial{}, fmt.Errorf("%w: http %d", ErrLoginExchangeFailure, resp.StatusCode)
	}
	mediaType, _, mediaErr := mime.ParseMediaType(resp.Header.Get("Content-Type"))
	if mediaErr != nil || mediaType != "application/json" {
		return AccountMaterial{}, fmt.Errorf("%w: token response content type is invalid", ErrLoginExchangeFailure)
	}
	payload, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20+1))
	if err != nil {
		return AccountMaterial{}, fmt.Errorf("%w: read response", ErrLoginExchangeFailure)
	}
	if len(payload) > 1<<20 {
		return AccountMaterial{}, fmt.Errorf("%w: invalid token response JSON", ErrLoginExchangeFailure)
	}
	var parsed realmv1.OAuthTokenResponseDto
	if err := jsonstrict.Decode(payload, &parsed); err != nil {
		return AccountMaterial{}, fmt.Errorf("%w: decode response", ErrLoginExchangeFailure)
	}
	accessToken := strings.TrimSpace(parsed.AccessToken)
	refreshToken := strings.TrimSpace(parsed.RefreshToken)
	accountID := strings.TrimSpace(parsed.AccountId)
	displayName := strings.TrimSpace(parsed.DisplayName)
	realmEnvironmentID := strings.TrimSpace(parsed.RealmEnvironmentId)
	if accessToken == "" ||
		refreshToken == "" ||
		parsed.TokenType != "Bearer" ||
		parsed.ExpiresIn <= 0 ||
		math.Trunc(parsed.ExpiresIn) != parsed.ExpiresIn ||
		parsed.ExpiresIn > float64((time.Duration(1<<63-1))/time.Second) ||
		accountID == "" ||
		displayName == "" ||
		realmEnvironmentID == "" {
		return AccountMaterial{}, fmt.Errorf("%w: invalid token response", ErrLoginExchangeFailure)
	}
	expiresAt := time.Now().UTC().Add(time.Duration(int64(parsed.ExpiresIn)) * time.Second)
	return AccountMaterial{
		AccountID:          accountID,
		DisplayName:        displayName,
		RealmEnvironmentID: realmEnvironmentID,
		AccessToken:        accessToken,
		AccessTokenExpires: expiresAt,
		RefreshToken:       refreshToken,
	}, nil
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
// .nimi/spec/realm/external-realm.md (R-OAUTH-002 /
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
	query := realmv1.OauthAuthorizeQuery{
		ResponseType:        "code",
		ClientId:            r.clientID,
		RedirectUri:         callbackURL,
		CodeChallenge:       attempt.PKCEChallenge,
		CodeChallengeMethod: "S256",
		State:               attempt.State,
	}
	u.RawQuery = query.Values().Encode()
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
	if strings.TrimSpace(u.Hostname()) == "" || u.User != nil || u.Opaque != "" {
		return ""
	}
	if strings.EqualFold(u.Hostname(), "auth.nimi.invalid") {
		return ""
	}
	if u.Fragment != "" || u.RawQuery != "" {
		return ""
	}
	if strings.TrimRight(u.EscapedPath(), "/") != realmv1.OauthAuthorizeOperation.Path() {
		return ""
	}
	q := u.Query()
	if q.Has("desktop_callback") || q.Has("desktop_state") {
		return ""
	}
	return u.String()
}

func normalizeRealmOperationEndpoint(raw string, operation realmv1.OperationDescriptor) string {
	value := strings.TrimSpace(raw)
	if value == "" {
		return ""
	}
	u, err := url.Parse(value)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || strings.TrimSpace(u.Hostname()) == "" || u.User != nil || u.Opaque != "" || u.Fragment != "" || u.RawQuery != "" {
		return ""
	}
	if strings.TrimRight(u.EscapedPath(), "/") != operation.Path() {
		return ""
	}
	return u.String()
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
