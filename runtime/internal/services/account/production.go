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
	"net"
	"net/http"
	"net/http/httptrace"
	"net/url"
	"strings"
	"sync/atomic"
	"time"

	realmv1 "github.com/nimiplatform/nimi/runtime/gen/realm/v1"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/appregistry"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/jsonstrict"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const freshAccountSelectionPresencePurpose = "nimi.account.switch"

type ProductionConfig struct {
	PrimarySecrets   protectedlocal.BinarySecretStore
	PrimaryKeyScope  string
	RealmBaseURL     string
	RealmRealtimeURL string
	AuthorizationURL string
	TokenURL         string
	ClientID         string
	RedirectURI      string
	CustodyPartition string
	Custody          Custody
	HTTPClient       *http.Client
	AppRegistry      *appregistry.Registry
	AuditStore       *auditlog.Store
}

type custodySnapshot struct {
	AccountID            string                        `json:"accountId"`
	DisplayName          string                        `json:"displayName,omitempty"`
	CurrentUserHandle    string                        `json:"currentUserHandle,omitempty"`
	CurrentUserAvatarURL *string                       `json:"currentUserAvatarUrl,omitempty"`
	RealmEnvironmentID   string                        `json:"realmEnvironmentId,omitempty"`
	RealmOrigin          string                        `json:"realmOrigin,omitempty"`
	WorkspaceMemberships []workspaceMembershipSnapshot `json:"workspaceMemberships,omitempty"`
	AccessToken              string                        `json:"accessToken"`
	AccessTokenExpires       string                        `json:"accessTokenExpires"`
	RefreshToken             string                        `json:"refreshToken"`
	RefreshTokenHashes       map[string]bool               `json:"refreshTokenHashes,omitempty"`
	OnlineCredentialsCleared bool                          `json:"onlineCredentialsCleared,omitempty"`
	PendingRevocation        bool                          `json:"pendingRevocation,omitempty"`
	PendingRealmDeletion     *realmAccountDeletionSnapshot `json:"pendingRealmDeletion,omitempty"`
}

type realmAccountDeletionSnapshot struct {
	AccountID   string `json:"accountId"`
	OperationID string `json:"operationId"`
	DeletedAt   string `json:"deletedAt"`
	Reason      string `json:"reason"`
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
	realmOrigin      string
	authorizationURL string
	tokenURL         string
	clientID         string
	redirectURI      string
}

type realmTokenRefresher struct {
	httpClient *http.Client
	tokenURL   string
	now        func() time.Time
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
		func(s *Service) {
			s.primarySecrets, s.primaryKeyScope = resolved.PrimarySecrets, resolved.PrimaryKeyScope
		},
		WithCustody(custody),
		WithCustodyPartition(resolved.CustodyPartition),
		WithLoginExchanger(newRealmOAuthExchanger(resolved)),
		WithRefresher(newRealmTokenRefresher(resolved)),
		WithPresenceVerifier(newProductionPresenceVerifier(resolved)),
		WithRealmHTTPClient(resolved.HTTPClient),
		WithRealmBaseURL(resolved.RealmBaseURL),
		WithRealmRealtimeURL(resolved.RealmRealtimeURL),
		WithAppRegistry(resolved.AppRegistry),
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
	realmRealtimeURL := trimURL(cfg.RealmRealtimeURL)
	// Runtime resolves the canonical Realm authorize endpoint and hands it to
	// the browser host without constructing a Web login or relay URL.
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
		PrimarySecrets:   cfg.PrimarySecrets,
		PrimaryKeyScope:  strings.TrimSpace(cfg.PrimaryKeyScope),
		RealmBaseURL:     realmBaseURL,
		RealmRealtimeURL: realmRealtimeURL,
		AuthorizationURL: normalizeOAuthAuthorizeEndpoint(authorizationURL),
		TokenURL:         normalizeRealmOperationEndpoint(tokenURL, realmv1.OauthTokenOperation),
		ClientID:         strings.TrimSpace(clientID),
		RedirectURI:      strings.TrimSpace(redirectURI),
		CustodyPartition: strings.TrimSpace(custodyPartition),
		Custody:          cfg.Custody,
		HTTPClient:       httpClient,
		AppRegistry:      cfg.AppRegistry,
		AuditStore:       cfg.AuditStore,
	}
}

