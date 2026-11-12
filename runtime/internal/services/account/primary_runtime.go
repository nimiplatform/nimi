package account

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base32"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	realmv1 "github.com/nimiplatform/nimi/runtime/gen/realm/v1"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"github.com/nimiplatform/nimi/runtime/internal/protectedprincipal"
	"google.golang.org/grpc/codes"
)

type primaryHostKey struct {
	RuntimeID string `json:"runtimeId"`
	Seed      []byte `json:"seed"`
}
type primaryHostKeys struct {
	Version        int             `json:"version"`
	Active         *primaryHostKey `json:"active,omitempty"`
	Pending        *primaryHostKey `json:"pending,omitempty"`
	PendingBinding string          `json:"pendingBinding"`
}

// @nimi-authority: rule.nimi.runtime.remote-access.primary-host-control
func (s *Service) GetPrimaryRuntimeState(ctx context.Context, _ *runtimev1.GetPrimaryRuntimeStateRequest) (*runtimev1.GetPrimaryRuntimeStateResponse, error) {
	principal, err := s.primaryCaller(ctx)
	if err != nil {
		return nil, err
	}
	var state realmv1.PrimaryRuntimeSnapshotDto
	if err = s.primaryRealmCall(ctx, principal, realmv1.GetMyPrimaryRuntimeOperation, nil, &state); err != nil {
		return nil, err
	}
	if state.AccountId != principal.AccountID {
		return nil, primaryFailure(codes.Internal)
	}
	if _, err = time.Parse(time.RFC3339Nano, state.ServerTime); err != nil {
		return nil, primaryFailure(codes.Internal)
	}
	s.primaryMu.Lock()
	defer s.primaryMu.Unlock()
	keys, name, err := s.loadPrimaryKeys(ctx, principal)
	if err != nil {
		return nil, err
	}
	defer clearPrimaryKeys(keys)
	result := &runtimev1.GetPrimaryRuntimeStateResponse{}
	if keys.Active != nil {
		result.RuntimeId = keys.Active.RuntimeID
	}
	if state.Binding == nil {
		return result, nil
	}
	binding := state.Binding
	if !validPrimaryBinding(binding) {
		return nil, primaryFailure(codes.Internal)
	}
	if primaryKeyMatches(keys.Pending, binding) {
		if keys.Active != nil {
			clear(keys.Active.Seed)
		}
		keys.Active = keys.Pending
		keys.Pending = nil
		keys.PendingBinding = ""
		if err = s.savePrimaryKeys(ctx, name, keys); err != nil {
			return nil, err
		}
	}
	if keys.Active != nil {
		result.RuntimeId = keys.Active.RuntimeID
	}
	result.PrimaryRuntimeId = binding.RuntimeId
	result.BindingId = binding.BindingId
	result.DisplayName = binding.DisplayName
	result.ThisRuntime = primaryKeyMatches(keys.Active, binding)
	result.ValidAfter = binding.ValidAfter
	if !s.primaryCallerCurrent(ctx, principal) {
		return nil, primaryFailure(codes.Unauthenticated)
	}
	return result, nil
}

