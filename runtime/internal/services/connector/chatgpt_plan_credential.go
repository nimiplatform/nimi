package connector

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"sync"
	"time"
	"unicode"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/jsonstrict"
	"google.golang.org/grpc/codes"
)

const (
	// ChatGPTPlanProvider is the Nimi-issued SIWC ChatGPT-plan Cloud provider.
	ChatGPTPlanProvider = "openai_chatgpt_plan"
	// ChatGPTPlanAuthProfile is the only sealed OAuth profile admitted for it.
	ChatGPTPlanAuthProfile = "openai_chatgpt_plan"
	// ChatGPTPlanEndpoint is the fixed public execution resource.
	ChatGPTPlanEndpoint = "https://api.openai.com/v1"
	// ChatGPTPlanReauthorizeHint tells the protected host to start explicit
	// browser reauthorization for the same account registration.
	ChatGPTPlanReauthorizeHint = "reauthorize_chatgpt_plan_connector"

	chatGPTPlanIssuer              = "https://auth.openai.com"
	chatGPTPlanResource            = "https://api.openai.com/v1"
	chatGPTPlanDirectScope         = "chatgpt.tokens.use.direct"
	chatGPTPlanOfflineScope        = "offline_access"
	chatGPTPlanCredentialSchema    = "nimi.openai_chatgpt_plan.siwc/v1"
	chatGPTPlanRequestAccessSchema = "nimi.openai_chatgpt_plan.request-access/v1"
	chatGPTPlanDynamicClientID     = "dynamic_agent_client"
	chatGPTPlanRenewalWindow       = 5 * time.Minute
	chatGPTPlanMaxTokenBytes       = 16 << 10
	chatGPTPlanMaxIdentityBytes    = 512

	chatGPTPlanStateActive                  = "active"
	chatGPTPlanStateRefreshPending          = "refresh_pending"
	chatGPTPlanStateReauthorizationRequired = "reauthorization_required"

	// What is known about the provider session once a record needs explicit
	// reauthorization: ended when the provider rejected its only refresh token,
	// unconfirmed after an uncertain exchange whose token may have rotated.
	chatGPTPlanRemoteSessionEnded       = "ended"
	chatGPTPlanRemoteSessionUnconfirmed = "unconfirmed"

	// A renewal that issued no token set is retried only after this bounded
	// backoff; an access token that remains valid keeps serving meanwhile.
	chatGPTPlanRenewalBackoffMin = 5 * time.Second
	chatGPTPlanRenewalBackoffMax = 5 * time.Minute
	chatGPTPlanAccessUseMargin   = 30 * time.Second

	// chatGPTPlanMaxPriorSessions bounds the replaced sessions kept only for
	// revocation; replacing more leaves remote sign-out unconfirmed.
	chatGPTPlanMaxPriorSessions = 4

	chatGPTPlanReplaceConnectorHint = "replace_chatgpt_plan_connector"
)

// chatGPTPlanCredential is the sealed SIWC custody record. Only the Runtime
// Connector owner reads it; the protected host writes its token fields once per
// initial or explicit reauthorization and Runtime owns later rotation.
type chatGPTPlanCredential struct {
	Schema          string   `json:"schema"`
	Issuer          string   `json:"issuer"`
	Subject         string   `json:"subject"`
	Email           string   `json:"email,omitempty"`
	ClientID        string   `json:"client_id"`
	HostID          string   `json:"ext_agent_host_id"`
	AccessToken     string   `json:"access_token,omitempty"`
	RefreshToken    string   `json:"refresh_token,omitempty"`
	TokenType       string   `json:"token_type,omitempty"`
	Scopes          []string `json:"scopes"`
	AccessExpiresAt int64    `json:"access_expires_at,omitempty"`
	SavedAt         string   `json:"saved_at,omitempty"`
	Generation      uint64   `json:"generation"`
	State           string   `json:"state"`
	// RemoteSession, RevocationToken and RegistrationUnusable exist only when
	// reauthorization is required. RevocationToken keeps a refresh token that
	// may already have rotated for best-effort revocation on deletion; it is
	// never renewed. RegistrationUnusable records that the token endpoint
	// rejected the issued client, so signing in again with it cannot help.
	RemoteSession        string `json:"remote_session,omitempty"`
	RevocationToken      string `json:"revocation_token,omitempty"`
	RegistrationUnusable bool   `json:"registration_unusable,omitempty"`
	// Signing in again starts another provider session without ending the one
	// it replaces. PriorSessions keeps the refresh token of each replaced
	// session sealed only for revocation on deletion; it is never renewed.
	// PriorSessionUnconfirmed records a replaced session that deletion cannot
	// end with certainty: its token may have rotated, or it no longer fit.
	PriorSessions           []string `json:"prior_sessions,omitempty"`
	PriorSessionUnconfirmed bool     `json:"prior_session_unconfirmed,omitempty"`
}

