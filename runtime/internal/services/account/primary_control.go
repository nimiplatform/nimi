package account

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"math"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	realmv1 "github.com/nimiplatform/nimi/runtime/gen/realm/v1"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
)

// PrimaryRuntimeControl is an in-process owner binding. It contains no bearer
// or private key and is never projected to an App or management renderer.
type PrimaryRuntimeControl struct {
	mu                 sync.Mutex
	accountID, realmID string
	generation         uint64
	invalidated        <-chan struct{}
	binding            realmv1.PrimaryRuntimeBindingDto
	sessionID          string
	sequence           uint64
}

type PrimaryRuntimeControlState struct {
	AccountID, RealmEnvironmentID, RuntimeID, BindingID string
	AccountGeneration                                   uint64
	Invalidated                                         <-chan struct{}
}

// The deadline belongs to the validated contexts in this sync.
type PrimaryRuntimeSync struct {
	Projection        *realmv1.RuntimeConnectionSyncResultDto
	AuthorityDeadline time.Time
	ObservedAt        time.Time
}

// RemoteAccessSettingsOwner selects local configuration only. It conveys no
// authenticated caller authority; control still binds and refreshes through
// the Account owner before any peer can be established.
func (s *Service) RemoteAccessSettingsOwner() (accountID, realmID string, selected bool) {
	if s == nil || !s.isActivated() {
		return "", "", false
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.material.AccountID == "" || s.material.RealmEnvironmentID == "" || s.material.RefreshToken == "" {
		return "", "", false
	}
	switch s.state {
	case runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED, runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_EXPIRED, runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_REFRESH_PENDING:
		return s.material.AccountID, s.material.RealmEnvironmentID, true
	default:
		return "", "", false
	}
}

// Some OS monotonic clocks stop during suspend. Checking both clock views
// expires a slept host while the monotonic view still fences wall-clock rollback.
func PrimaryRuntimeDeadlineLive(deadline time.Time) bool {
	now := time.Now()
	return now.Before(deadline) && now.Round(0).Before(deadline)
}

func (c *PrimaryRuntimeControl) State() PrimaryRuntimeControlState {
	c.mu.Lock()
	defer c.mu.Unlock()
	return PrimaryRuntimeControlState{AccountID: c.accountID, RealmEnvironmentID: c.realmID, AccountGeneration: c.generation,
		RuntimeID: c.binding.RuntimeId, BindingID: c.binding.BindingId, Invalidated: c.invalidated}
}

// @nimi-authority: rule.nimi.runtime.remote-access.primary-control
func (s *Service) BindPrimaryRuntimeControl(ctx context.Context) (*PrimaryRuntimeControl, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	// Use the existing private credential owner to refresh its current login;
	// no synthetic Desktop principal or renderer bearer is constructed.
	if _, _, _, ok, err := s.realmUnaryCredential(ctx); err != nil || !ok {
		return nil, primaryFailure(codes.Unauthenticated)
	}
	p, generation, invalidated, ok := s.BindAuthenticatedRuntimeGeneration(ctx)
	if !ok {
		return nil, primaryFailure(codes.Unauthenticated)
	}
	var snapshot realmv1.PrimaryRuntimeSnapshotDto
	if err := s.primaryAccountCall(ctx, p.AccountId, p.RealmEnvironmentId, generation, realmv1.GetMyPrimaryRuntimeOperation, nil, &snapshot); err != nil {
		return nil, err
	}
	if snapshot.AccountId != p.AccountId || snapshot.Binding == nil || !validPrimaryBinding(snapshot.Binding) {
		return nil, primaryFailure(codes.FailedPrecondition)
	}
	c := &PrimaryRuntimeControl{accountID: p.AccountId, realmID: p.RealmEnvironmentId, generation: generation, invalidated: invalidated, binding: *snapshot.Binding}
	if _, err := s.signPrimaryControl(ctx, c, nil); err != nil {
		return nil, err
	}
	return c, nil
}

// @nimi-authority: rule.nimi.runtime.remote-access.primary-control
func (s *Service) RegisterPrimaryRuntimeControl(ctx context.Context, c *PrimaryRuntimeControl) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	signedAt := float64(s.now().UnixMilli())
	signature, err := s.signPrimaryControl(ctx, c, []any{"register", c.accountID, c.binding.RuntimeId, c.binding.BindingId, "", primarySignalHash([]string{}), signedAt})
	if err != nil {
		return err
	}
	body := realmv1.PrimaryRuntimeHostProofDto{ExpectedAccountId: c.accountID, RuntimeId: c.binding.RuntimeId,
		BindingId: c.binding.BindingId, SignedAt: signedAt, Signature: signature}
	var result realmv1.RuntimeControlRegisterResultDto
	if err := s.primaryAccountCall(ctx, c.accountID, c.realmID, c.generation, realmv1.RegisterPrimaryRuntimeControlOperation, &body, &result); err != nil {
		return err
	}
	if !validPrimaryID(result.ControlSessionId) {
		return primaryFailure(codes.Internal)
	}
	c.sessionID, c.sequence = result.ControlSessionId, 0
	return nil
}