// @nimi-authority: rule.nimi.runtime.remote-access.primary-host-control
func (s *Service) PreparePrimaryRuntime(ctx context.Context, request *runtimev1.PreparePrimaryRuntimeRequest) (*runtimev1.PreparePrimaryRuntimeResponse, error) {
	principal, err := s.primaryCaller(ctx)
	if err != nil {
		return nil, err
	}
	if request == nil || (request.Action != "bind" && request.Action != "reinitialize") || request.DisplayName == "" || request.DisplayName != strings.TrimSpace(request.DisplayName) || !utf8.ValidString(request.DisplayName) || utf8.RuneCountInString(request.DisplayName) > 80 || strings.ContainsRune(request.DisplayName, 0) {
		return nil, primaryFailure(codes.InvalidArgument)
	}
	var state realmv1.PrimaryRuntimeSnapshotDto
	if err = s.primaryRealmCall(ctx, principal, realmv1.GetMyPrimaryRuntimeOperation, nil, &state); err != nil {
		return nil, err
	}
	if state.AccountId != principal.AccountID {
		return nil, primaryFailure(codes.Internal)
	}
	expected := ""
	if state.Binding != nil {
		if !validPrimaryBinding(state.Binding) {
			return nil, primaryFailure(codes.Internal)
		}
		expected = state.Binding.BindingId
	}
	if request.ExpectedBindingId != expected || (request.Action == "bind" && state.Binding != nil) || (request.Action == "reinitialize" && state.Binding == nil) {
		return nil, primaryFailure(codes.Aborted)
	}
	s.primaryMu.Lock()
	keys, name, err := s.loadPrimaryKeys(ctx, principal)
	if err != nil {
		s.primaryMu.Unlock()
		return nil, err
	}
	defer clearPrimaryKeys(keys)
	if keys.Pending == nil || keys.PendingBinding != expected {
		seed := make([]byte, ed25519.SeedSize)
		if _, err = rand.Read(seed); err != nil {
			s.primaryMu.Unlock()
			return nil, primaryFailure(codes.Internal)
		}
		rawID := make([]byte, 16)
		if _, err = rand.Read(rawID); err != nil {
			s.primaryMu.Unlock()
			return nil, primaryFailure(codes.Internal)
		}
		rawID[6] = (rawID[6] & 15) | 64
		rawID[8] = (rawID[8] & 63) | 128
		h := hex.EncodeToString(rawID)
		id := h[:8] + "-" + h[8:12] + "-" + h[12:16] + "-" + h[16:20] + "-" + h[20:]
		keys.Pending = &primaryHostKey{RuntimeID: id, Seed: seed}
		keys.PendingBinding = expected
		if err = s.savePrimaryKeys(ctx, name, keys); err != nil {
			s.primaryMu.Unlock()
			return nil, err
		}
	}
	proposed := keys.Pending
	private := ed25519.NewKeyFromSeed(proposed.Seed)
	defer clear(private)
	body := realmv1.PrimaryRuntimePrepareDto{Operation: request.Action, ExpectedAccountId: principal.AccountID, ExpectedBindingId: expected, DisplayName: request.DisplayName, RuntimeId: proposed.RuntimeID, PublicKey: base64.RawURLEncoding.EncodeToString(private.Public().(ed25519.PublicKey)), SignedAt: float64(s.now().UnixMilli())}
	payload, _ := json.Marshal([]any{"nimi.primary-runtime/v1", principal.RealmEnvironment, body.Operation, body.ExpectedAccountId, body.RuntimeId, body.ExpectedBindingId, body.DisplayName, body.PublicKey, body.SignedAt})
	body.Signature = base64.RawURLEncoding.EncodeToString(ed25519.Sign(private, payload))
	s.primaryMu.Unlock()
	var response realmv1.PrimaryRuntimeIntentDto
	if err = s.primaryRealmCall(ctx, principal, realmv1.PrepareMyPrimaryRuntimeOperation, &body, &response); err != nil {
		return nil, err
	}
	confirmation, err := url.Parse(response.ConfirmationUrl)
	if err != nil || confirmation.User != nil || confirmation.Fragment != "" || confirmation.Path != "/account/runtime" || confirmation.Query().Get("intent") != response.IntentId || len(confirmation.Query()) != 1 || response.ExpectedAccountId != principal.AccountID || response.RuntimeId != body.RuntimeId || response.Operation != body.Operation || response.DisplayName != body.DisplayName || !validPrimaryID(response.IntentId) {
		return nil, primaryFailure(codes.Internal)
	}
	if confirmation.Scheme != "https" && !(confirmation.Scheme == "http" && (confirmation.Hostname() == "localhost" || confirmation.Hostname() == "127.0.0.1")) {
		return nil, primaryFailure(codes.Internal)
	}
	if expires, err := time.Parse(time.RFC3339Nano, response.ExpiresAt); err != nil || !expires.After(s.now()) {
		return nil, primaryFailure(codes.Internal)
	}
	return &runtimev1.PreparePrimaryRuntimeResponse{IntentId: response.IntentId, ConfirmationUrl: response.ConfirmationUrl, ExpiresAt: response.ExpiresAt}, nil
}