// chatGPTPlanAuthorization is the host-written authorization result. Runtime
// derives generation, state and expiry itself.
type chatGPTPlanAuthorization struct {
	Schema       string   `json:"schema"`
	Issuer       string   `json:"issuer"`
	Subject      string   `json:"subject"`
	Email        string   `json:"email,omitempty"`
	ClientID     string   `json:"client_id"`
	HostID       string   `json:"ext_agent_host_id"`
	AccessToken  string   `json:"access_token"`
	RefreshToken string   `json:"refresh_token"`
	TokenType    string   `json:"token_type"`
	Scopes       []string `json:"scopes"`
	SavedAt      string   `json:"saved_at"`
}

type chatGPTPlanAccessClaims struct {
	Issuer   string
	Audience []string
	Subject  string
	ClientID string
	Scopes   []string
	Expires  int64
}

// IsChatGPTPlanRecord reports whether a Connector belongs to the SIWC route.
func IsChatGPTPlanRecord(record ConnectorRecord) bool {
	return strings.TrimSpace(record.Provider) == ChatGPTPlanProvider
}

// normalizeChatGPTPlanAuthorization validates one host-written authorization
// and returns the sealed payload Runtime persists. previous is the existing
// sealed payload for explicit reauthorization, or empty on first creation.
func normalizeChatGPTPlanAuthorization(raw string, previous string, now time.Time) (string, error) {
	var authorization chatGPTPlanAuthorization
	if len(raw) > 64<<10 || jsonstrict.Decode([]byte(raw), &authorization) != nil {
		return "", chatGPTPlanInvalid("authorization payload is not the exact SIWC record")
	}
	if authorization.Schema != chatGPTPlanCredentialSchema || authorization.Issuer != chatGPTPlanIssuer {
		return "", chatGPTPlanInvalid("authorization issuer or schema is not admitted")
	}
	if !chatGPTPlanIdentityValue(authorization.Subject) || !chatGPTPlanIdentityValue(authorization.ClientID) ||
		authorization.ClientID == chatGPTPlanDynamicClientID || !validChatGPTPlanHostID(authorization.HostID) {
		return "", chatGPTPlanInvalid("authorization registration identity is incomplete")
	}
	if authorization.Email != "" && (!chatGPTPlanIdentityValue(authorization.Email) || !strings.Contains(authorization.Email, "@")) {
		return "", chatGPTPlanInvalid("authorization account label is invalid")
	}
	if !strings.EqualFold(authorization.TokenType, "Bearer") || !chatGPTPlanTokenValue(authorization.RefreshToken) {
		return "", chatGPTPlanInvalid("authorization token set is incomplete")
	}
	if !slices.Contains(authorization.Scopes, chatGPTPlanDirectScope) || !slices.Contains(authorization.Scopes, chatGPTPlanOfflineScope) {
		return "", chatGPTPlanInvalid("ChatGPT plan usage or renewal scope was not granted")
	}
	savedAt, err := time.Parse(time.RFC3339, authorization.SavedAt)
	if err != nil || savedAt.After(now.Add(5*time.Minute)) {
		return "", chatGPTPlanInvalid("authorization receipt time is invalid")
	}
	claims, err := chatGPTPlanAccessTokenClaims(authorization.AccessToken)
	if err != nil {
		return "", err
	}
	if err := claims.bind(authorization.ClientID, authorization.Subject, now); err != nil {
		return "", err
	}
	credential := chatGPTPlanCredential{
		Schema: chatGPTPlanCredentialSchema, Issuer: authorization.Issuer, Subject: authorization.Subject,
		Email: authorization.Email, ClientID: authorization.ClientID, HostID: authorization.HostID,
		AccessToken: authorization.AccessToken, RefreshToken: authorization.RefreshToken, TokenType: "Bearer",
		Scopes: normalizedChatGPTPlanScopes(authorization.Scopes), AccessExpiresAt: claims.Expires,
		SavedAt: savedAt.UTC().Format(time.RFC3339), Generation: 1, State: chatGPTPlanStateActive,
	}
	if strings.TrimSpace(previous) != "" {
		existing, err := decodeChatGPTPlanCredential(previous)
		if err != nil {
			return "", err
		}
		// Explicit reauthorization never moves a registration to another
		// issued client or account; a different account needs another Connector.
		if existing.ClientID != credential.ClientID || existing.Subject != credential.Subject || existing.HostID != credential.HostID {
			return "", chatGPTPlanInvalid("reauthorization identity does not match this Connector registration")
		}
		credential.Generation = existing.Generation + 1
		credential.PriorSessions, credential.PriorSessionUnconfirmed = existing.replacedSessions(credential.RefreshToken)
	}
	return encodeChatGPTPlanCredential(credential)
}