// @nimi-authority: rule.nimi.runtime.remote-access.primary-control
func (s *Service) HeartbeatPrimaryRuntimeControl(ctx context.Context, c *PrimaryRuntimeControl, revision string) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if c.sessionID == "" {
		return "", primaryFailure(codes.FailedPrecondition)
	}
	c.sequence++
	sequence, signedAt := float64(c.sequence), float64(s.now().UnixMilli())
	signature, err := s.signPrimaryControl(ctx, c, []any{"heartbeat", c.accountID, c.binding.RuntimeId, c.binding.BindingId, c.sessionID, sequence, revision, signedAt})
	if err != nil {
		return "", err
	}
	body := realmv1.RuntimeControlHeartbeatDto{BindingId: c.binding.BindingId, ControlSessionId: c.sessionID,
		Sequence: sequence, SignalRevision: revision, SignedAt: signedAt, Signature: signature}
	var result realmv1.RuntimeControlHeartbeatResultDto
	if err := s.primaryRequest(ctx, "", realmv1.HeartbeatPrimaryRuntimeControlOperation, &body, &result); err != nil {
		return "", err
	}
	select {
	case <-c.invalidated:
		return "", primaryFailure(codes.Unauthenticated)
	default:
	}
	switch result.Status {
	case "idle", "sync_required", "register_required":
		return result.Status, nil
	default:
		return "", primaryFailure(codes.Internal)
	}
}