func (s *Service) primaryCaller(ctx context.Context) (protectedprincipal.Principal, error) {
	p, ok := protectedprincipal.FromContext(ctx)
	if !ok || !p.IsDesktopAccountProduct() || s.primarySecrets == nil || s.primaryKeyScope == "" || !s.primaryCallerCurrent(ctx, p) {
		return p, primaryFailure(codes.PermissionDenied)
	}
	return p, nil
}
func (s *Service) primaryCallerCurrent(ctx context.Context, p protectedprincipal.Principal) bool {
	current, generation, ok := s.AuthenticatedRuntimeSecurityContext(ctx)
	return ok && p.Valid() && current.AccountId == p.AccountID && current.RealmEnvironmentId == p.RealmEnvironment && generation == p.AccountGeneration
}
func (s *Service) loadPrimaryKeys(ctx context.Context, p protectedprincipal.Principal) (*primaryHostKeys, string, error) {
	return s.loadPrimaryAccountKeys(ctx, p.AccountID, p.RealmEnvironment)
}

// @nimi-authority: rule.nimi.runtime.remote-access.primary-host-control
func (s *Service) loadPrimaryAccountKeys(ctx context.Context, accountID, realmID string) (*primaryHostKeys, string, error) {
	if s.primarySecrets == nil || s.primaryKeyScope == "" {
		return nil, "", primaryFailure(codes.Unavailable)
	}
	// Host identity outlives a login session. The verified installation and OS-user
	// scope is stable; the account custody partition deliberately includes logon state.
	digest := sha256.Sum256([]byte(s.primaryKeyScope + "\x00" + realmID + "\x00" + accountID))
	name := "primary-v2-" + strings.ToLower(base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(digest[:]))
	data, err := s.primarySecrets.Load(ctx, name)
	if errors.Is(err, protectedlocal.ErrProtectedSecretNotFound) {
		return &primaryHostKeys{Version: 1}, name, nil
	}
	if err != nil {
		return nil, name, primaryFailure(codes.Unavailable)
	}
	defer clear(data)
	if len(data) > 4096 {
		return nil, name, primaryFailure(codes.Internal)
	}
	keys := &primaryHostKeys{}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if decoder.Decode(keys) != nil || keys.Version != 1 || decoder.Decode(new(any)) != io.EOF {
		return nil, name, primaryFailure(codes.Internal)
	}
	for _, k := range []*primaryHostKey{keys.Active, keys.Pending} {
		if k != nil && (len(k.Seed) != ed25519.SeedSize || !validPrimaryID(k.RuntimeID)) {
			clearPrimaryKeys(keys)
			return nil, name, primaryFailure(codes.Internal)
		}
	}
	return keys, name, nil
}
func (s *Service) savePrimaryKeys(ctx context.Context, name string, keys *primaryHostKeys) error {
	data, err := json.Marshal(keys)
	if err != nil {
		return primaryFailure(codes.Internal)
	}
	defer clear(data)
	principal, ok := protectedprincipal.FromContext(ctx)
	if !ok {
		return primaryFailure(codes.PermissionDenied)
	}
	committed, commitErr := s.commitRecorded(ctx, "primary-runtime.identity.store", principal.AccountID, nil, func() error {
		return s.primarySecrets.Store(ctx, name, data)
	})
	if !committed {
		s.logger.Warn("primary Runtime identity storage failed", "error", commitErr)
		return grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_PROTECTED_LOCAL_CUSTODY_BOUNDARY_UNAVAILABLE)
	}
	// commitRecorded projects a post-commit audit failure through Account diagnostics;
	// the private identity was saved and must not be silently regenerated on retry.
	return nil
}
func clearPrimaryKeys(keys *primaryHostKeys) {
	if keys == nil {
		return
	}
	if keys.Active != nil {
		clear(keys.Active.Seed)
	}
	if keys.Pending != nil {
		clear(keys.Pending.Seed)
	}
}
func primaryKeyMatches(key *primaryHostKey, b *realmv1.PrimaryRuntimeBindingDto) bool {
	if key == nil || b == nil || key.RuntimeID != b.RuntimeId {
		return false
	}
	private := ed25519.NewKeyFromSeed(key.Seed)
	defer clear(private)
	return base64.RawURLEncoding.EncodeToString(private.Public().(ed25519.PublicKey)) == b.PublicKey
}
func validPrimaryBinding(b *realmv1.PrimaryRuntimeBindingDto) bool {
	if !validPrimaryID(b.BindingId) || !validPrimaryID(b.RuntimeId) || b.DisplayName == "" {
		return false
	}
	key, err := base64.RawURLEncoding.DecodeString(b.PublicKey)
	if err != nil || len(key) != ed25519.PublicKeySize {
		return false
	}
	if _, err = time.Parse(time.RFC3339Nano, b.ValidAfter); err != nil {
		return false
	}

	return true
}
func validPrimaryID(value string) bool {
	if len(value) != 36 || value[8] != '-' || value[13] != '-' || value[18] != '-' || value[23] != '-' {
		return false
	}
	decoded, err := hex.DecodeString(strings.ReplaceAll(value, "-", ""))
	return err == nil && len(decoded) == 16
}
func primaryFailure(code codes.Code) error {
	reason := runtimev1.ReasonCode_REALM_UNAVAILABLE
	switch code {
	case codes.PermissionDenied, codes.Unauthenticated:
		reason = runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED
	case codes.InvalidArgument:
		reason = runtimev1.ReasonCode_REALM_REQUEST_REJECTED
	case codes.Aborted:
		reason = runtimev1.ReasonCode_REALM_CONFLICT
	case codes.Internal:
		reason = runtimev1.ReasonCode_REALM_CONTRACT_INVALID
	}
	return grpcerr.WithReasonCode(code, reason)
}