// replacedSessions returns what an explicit reauthorization keeps about the
// sessions it replaces, given the refresh token of the new session.
func (credential chatGPTPlanCredential) replacedSessions(next string) ([]string, bool) {
	sessions := slices.Clone(credential.PriorSessions)
	unconfirmed := credential.PriorSessionUnconfirmed
	keep := func(token string) {
		if chatGPTPlanTokenValue(token) && token != next && !slices.Contains(sessions, token) {
			sessions = append(sessions, token)
		}
	}
	switch credential.State {
	case chatGPTPlanStateActive:
		keep(credential.RefreshToken)
	case chatGPTPlanStateRefreshPending:
		// An interrupted renewal may already have rotated this token.
		keep(credential.RefreshToken)
		unconfirmed = true
	case chatGPTPlanStateReauthorizationRequired:
		if credential.RemoteSession != chatGPTPlanRemoteSessionEnded {
			keep(credential.RevocationToken)
			unconfirmed = true
		}
	}
	if len(sessions) > chatGPTPlanMaxPriorSessions {
		sessions = slices.Clone(sessions[len(sessions)-chatGPTPlanMaxPriorSessions:])
		unconfirmed = true
	}
	return sessions, unconfirmed
}

func decodeChatGPTPlanCredential(raw string) (chatGPTPlanCredential, error) {
	var credential chatGPTPlanCredential
	if jsonstrict.Decode([]byte(raw), &credential) != nil || credential.Schema != chatGPTPlanCredentialSchema ||
		credential.Issuer != chatGPTPlanIssuer || !chatGPTPlanIdentityValue(credential.Subject) ||
		!chatGPTPlanIdentityValue(credential.ClientID) || !validChatGPTPlanHostID(credential.HostID) || credential.Generation == 0 {
		return chatGPTPlanCredential{}, chatGPTPlanInvalid("sealed SIWC custody record is invalid")
	}
	if len(credential.PriorSessions) > chatGPTPlanMaxPriorSessions {
		return chatGPTPlanCredential{}, chatGPTPlanInvalid("sealed SIWC record keeps too many replaced sessions")
	}
	for _, token := range credential.PriorSessions {
		if !chatGPTPlanTokenValue(token) {
			return chatGPTPlanCredential{}, chatGPTPlanInvalid("replaced SIWC session token is invalid")
		}
	}
	switch credential.State {
	case chatGPTPlanStateActive, chatGPTPlanStateRefreshPending:
		if !chatGPTPlanTokenValue(credential.AccessToken) || !chatGPTPlanTokenValue(credential.RefreshToken) || credential.AccessExpiresAt <= 0 {
			return chatGPTPlanCredential{}, chatGPTPlanInvalid("sealed SIWC token set is incomplete")
		}
		if credential.RemoteSession != "" || credential.RevocationToken != "" || credential.RegistrationUnusable {
			return chatGPTPlanCredential{}, chatGPTPlanInvalid("renewable SIWC record carries retired session facts")
		}
	case chatGPTPlanStateReauthorizationRequired:
		if credential.AccessToken != "" || credential.RefreshToken != "" {
			return chatGPTPlanCredential{}, chatGPTPlanInvalid("unusable SIWC tokens were retained")
		}
		switch credential.RemoteSession {
		case chatGPTPlanRemoteSessionEnded:
			if credential.RevocationToken != "" {
				return chatGPTPlanCredential{}, chatGPTPlanInvalid("an ended SIWC session retained a revocation token")
			}
		case "", chatGPTPlanRemoteSessionUnconfirmed:
			// An older record without a session fact counts as unconfirmed.
			if credential.RevocationToken != "" && !chatGPTPlanTokenValue(credential.RevocationToken) {
				return chatGPTPlanCredential{}, chatGPTPlanInvalid("SIWC revocation token is invalid")
			}
		default:
			return chatGPTPlanCredential{}, chatGPTPlanInvalid("sealed SIWC session fact is unknown")
		}
	default:
		return chatGPTPlanCredential{}, chatGPTPlanInvalid("sealed SIWC state is unknown")
	}
	return credential, nil
}