// @nimi-authority: rule.nimi.runtime.remote-access.primary-control
func (s *Service) SyncPrimaryRuntimeConnections(ctx context.Context, c *PrimaryRuntimeControl, contextIDs []string) (*PrimaryRuntimeSync, error) {
	if c == nil || len(contextIDs) > 64 {
		return nil, primaryFailure(codes.InvalidArgument)
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if c.sessionID == "" {
		return nil, primaryFailure(codes.Unavailable)
	}
	ids := append([]string{}, contextIDs...)
	observedAt := time.Now()
	requested := make(map[string]bool, len(ids))
	for _, id := range ids {
		if !validPrimaryID(id) || requested[id] {
			return nil, primaryFailure(codes.InvalidArgument)
		}
		requested[id] = true
	}
	signedAt := float64(s.now().UnixMilli())
	proof, err := s.signPrimaryControl(ctx, c, []any{"signal-sync", c.accountID, c.binding.RuntimeId, c.binding.BindingId, c.sessionID, primarySignalHash(ids), signedAt})
	if err != nil {
		return nil, err
	}
	body := realmv1.RuntimeConnectionSyncDto{ExpectedAccountId: c.accountID, RuntimeId: c.binding.RuntimeId, BindingId: c.binding.BindingId,
		ControlSessionId: c.sessionID, ContextIds: ids, SignedAt: signedAt, Signature: proof}
	var result realmv1.RuntimeConnectionSyncResultDto
	if err = s.primaryAccountCall(ctx, c.accountID, c.realmID, c.generation, realmv1.SyncPrimaryRuntimeConnectionsOperation, &body, &result); err != nil {
		return nil, err
	}
	serverTime, err := time.Parse(time.RFC3339Nano, result.ServerTime)
	expiry, expiryErr := time.Parse(time.RFC3339Nano, result.AuthorizationExpiresAt)
	validity := expiry.Sub(serverTime)
	deadline := observedAt.Add(validity)
	if err != nil || expiryErr != nil || validity <= 0 || validity > time.Minute || !PrimaryRuntimeDeadlineLive(deadline) ||
		(result.SignalRevision != "" && !validPrimaryID(result.SignalRevision)) || len(result.Offers) > 16 || len(result.Contexts) > len(ids) {
		return nil, primaryFailure(codes.Internal)
	}
	for _, item := range result.Contexts {
		if !requested[item.ContextId] || !validRemoteClientContext(c, &item, serverTime) {
			return nil, primaryFailure(codes.Internal)
		}
		delete(requested, item.ContextId)
	}
	seen := make(map[string]bool)
	for _, offer := range result.Offers {
		expires, parseErr := time.Parse(time.RFC3339Nano, offer.ExpiresAt)
		if !validPrimaryID(offer.ConnectionId) || seen[offer.ConnectionId] || !strings.HasPrefix(offer.OfferSdp, "v=0\r\n") || len(offer.OfferSdp) > 32768 ||
			parseErr != nil || !expires.After(serverTime) || !validRemoteClientContext(c, offer.Context, serverTime) {
			return nil, primaryFailure(codes.Internal)
		}
		seen[offer.ConnectionId] = true
	}
	return &PrimaryRuntimeSync{Projection: &result, AuthorityDeadline: deadline, ObservedAt: observedAt}, nil
}

func (s *Service) AnswerPrimaryRuntimeConnection(ctx context.Context, c *PrimaryRuntimeControl, connectionID, answer, rejection string) error {
	if c == nil || !validPrimaryID(connectionID) || len(answer) > 32768 || (rejection != "" && rejection != "SOURCE_NOT_ALLOWED" && rejection != "DIRECT_CONNECTION_UNAVAILABLE") ||
		(rejection == "" && !strings.HasPrefix(answer, "v=0\r\n")) || (rejection != "" && answer != "") {
		return primaryFailure(codes.InvalidArgument)
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if c.sessionID == "" {
		return primaryFailure(codes.Unavailable)
	}
	signedAt := float64(s.now().UnixMilli())
	proof, err := s.signPrimaryControl(ctx, c, []any{"signal-answer", c.accountID, c.binding.RuntimeId, c.binding.BindingId, c.sessionID, primarySignalHash([]string{connectionID, answer, rejection}), signedAt})
	if err != nil {
		return err
	}
	body := realmv1.RuntimeConnectionAnswerDto{ExpectedAccountId: c.accountID, RuntimeId: c.binding.RuntimeId, BindingId: c.binding.BindingId,
		ControlSessionId: c.sessionID, SignedAt: signedAt, Signature: proof, ConnectionId: connectionID, AnswerSdp: answer, RejectionReason: rejection}
	var result realmv1.RuntimeConnectionStateDto
	if err = s.primaryAccountCall(ctx, c.accountID, c.realmID, c.generation, realmv1.AnswerPrimaryRuntimeConnectionOperation, &body, &result); err != nil {
		return err
	}
	expected := "answered"
	if rejection != "" {
		expected = "rejected"
	}
	if result.ConnectionId != connectionID || result.BindingId != c.binding.BindingId || result.Status != expected || result.AnswerSdp != answer || result.RejectionReason != rejection {
		return primaryFailure(codes.Internal)
	}
	return nil
}

func (s *Service) signPrimaryControl(ctx context.Context, c *PrimaryRuntimeControl, fields []any) (string, error) {
	p, generation, ok := s.AuthenticatedRuntimeSecurityContext(ctx)
	if !ok || generation != c.generation || p.AccountId != c.accountID || p.RealmEnvironmentId != c.realmID {
		return "", primaryFailure(codes.Unauthenticated)
	}
	s.primaryMu.Lock()
	defer s.primaryMu.Unlock()
	keys, _, err := s.loadPrimaryAccountKeys(ctx, c.accountID, c.realmID)
	if err != nil {
		return "", err
	}
	defer clearPrimaryKeys(keys)
	key := keys.Active
	if !primaryKeyMatches(key, &c.binding) {
		key = keys.Pending
	}
	if !primaryKeyMatches(key, &c.binding) {
		return "", primaryFailure(codes.FailedPrecondition)
	}
	if fields == nil {
		return "", nil
	}
	private := ed25519.NewKeyFromSeed(key.Seed)
	defer clear(private)
	payload, _ := json.Marshal(append([]any{"nimi.primary-runtime/v1", c.realmID}, fields...))
	return base64.RawURLEncoding.EncodeToString(ed25519.Sign(private, payload)), nil
}

func primarySignalHash(fields []string) string {
	encoded, _ := json.Marshal(fields)
	hash := sha256.Sum256(encoded)
	return hex.EncodeToString(hash[:])
}

func validRemoteClientContext(c *PrimaryRuntimeControl, item *realmv1.RuntimeClientContextDto, serverTime time.Time) bool {
	if item == nil || item.AccountId != c.accountID || item.RealmEnvironmentId != c.realmID || !validPrimaryID(item.ContextId) ||
		item.AppId == "" || item.ClientId == "" || item.Source == nil || item.Primary == nil {
		return false
	}
	expires, err := time.Parse(time.RFC3339Nano, item.ExpiresAt)
	if err != nil || !expires.After(serverTime) {
		return false
	}
	source, primary := item.Source, item.Primary
	if primary.RuntimeId != c.binding.RuntimeId || primary.BindingId != c.binding.BindingId || primary.PublicKey != c.binding.PublicKey ||
		source.AppId != item.AppId || source.ClientId != item.ClientId || source.SourceRevision < 1 || math.Trunc(source.SourceRevision) != source.SourceRevision ||
		(source.Role != "app" && source.Role != "official_manager") {
		return false
	}
	origin, err := url.Parse(source.Origin)
	// @nimi-authority: rule.nimi.platform.remote-clients.android-development
	// Realm owns development-only admission. This boundary validates its exact
	// source projection without interpreting a private-use scheme as a Web origin.
	if source.Kind == "android-dev-scheme" {
		callback, callbackErr := url.Parse(source.RedirectUri)
		if err != nil || callbackErr != nil || source.Role != "app" {
			return false
		}
		validScheme, _ := regexp.MatchString(`^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$`, callback.Scheme)
		return validScheme && source.Origin == callback.Scheme+":/" && origin.String() == source.Origin &&
			callback.Host == "" && callback.User == nil && callback.Opaque == "" && callback.RawQuery == "" && !callback.ForceQuery && callback.Fragment == "" &&
			strings.HasPrefix(callback.Path, "/") && !strings.HasPrefix(callback.Path, "//") && callback.String() == source.RedirectUri
	}
	if err != nil || origin.Scheme != "https" || origin.Host == "" || origin.User != nil || origin.Path != "" || origin.RawQuery != "" || origin.Fragment != "" {
		return false
	}
	callback, err := url.Parse(source.RedirectUri)
	return err == nil && callback.Scheme == origin.Scheme && callback.Host == origin.Host && callback.User == nil && callback.RawQuery == "" && callback.Fragment == ""
}