func newRealmOAuthExchanger(cfg ProductionConfig) realmOAuthExchanger {
	return realmOAuthExchanger{
		httpClient:       cfg.HTTPClient,
		realmOrigin:      cfg.RealmBaseURL,
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
	material, err := r.exchangeForm(ctx, request)
	if err != nil {
		return AccountMaterial{}, err
	}
	profile, profileErr := fetchCurrentUserProfile(ctx, r.httpClient, r.realmOrigin, material.AccessToken)
	if profileErr == nil && profile.AccountID == material.AccountID {
		material.DisplayName = profile.Display.DisplayName
		material.CurrentUserHandle = profile.Display.Handle
		material.CurrentUserAvatarURL = profile.Display.AvatarURL
	}
	return material, nil
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
		return AccountMaterial{}, newTransientLoginExchangeFailure(err)
	}
	defer func() { _ = resp.Body.Close() }()
	material, parseErr := materialFromTokenResponse(resp)
	if parseErr != nil {
		return AccountMaterial{}, parseErr
	}
	material.RealmOrigin = trimURL(r.realmOrigin)
	return material, nil
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
	var dispatched atomic.Bool
	req = req.WithContext(httptrace.WithClientTrace(req.Context(), &httptrace.ClientTrace{
		WroteHeaders: func() { dispatched.Store(true) },
		WroteRequest: func(httptrace.WroteRequestInfo) { dispatched.Store(true) },
	}))
	client := *r.httpClient
	client.CheckRedirect = func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	}
	resp, err := client.Do(req)
	if err != nil {
		if dispatched.Load() {
			return AccountMaterial{}, newRefreshFailure(refreshFailureOutcomeAmbiguous, err)
		}
		return AccountMaterial{}, newRefreshFailure(refreshFailurePreDispatch, err)
	}
	defer func() { _ = resp.Body.Close() }()
	return materialFromRefreshTokenResponseAt(resp, material, r.now)
}

// @nimi-authority: rule.nimi.runtime.protected-session.r031
func materialFromRefreshTokenResponse(resp *http.Response, current AccountMaterial) (AccountMaterial, error) {
	return materialFromRefreshTokenResponseAt(resp, current, time.Now)
}