func encodeChatGPTPlanCredential(credential chatGPTPlanCredential) (string, error) {
	payload, err := json.Marshal(credential)
	if err != nil {
		return "", fmt.Errorf("encode SIWC custody: %w", err)
	}
	return string(payload), nil
}

func chatGPTPlanAccessTokenClaims(token string) (chatGPTPlanAccessClaims, error) {
	if !chatGPTPlanTokenValue(token) {
		return chatGPTPlanAccessClaims{}, chatGPTPlanInvalid("access token is missing")
	}
	parts := strings.Split(token, ".")
	if len(parts) != 3 || parts[1] == "" {
		return chatGPTPlanAccessClaims{}, chatGPTPlanInvalid("access token is not a signed JWT")
	}
	decoded, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return chatGPTPlanAccessClaims{}, chatGPTPlanInvalid("access token claims are not base64url")
	}
	var raw struct {
		Issuer   string          `json:"iss"`
		Audience json.RawMessage `json:"aud"`
		Subject  string          `json:"sub"`
		ClientID string          `json:"client_id"`
		Scope    string          `json:"scope"`
		Expires  int64           `json:"exp"`
	}
	if jsonstrict.RejectDuplicateKeys(decoded) != nil || json.Unmarshal(decoded, &raw) != nil {
		return chatGPTPlanAccessClaims{}, chatGPTPlanInvalid("access token claims are invalid")
	}
	claims := chatGPTPlanAccessClaims{Issuer: raw.Issuer, Subject: raw.Subject, ClientID: raw.ClientID, Scopes: strings.Fields(raw.Scope), Expires: raw.Expires}
	var single string
	if json.Unmarshal(raw.Audience, &single) == nil {
		claims.Audience = []string{single}
	} else if json.Unmarshal(raw.Audience, &claims.Audience) != nil {
		return chatGPTPlanAccessClaims{}, chatGPTPlanInvalid("access token audience is invalid")
	}
	return claims, nil
}

// bind accepts only an unexpired token for the exact registration, account,
// resource audience and granted ChatGPT plan scope.
func (claims chatGPTPlanAccessClaims) bind(clientID string, subject string, now time.Time) error {
	if claims.Issuer != chatGPTPlanIssuer || !slices.Contains(claims.Audience, chatGPTPlanResource) {
		return chatGPTPlanInvalid("access token issuer or resource audience does not match")
	}
	if claims.ClientID != clientID || claims.Subject != subject {
		return chatGPTPlanInvalid("access token is bound to another registration or account")
	}
	if !slices.Contains(claims.Scopes, chatGPTPlanDirectScope) {
		return chatGPTPlanInvalid("access token lacks ChatGPT plan usage scope")
	}
	if claims.Expires <= now.Unix() {
		return chatGPTPlanInvalid("access token is expired")
	}
	return nil
}

func normalizedChatGPTPlanScopes(scopes []string) []string {
	out := make([]string, 0, len(scopes))
	for _, scope := range scopes {
		if scope = strings.TrimSpace(scope); scope != "" && !slices.Contains(out, scope) {
			out = append(out, scope)
		}
	}
	slices.Sort(out)
	return out
}

func validChatGPTPlanHostID(value string) bool {
	if !chatGPTPlanIdentityValue(value) {
		return false
	}
	for _, prefix := range []string{"urn:uuid:", "urn:ietf:params:oauth:jwk-thumbprint:", "did:key:"} {
		if strings.HasPrefix(value, prefix) && len(value) > len(prefix) {
			return true
		}
	}
	return false
}

func chatGPTPlanIdentityValue(value string) bool {
	if value == "" || value != strings.TrimSpace(value) || len(value) > chatGPTPlanMaxIdentityBytes {
		return false
	}
	for _, char := range value {
		if unicode.IsControl(char) || unicode.IsSpace(char) {
			return false
		}
	}
	return true
}

func chatGPTPlanTokenValue(value string) bool {
	return value != "" && len(value) <= chatGPTPlanMaxTokenBytes && chatGPTPlanIdentityValueLong(value)
}

func chatGPTPlanIdentityValueLong(value string) bool {
	if value != strings.TrimSpace(value) {
		return false
	}
	for _, char := range value {
		if char < 0x21 || char > 0x7e {
			return false
		}
	}
	return true
}

// chatGPTPlanRefreshLocks serializes renewal for one Connector while leaving
// unrelated Connector operations free to use the store-wide mutex.
type chatGPTPlanRefreshLocks struct {
	mu    sync.Mutex
	locks map[string]*sync.Mutex
}

