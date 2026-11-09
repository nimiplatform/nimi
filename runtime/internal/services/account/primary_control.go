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
	deadline           time.Time
}

type PrimaryRuntimeControlState struct {
	AccountID, RealmEnvironmentID, RuntimeID, BindingID string
	AccountGeneration                                   uint64
	Invalidated                                         <-chan struct{}
	Deadline                                            time.Time
}

// The deadline is captured with the validated context projection. A later
// host-only lease renewal must not extend an old client's authorization.
type PrimaryRuntimePoll struct {
	Projection        *realmv1.RuntimeConnectionPollResultDto
	AuthorityDeadline time.Time
	ObservedAt        time.Time
}

// RemoteAccessSettingsOwner selects local configuration only. It conveys no
// authenticated caller authority; control still binds and refreshes through
// the Account owner before any lease or peer can be established.
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
		RuntimeID: c.binding.RuntimeId, BindingID: c.binding.BindingId, Invalidated: c.invalidated, Deadline: c.deadline}
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
	// A successful identity read alone is not a lease. Verify actual host-key
	// custody now; only RenewPrimaryRuntimeControl may establish the deadline.
	if _, err := s.signPrimaryControl(ctx, c, nil); err != nil {
		return nil, err
	}
	return c, nil
}

// @nimi-authority: rule.nimi.runtime.remote-access.primary-control
func (s *Service) RenewPrimaryRuntimeControl(ctx context.Context, c *PrimaryRuntimeControl) error {
	if c == nil {
		return primaryFailure(codes.InvalidArgument)
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	sent := time.Now()
	signedAt := float64(s.now().UnixMilli())
	proof, err := s.signPrimaryControl(ctx, c, []any{"lease", c.accountID, c.binding.RuntimeId, c.binding.BindingId, c.binding.LeaseVersion, signedAt})
	if err != nil {
		return err
	}
	body := realmv1.PrimaryRuntimeLeaseRequestDto{ExpectedAccountId: c.accountID, RuntimeId: c.binding.RuntimeId, BindingId: c.binding.BindingId,
		LeaseVersion: c.binding.LeaseVersion, SignedAt: signedAt, Signature: proof}
	var result realmv1.PrimaryRuntimeSnapshotDto
	if err = s.primaryAccountCall(ctx, c.accountID, c.realmID, c.generation, realmv1.RenewMyPrimaryRuntimeLeaseOperation, &body, &result); err != nil {
		return err
	}
	if result.AccountId != c.accountID || result.Binding == nil || !validPrimaryBinding(result.Binding) ||
		result.Binding.RuntimeId != c.binding.RuntimeId || result.Binding.BindingId != c.binding.BindingId ||
		result.Binding.PublicKey != c.binding.PublicKey || result.Binding.LeaseVersion == c.binding.LeaseVersion {
		return primaryFailure(codes.Internal)
	}
	serverTime, err := time.Parse(time.RFC3339Nano, result.ServerTime)
	if err != nil {
		return primaryFailure(codes.Internal)
	}
	expiry, err := time.Parse(time.RFC3339Nano, result.Binding.LeaseExpiresAt)
	if err != nil {
		return primaryFailure(codes.Internal)
	}
	validAfter, _ := time.Parse(time.RFC3339Nano, result.Binding.ValidAfter)
	remaining := expiry.Sub(serverTime)
	deadline := sent.Add(remaining)
	if remaining <= 0 || remaining > time.Minute || validAfter.After(serverTime) || !PrimaryRuntimeDeadlineLive(deadline) {
		return primaryFailure(codes.Internal)
	}
	c.binding, c.deadline = *result.Binding, deadline
	return nil
}

// @nimi-authority: rule.nimi.runtime.remote-access.primary-control
func (s *Service) PollPrimaryRuntimeConnections(ctx context.Context, c *PrimaryRuntimeControl, contextIDs []string) (*PrimaryRuntimePoll, error) {
	if c == nil || len(contextIDs) > 64 {
		return nil, primaryFailure(codes.InvalidArgument)
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if !PrimaryRuntimeDeadlineLive(c.deadline) {
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
	proof, err := s.signPrimaryControl(ctx, c, []any{"signal-poll", c.accountID, c.binding.RuntimeId, c.binding.BindingId, c.binding.LeaseVersion, primarySignalHash(ids), signedAt})
	if err != nil {
		return nil, err
	}
	body := realmv1.RuntimeConnectionPollDto{ExpectedAccountId: c.accountID, RuntimeId: c.binding.RuntimeId, BindingId: c.binding.BindingId,
		LeaseVersion: c.binding.LeaseVersion, ContextIds: ids, SignedAt: signedAt, Signature: proof}
	var result realmv1.RuntimeConnectionPollResultDto
	if err = s.primaryAccountCall(ctx, c.accountID, c.realmID, c.generation, realmv1.PollPrimaryRuntimeConnectionsOperation, &body, &result); err != nil {
		return nil, err
	}
	serverTime, err := time.Parse(time.RFC3339Nano, result.ServerTime)
	if err != nil || result.ControlLeaseExpiresAt != c.binding.LeaseExpiresAt || len(result.Offers) > 16 || len(result.Contexts) > len(ids) || !PrimaryRuntimeDeadlineLive(c.deadline) {
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
	return &PrimaryRuntimePoll{Projection: &result, AuthorityDeadline: c.deadline, ObservedAt: observedAt}, nil
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
	if !PrimaryRuntimeDeadlineLive(c.deadline) {
		return primaryFailure(codes.Unavailable)
	}
	signedAt := float64(s.now().UnixMilli())
	proof, err := s.signPrimaryControl(ctx, c, []any{"signal-answer", c.accountID, c.binding.RuntimeId, c.binding.BindingId, c.binding.LeaseVersion, primarySignalHash([]string{connectionID, answer, rejection}), signedAt})
	if err != nil {
		return err
	}
	body := realmv1.RuntimeConnectionAnswerDto{ExpectedAccountId: c.accountID, RuntimeId: c.binding.RuntimeId, BindingId: c.binding.BindingId,
		LeaseVersion: c.binding.LeaseVersion, SignedAt: signedAt, Signature: proof, ConnectionId: connectionID, AnswerSdp: answer, RejectionReason: rejection}
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
	if err != nil || origin.Scheme != "https" || origin.Host == "" || origin.User != nil || origin.Path != "" || origin.RawQuery != "" || origin.Fragment != "" {
		return false
	}
	callback, err := url.Parse(source.RedirectUri)
	return err == nil && callback.Scheme == origin.Scheme && callback.Host == origin.Host && callback.User == nil && callback.RawQuery == "" && callback.Fragment == ""
}