func (s *Service) primaryRealmCall(ctx context.Context, p protectedprincipal.Principal, operation realmv1.OperationDescriptor, input, output any) error {
	err := s.primaryAccountCall(ctx, p.AccountID, p.RealmEnvironment, p.AccountGeneration, operation, input, output)
	if err == nil && !p.Valid() {
		return primaryFailure(codes.Unauthenticated)
	}
	return err
}

func (s *Service) primaryAccountCall(ctx context.Context, accountID, realmID string, expectedGeneration uint64, operation realmv1.OperationDescriptor, input, output any) error {
	token, generation, _, ok, err := s.realmUnaryCredential(ctx)
	if err != nil || !ok || generation != expectedGeneration {
		return primaryFailure(codes.Unauthenticated)
	}
	if err := s.primaryRequest(ctx, token, operation, input, output); err != nil {
		return err
	}
	current, currentGeneration, live := s.AuthenticatedRuntimeSecurityContext(ctx)
	if !live || currentGeneration != expectedGeneration || current.GetAccountId() != accountID || current.GetRealmEnvironmentId() != realmID {
		return primaryFailure(codes.Unauthenticated)
	}
	return nil
}

func (s *Service) primaryRequest(ctx context.Context, token string, operation realmv1.OperationDescriptor, input, output any) error {
	target := operation.ResolveBaseURL(s.realmBaseURL)
	if target == "" {
		return primaryFailure(codes.Unavailable)
	}
	var encoded []byte
	if input != nil {
		var err error
		encoded, err = json.Marshal(input)
		if err != nil {
			return primaryFailure(codes.InvalidArgument)
		}
	}
	request, err := http.NewRequestWithContext(ctx, operation.Method(), target, bytes.NewReader(encoded))
	if err != nil {
		return primaryFailure(codes.Unavailable)
	}
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	if input != nil {
		request.Header.Set("Content-Type", operation.RequestContentType())
	}
	client := *s.realmHTTP
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	response, err := client.Do(request)
	if err != nil {
		s.logger.Warn("primary Runtime owner request failed", "operation", operation.OperationID())
		return primaryFailure(codes.Unavailable)
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != operation.SuccessStatus() {
		s.logger.Warn("primary Runtime owner rejected request", "operation", operation.OperationID(), "status", response.StatusCode)
		switch response.StatusCode {
		case 400, 422:
			return primaryFailure(codes.InvalidArgument)
		case 404:
			return grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_REALM_NOT_FOUND)
		case 429:
			return grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_REALM_RATE_LIMITED)
		case 401, 403:
			return primaryFailure(codes.PermissionDenied)
		case 409:
			return primaryFailure(codes.Aborted)
		default:
			return primaryFailure(codes.Unavailable)
		}
	}
	limit := int64(65536)
	if operation.OperationID() == "syncPrimaryRuntimeConnections" {
		limit = 1 << 20
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, limit+1))
	if err != nil || int64(len(data)) > limit {
		return primaryFailure(codes.Internal)
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if decoder.Decode(output) != nil || decoder.Decode(new(any)) != io.EOF {
		return primaryFailure(codes.Internal)
	}
	return nil
}