func (locks *chatGPTPlanRefreshLocks) lock(connectorID string) func() {
	locks.mu.Lock()
	if locks.locks == nil {
		locks.locks = make(map[string]*sync.Mutex)
	}
	lock := locks.locks[connectorID]
	if lock == nil {
		lock = &sync.Mutex{}
		locks.locks[connectorID] = lock
	}
	locks.mu.Unlock()
	lock.Lock()
	return lock.Unlock
}

// @nimi-authority: rule.nimi.runtime.ai-provider.chatgpt-plan-refresh-custody
// OpenChatGPTPlanAccessToken releases one request-scoped access token for an
// exact SIWC Connector. A token near expiry is renewed first; the rotated token
// set is committed to the same sealed record before any caller receives it.
func (s *ConnectorStore) OpenChatGPTPlanAccessToken(ctx context.Context, connectorID string) (string, error) {
	connectorID = strings.TrimSpace(connectorID)
	unlock := s.chatGPTPlanLocks.lock(connectorID)
	defer unlock()

	record, credential, err := s.loadChatGPTPlanCredential(connectorID)
	if err != nil {
		return "", err
	}
	now := s.now().UTC()
	switch credential.State {
	case chatGPTPlanStateReauthorizationRequired:
		return "", chatGPTPlanUnusable(credential)
	case chatGPTPlanStateRefreshPending:
		// A previous renewal was interrupted after its intent was committed.
		// Its refresh token may already have rotated, so never replay it.
		return "", s.requireChatGPTPlanReauthorization(record, credential, chatGPTPlanUncertainSession(credential.RefreshToken))
	}
	expires := time.Unix(credential.AccessExpiresAt, 0)
	if expires.After(now.Add(chatGPTPlanRenewalWindow)) {
		return credential.AccessToken, nil
	}
	// Inside the renewal window the committed access token may still carry a
	// request while a renewal that issued no token set waits for its retry.
	usable := expires.After(now.Add(chatGPTPlanAccessUseMargin))
	if retryAt, waiting := s.chatGPTPlanBackoff.pending(connectorID, now); waiting {
		if usable {
			return credential.AccessToken, nil
		}
		return "", chatGPTPlanRenewalUnavailable(chatGPTPlanRenewalTemporary, fmt.Errorf("renewal retry is deferred until %s", retryAt.Format(time.RFC3339)))
	}
	if s.chatGPTPlanRenewer == nil {
		return "", grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	pending := credential
	pending.State = chatGPTPlanStateRefreshPending
	if err := s.writeChatGPTPlanCredential(connectorID, pending); err != nil {
		return "", chatGPTPlanCustodyUnavailable(err)
	}
	// A dispatched renewal is finished and committed even if its caller stops
	// waiting; abandoning the exchange would leave a rotated token unknown.
	renewCtx, cancelRenewal := context.WithTimeout(context.WithoutCancel(ctx), chatGPTPlanOAuthTimeout)
	renewed, renewErr := s.chatGPTPlanRenewer.Renew(renewCtx, credential.ClientID, credential.RefreshToken)
	cancelRenewal()
	if renewErr != nil {
		switch disposition := chatGPTPlanRenewalDispositionOf(renewErr); disposition {
		case chatGPTPlanRenewalPreDispatch, chatGPTPlanRenewalTemporary, chatGPTPlanRenewalRedirected:
			// No token set was issued, so the committed generation stays
			// usable; renewal is retried only after bounded backoff.
			if err := s.writeChatGPTPlanCredential(connectorID, credential); err != nil {
				return "", chatGPTPlanCustodyUnavailable(err)
			}
			s.chatGPTPlanBackoff.fail(connectorID, now)
			if usable {
				return credential.AccessToken, nil
			}
			return "", chatGPTPlanRenewalUnavailable(disposition, renewErr)
		case chatGPTPlanRenewalTokenInvalid:
			return "", s.requireChatGPTPlanReauthorization(record, credential, chatGPTPlanEndedSession())
		case chatGPTPlanRenewalClientInvalid:
			return "", s.requireChatGPTPlanReauthorization(record, credential, chatGPTPlanUnusableRegistration(credential.RefreshToken))
		default:
			// The request left Runtime and its result is unknown: the token
			// may have rotated, so it is kept only for a later revocation.
			return "", s.requireChatGPTPlanReauthorization(record, credential, chatGPTPlanUncertainSession(credential.RefreshToken))
		}
	}
	next, err := credential.rotated(renewed, s.now().UTC())
	if err != nil {
		// The committed refresh token was consumed by an unusable replacement;
		// that replacement is kept only so deletion can try to revoke it.
		return "", s.requireChatGPTPlanReauthorization(record, credential, chatGPTPlanUncertainSession(renewed.RefreshToken))
	}
	if err := s.writeChatGPTPlanCredential(connectorID, next); err != nil {
		// The replacement token set cannot be committed; the marked record
		// makes the next use require explicit reauthorization.
		return "", chatGPTPlanCustodyUnavailable(err)
	}
	s.chatGPTPlanBackoff.clear(connectorID)
	return next.AccessToken, nil
}

// chatGPTPlanRenewalUnavailable reports a renewal that issued no token set
// while no unexpired access token remains to carry the request.
func chatGPTPlanRenewalUnavailable(disposition chatGPTPlanRenewalDisposition, err error) error {
	if disposition == chatGPTPlanRenewalRedirected {
		return grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_PROVIDER_ENDPOINT_FORBIDDEN, err, grpcerr.ReasonOptions{
			ActionHint: "retry_later", Message: "ChatGPT plan renewal endpoint redirected; the redirect was not followed",
		})
	}
	return grpcerr.WrapWithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE, err, grpcerr.ReasonOptions{
		ActionHint: "retry_later", Message: "ChatGPT plan credential renewal is temporarily unavailable",
	})
}