func materialFromRefreshTokenResponseAt(resp *http.Response, current AccountMaterial, nowFn func() time.Time) (AccountMaterial, error) {
	if resp == nil || resp.Body == nil {
		return AccountMaterial{}, newRefreshFailure(refreshFailureOutcomeAmbiguous, errors.New("refresh response is unavailable"))
	}
	if resp.StatusCode != realmv1.RefreshTokenOperation.SuccessStatus() {
		ownerError, validOwnerError := readRefreshAuthError(resp)
		// Realm's auth rate limiter rejects before entering the refresh owner.
		// A generic 503 (including AUTH_TOKEN_VERIFICATION_UNAVAILABLE) is not
		// equivalent: its Redis rotation may have committed before a lost reply.
		if resp.StatusCode == http.StatusTooManyRequests {
			if validOwnerError && ownerError.ReasonCode == "AUTH_RATE_LIMITED" {
				return AccountMaterial{}, newRefreshFailure(refreshFailurePreDispatch, errors.New("refresh rate limited before execution"))
			}
			return AccountMaterial{}, newRefreshFailure(refreshFailureOutcomeAmbiguous, errors.New("unclassified refresh rate limit response"))
		}
		if validOwnerError {
			if accountDeleted, ok := realmAccountDeletedRefreshFailureFromOwnerError(ownerError, current.AccountID); ok {
				return AccountMaterial{}, accountDeleted
			}
		}
		disposition := refreshFailureContractInvalid
		switch resp.StatusCode {
		case http.StatusBadRequest, http.StatusUnauthorized, http.StatusForbidden, http.StatusUnprocessableEntity:
			if validOwnerError {
				switch ownerError.ReasonCode {
				case "AUTH_INVALID_REFRESH_TOKEN", "AUTH_REFRESH_TOKEN_REVOKED", "AUTH_REFRESH_TOKEN_REPLAY_DETECTED",
					"AUTH_TOKEN_EXPIRED", "AUTH_INVALID_CREDENTIALS", "AUTH_INVALID_TOKEN_TYPE", "AUTH_SESSION_REVOKED",
					"AUTH_ACCOUNT_NOT_FOUND", "AUTH_ACCOUNT_RESTRICTED":
					disposition = refreshFailureTokenInvalid
				}
			}
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
	// Realm's atomic family authority rejects reuse. This client validates
	// the active rotation, without duplicating an unbounded family history.
	if accessToken == "" || accessToken != parsed.AccessToken ||
		refreshToken == "" || refreshToken != parsed.RefreshToken ||
		parsed.TokenType != "Bearer" || parsed.ExpiresIn <= 0 || math.Trunc(parsed.ExpiresIn) != parsed.ExpiresIn || parsed.User != nil ||
		refreshToken == strings.TrimSpace(current.RefreshToken) {
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
	next.RefreshTokenHashes = nil
	if nowFn == nil {
		nowFn = time.Now
	}
	next.AccessToken = accessToken
	next.AccessTokenExpires = nowFn().UTC().Add(time.Duration(expiresIn) * time.Second)
	next.RefreshToken = refreshToken
	return next, nil
}

func readRefreshAuthError(resp *http.Response) (realmv1.AuthErrorDto, bool) {
	var ownerError realmv1.AuthErrorDto
	mediaType, _, err := mime.ParseMediaType(resp.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		return ownerError, false
	}
	payload, err := io.ReadAll(io.LimitReader(resp.Body, realmRefreshTokenResponseMaxBytes+1))
	if err != nil || int64(len(payload)) > realmRefreshTokenResponseMaxBytes {
		return ownerError, false
	}
	if err := jsonstrict.Decode(payload, &ownerError); err != nil || ownerError.StatusCode != float64(resp.StatusCode) || strings.TrimSpace(ownerError.Message) == "" || ownerError.Message != strings.TrimSpace(ownerError.Message) || strings.TrimSpace(ownerError.TraceId) == "" || ownerError.TraceId != strings.TrimSpace(ownerError.TraceId) {
		return ownerError, false
	}
	return ownerError, true
}

// @nimi-authority: rule.nimi.runtime.protected-session.r033
func realmAccountDeletedRefreshFailureFromOwnerError(ownerError realmv1.AuthErrorDto, accountID string) (error, bool) {
	if ownerError.StatusCode != http.StatusUnauthorized || ownerError.ReasonCode != RealmAccountDeletedReason || strings.TrimSpace(accountID) == "" || ownerError.OperationId == "" || ownerError.DeletedAt == "" {
		return nil, false
	}
	deletedAt, err := time.Parse(time.RFC3339Nano, ownerError.DeletedAt)
	if err != nil {
		return nil, false
	}
	observed, err := NewObservedRealmAccountDeletedResult(strings.TrimSpace(accountID), ownerError.OperationId, deletedAt, ownerError.ReasonCode)
	if err != nil {
		return nil, false
	}
	return newRealmAccountDeletedRefreshFailure(observed), true
}

func isTransientLoginExchangeHTTPStatus(statusCode int) bool {
	return statusCode == http.StatusRequestTimeout ||
		statusCode == http.StatusTooManyRequests ||
		(statusCode >= http.StatusInternalServerError && statusCode <= 599)
}

func isRetryableOAuthTokenErrorResponse(resp *http.Response) bool {
	if resp == nil || resp.Body == nil || resp.StatusCode != http.StatusBadRequest {
		return false
	}
	mediaType, _, err := mime.ParseMediaType(resp.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		return false
	}
	payload, err := io.ReadAll(io.LimitReader(resp.Body, realmRefreshTokenResponseMaxBytes+1))
	if err != nil || int64(len(payload)) > realmRefreshTokenResponseMaxBytes {
		return false
	}
	var oauthErr realmv1.OAuthErrorResponseDto
	if err := jsonstrict.Decode(payload, &oauthErr); err != nil {
		return false
	}
	if oauthErr.StatusCode != 0 && oauthErr.StatusCode != float64(resp.StatusCode) {
		return false
	}
	if strings.TrimSpace(oauthErr.DeletedAt) != "" || strings.TrimSpace(oauthErr.OperationId) != "" {
		return false
	}
	if oauthErr.Error != "invalid_grant" {
		return false
	}
	switch oauthErr.ReasonCode {
	case "", "AUTH_INVALID_OAUTH_CREDENTIAL", "AUTH_TOKEN_EXPIRED", "AUTH_INVALID_REQUEST":
		return true
	default:
		return false
	}
}

func materialFromTokenResponse(resp *http.Response) (AccountMaterial, error) {
	if resp == nil || resp.Body == nil {
		return AccountMaterial{}, newTransientLoginExchangeFailure(errors.New("token response is unavailable"))
	}
	if resp.StatusCode != realmv1.OauthTokenOperation.SuccessStatus() {
		statusErr := fmt.Errorf("http %d", resp.StatusCode)
		if isTransientLoginExchangeHTTPStatus(resp.StatusCode) {
			return AccountMaterial{}, newTransientLoginExchangeFailure(statusErr)
		}
		if isRetryableOAuthTokenErrorResponse(resp) {
			return AccountMaterial{}, newRetryableOAuthGrantFailure(statusErr)
		}
		return AccountMaterial{}, fmt.Errorf("%w: %v", ErrLoginExchangeFailure, statusErr)
	}
	mediaType, _, mediaErr := mime.ParseMediaType(resp.Header.Get("Content-Type"))
	if mediaErr != nil || mediaType != "application/json" {
		return AccountMaterial{}, fmt.Errorf("%w: token response content type is invalid", ErrLoginExchangeFailure)
	}
	payload, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20+1))
	if err != nil {
		return AccountMaterial{}, newTransientLoginExchangeFailure(fmt.Errorf("read response: %w", err))
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
// agent must visit. The shape is normative against the externally owned
// rule.nimi.runtime.protected-session.r028: response_type=code,
// client_id, redirect_uri, code_challenge, code_challenge_method=S256,
// state. No Web relay fragment is admitted.
// @nimi-authority: rule.nimi.runtime.protected-session.r028
// @nimi-authority: rule.nimi.runtime.protected-session.r031
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
	if attempt.PromptLogin {
		values := u.Query()
		values.Set("prompt", "login")
		values.Set("presence_purpose", freshAccountSelectionPresencePurpose)
		values.Set("presence_nonce", attempt.Nonce)
		u.RawQuery = values.Encode()
	}
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
	if !isSecureOrLoopbackEndpoint(u) {
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
	if err != nil || !isSecureOrLoopbackEndpoint(u) || strings.TrimSpace(u.Hostname()) == "" || u.User != nil || u.Opaque != "" || u.Fragment != "" || u.RawQuery != "" {
		return ""
	}
	if strings.TrimRight(u.EscapedPath(), "/") != operation.Path() {
		return ""
	}
	return u.String()
}

func isSecureOrLoopbackEndpoint(endpoint *url.URL) bool {
	if endpoint == nil {
		return false
	}
	if endpoint.Scheme == "https" {
		return true
	}
	if endpoint.Scheme != "http" {
		return false
	}
	hostname := strings.TrimSpace(endpoint.Hostname())
	if strings.EqualFold(hostname, "localhost") {
		return true
	}
	address := net.ParseIP(hostname)
	return address != nil && address.IsLoopback()
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