// chatGPTPlanRenewalBackoff bounds retries after renewals that issued no token
// set. It is process-local: a restart may retry once without waiting.
type chatGPTPlanRenewalBackoff struct {
	mu      sync.Mutex
	entries map[string]chatGPTPlanBackoffEntry
}

type chatGPTPlanBackoffEntry struct {
	retryAt time.Time
	delay   time.Duration
}

func (backoff *chatGPTPlanRenewalBackoff) pending(connectorID string, now time.Time) (time.Time, bool) {
	backoff.mu.Lock()
	defer backoff.mu.Unlock()
	entry, ok := backoff.entries[connectorID]
	return entry.retryAt, ok && now.Before(entry.retryAt)
}

func (backoff *chatGPTPlanRenewalBackoff) fail(connectorID string, now time.Time) {
	backoff.mu.Lock()
	defer backoff.mu.Unlock()
	if backoff.entries == nil {
		backoff.entries = make(map[string]chatGPTPlanBackoffEntry)
	}
	delay := chatGPTPlanRenewalBackoffMin
	if previous, ok := backoff.entries[connectorID]; ok {
		delay = min(previous.delay*2, chatGPTPlanRenewalBackoffMax)
	}
	backoff.entries[connectorID] = chatGPTPlanBackoffEntry{retryAt: now.Add(delay), delay: delay}
}

func (backoff *chatGPTPlanRenewalBackoff) clear(connectorID string) {
	backoff.mu.Lock()
	defer backoff.mu.Unlock()
	delete(backoff.entries, connectorID)
}

// CaptureChatGPTPlanRequestCredential captures only one request-scoped access
// token under the exact ScenarioJob reference. The rotating refresh token never
// leaves the Connector custody record.
func (s *ConnectorStore) CaptureChatGPTPlanRequestCredential(ctx context.Context, connectorID string, jobID string) (ConnectorRecord, string, error) {
	accessToken, err := s.OpenChatGPTPlanAccessToken(ctx, connectorID)
	if err != nil {
		return ConnectorRecord{}, "", err
	}
	claims, err := chatGPTPlanAccessTokenClaims(accessToken)
	if err != nil {
		return ConnectorRecord{}, "", err
	}
	payload, err := json.Marshal(map[string]any{
		"schema": chatGPTPlanRequestAccessSchema, "access_token": accessToken, "access_expires_at": claims.Expires,
	})
	if err != nil {
		return ConnectorRecord{}, "", fmt.Errorf("encode SIWC request credential: %w", err)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	record, found, err := s.getRecordLocked(connectorID)
	if err != nil {
		return ConnectorRecord{}, "", err
	}
	if !found || record.Status != runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE || !IsChatGPTPlanRecord(record) {
		return ConnectorRecord{}, "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONNECTOR_NOT_FOUND)
	}
	ref, err := scenarioJobCredentialCustodyRef(jobID)
	if err != nil {
		return ConnectorRecord{}, "", err
	}
	if err := s.writeSecretPayloadLocked(ref, string(payload)); err != nil {
		return ConnectorRecord{}, "", fmt.Errorf("write ScenarioJob credential custody: %w", err)
	}
	return record, ref, nil
}

// ChatGPTPlanRequestAccessToken opens a captured request-scoped SIWC access
// token. It never falls back to the Connector record and never renews.
func ChatGPTPlanRequestAccessToken(payload string, now time.Time) (string, error) {
	var captured struct {
		Schema          string `json:"schema"`
		AccessToken     string `json:"access_token"`
		AccessExpiresAt int64  `json:"access_expires_at"`
	}
	if jsonstrict.Decode([]byte(payload), &captured) != nil || captured.Schema != chatGPTPlanRequestAccessSchema || !chatGPTPlanTokenValue(captured.AccessToken) {
		return "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONNECTOR_CREDENTIAL_MISSING)
	}
	if captured.AccessExpiresAt <= now.Unix() {
		return "", grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONNECTOR_CREDENTIAL_MISSING, grpcerr.ReasonOptions{
			ActionHint: "retry_request", Message: "captured ChatGPT plan access expired before dispatch",
		})
	}
	return captured.AccessToken, nil
}

func (credential chatGPTPlanCredential) rotated(renewed ChatGPTPlanTokenSet, now time.Time) (chatGPTPlanCredential, error) {
	if !strings.EqualFold(renewed.TokenType, "Bearer") || !chatGPTPlanTokenValue(renewed.RefreshToken) {
		return chatGPTPlanCredential{}, chatGPTPlanInvalid("renewed token set is incomplete")
	}
	claims, err := chatGPTPlanAccessTokenClaims(renewed.AccessToken)
	if err != nil {
		return chatGPTPlanCredential{}, err
	}
	if err := claims.bind(credential.ClientID, credential.Subject, now); err != nil {
		return chatGPTPlanCredential{}, err
	}
	scopes := credential.Scopes
	if strings.TrimSpace(renewed.Scope) != "" {
		scopes = normalizedChatGPTPlanScopes(strings.Fields(renewed.Scope))
	}
	if !slices.Contains(scopes, chatGPTPlanDirectScope) || !slices.Contains(scopes, chatGPTPlanOfflineScope) {
		return chatGPTPlanCredential{}, chatGPTPlanInvalid("renewed grant lost ChatGPT plan usage or renewal scope")
	}
	next := credential
	next.AccessToken, next.RefreshToken, next.TokenType = renewed.AccessToken, renewed.RefreshToken, "Bearer"
	next.Scopes, next.AccessExpiresAt = scopes, claims.Expires
	next.SavedAt, next.Generation, next.State = now.Format(time.RFC3339), credential.Generation+1, chatGPTPlanStateActive
	return next, nil
}

func (s *ConnectorStore) loadChatGPTPlanCredential(connectorID string) (ConnectorRecord, chatGPTPlanCredential, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	record, found, err := s.getRecordLocked(connectorID)
	if err != nil {
		return ConnectorRecord{}, chatGPTPlanCredential{}, fmt.Errorf("load SIWC Connector: %w", err)
	}
	if !found || !IsChatGPTPlanRecord(record) || record.ProviderAuthProfile != ChatGPTPlanAuthProfile ||
		record.AuthKind != runtimev1.ConnectorAuthKind_CONNECTOR_AUTH_KIND_OAUTH_MANAGED {
		return ConnectorRecord{}, chatGPTPlanCredential{}, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONNECTOR_NOT_FOUND)
	}
	if record.Status != runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE {
		return ConnectorRecord{}, chatGPTPlanCredential{}, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONNECTOR_DISABLED)
	}
	payload, err := s.readStoredSecretPayloadLocked(record.ConnectorID)
	if err != nil {
		return ConnectorRecord{}, chatGPTPlanCredential{}, chatGPTPlanCustodyUnavailable(err)
	}
	if strings.TrimSpace(payload) == "" {
		return ConnectorRecord{}, chatGPTPlanCredential{}, chatGPTPlanReauthorizationRequired()
	}
	credential, err := decodeChatGPTPlanCredential(payload)
	if err != nil {
		return ConnectorRecord{}, chatGPTPlanCredential{}, err
	}
	return record, credential, nil
}

func (s *ConnectorStore) writeChatGPTPlanCredential(connectorID string, credential chatGPTPlanCredential) error {
	payload, err := encodeChatGPTPlanCredential(credential)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	// A Connector deleted during renewal must not regain custody material.
	if record, found, err := s.getRecordLocked(connectorID); err != nil {
		return err
	} else if !found || !IsChatGPTPlanRecord(record) {
		return fmt.Errorf("SIWC Connector %q is no longer present", connectorID)
	}
	return s.writeSecretPayloadLocked(connectorID, payload)
}

// chatGPTPlanSessionFact is what a reauthorization-required record keeps about
// the provider session and the issued registration.
type chatGPTPlanSessionFact struct {
	remoteSession        string
	revocationToken      string
	registrationUnusable bool
}

// chatGPTPlanEndedSession: the provider rejected the only refresh token with a
// documented unusable-token code, so no renewable session remains for it.
func chatGPTPlanEndedSession() chatGPTPlanSessionFact {
	return chatGPTPlanSessionFact{remoteSession: chatGPTPlanRemoteSessionEnded}
}

// chatGPTPlanUncertainSession: the exchange result is unknown. token may have
// rotated and is kept only for best-effort revocation.
func chatGPTPlanUncertainSession(token string) chatGPTPlanSessionFact {
	return chatGPTPlanSessionFact{remoteSession: chatGPTPlanRemoteSessionUnconfirmed, revocationToken: token}
}

// chatGPTPlanUnusableRegistration: invalid_client means signing in again with
// the same issued client cannot help; the Connector must be replaced.
func chatGPTPlanUnusableRegistration(token string) chatGPTPlanSessionFact {
	return chatGPTPlanSessionFact{remoteSession: chatGPTPlanRemoteSessionUnconfirmed, revocationToken: token, registrationUnusable: true}
}

// requireChatGPTPlanReauthorization clears usable tokens while retaining the
// registration identity and the session fact, then projects the Connector as
// needing explicit reauthorization through its credential flag.
func (s *ConnectorStore) requireChatGPTPlanReauthorization(record ConnectorRecord, credential chatGPTPlanCredential, fact chatGPTPlanSessionFact) error {
	cleared := credential
	cleared.AccessToken, cleared.RefreshToken, cleared.TokenType, cleared.AccessExpiresAt = "", "", "", 0
	cleared.State = chatGPTPlanStateReauthorizationRequired
	cleared.RemoteSession, cleared.RevocationToken, cleared.RegistrationUnusable = fact.remoteSession, "", fact.registrationUnusable
	if fact.remoteSession == chatGPTPlanRemoteSessionUnconfirmed && chatGPTPlanTokenValue(fact.revocationToken) {
		cleared.RevocationToken = fact.revocationToken
	}
	payload, err := encodeChatGPTPlanCredential(cleared)
	if err != nil {
		return chatGPTPlanCustodyUnavailable(err)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	records, err := s.loadRegistryLocked()
	if err != nil {
		return chatGPTPlanCustodyUnavailable(err)
	}
	index := slices.IndexFunc(records, func(candidate ConnectorRecord) bool {
		return candidate.ConnectorID == record.ConnectorID && !candidate.DeletePending && IsChatGPTPlanRecord(candidate)
	})
	if index < 0 {
		return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONNECTOR_NOT_FOUND)
	}
	if err := s.writeSecretPayloadLocked(record.ConnectorID, payload); err != nil {
		return chatGPTPlanCustodyUnavailable(err)
	}
	if records[index].HasCredential {
		records[index].HasCredential = false
		records[index].UpdatedAt = s.now().UnixMilli()
		if err := s.persistRegistryLocked(records); err != nil {
			return chatGPTPlanCustodyUnavailable(err)
		}
	}
	s.chatGPTPlanBackoff.clear(record.ConnectorID)
	return chatGPTPlanUnusable(cleared)
}

// chatGPTPlanUnusable reports the explicit action a reauthorization-required
// record needs: sign in again, or replace a Connector whose issued client the
// provider rejected.
func chatGPTPlanUnusable(credential chatGPTPlanCredential) error {
	if credential.RegistrationUnusable {
		return grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONNECTOR_INVALID, grpcerr.ReasonOptions{
			ActionHint: chatGPTPlanReplaceConnectorHint, Message: "ChatGPT plan rejected this sign-in registration; replace the Connector",
		})
	}
	return chatGPTPlanReauthorizationRequired()
}

func chatGPTPlanReauthorizationRequired() error {
	return grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONNECTOR_CREDENTIAL_MISSING, grpcerr.ReasonOptions{
		ActionHint: ChatGPTPlanReauthorizeHint, Message: "ChatGPT plan sign-in must be renewed explicitly",
	})
}

func chatGPTPlanCustodyUnavailable(err error) error {
	return grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, err, grpcerr.ReasonOptions{
		ActionHint: "retry_or_check_runtime_logs", Message: "ChatGPT plan credential custody is unavailable",
	})
}

func chatGPTPlanInvalid(detail string) error {
	return grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_INVALID, errors.New("SIWC credential: "+detail), grpcerr.ReasonOptions{})
}
