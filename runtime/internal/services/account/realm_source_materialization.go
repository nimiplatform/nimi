package account

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

const (
	realmSourceMaterializationPacketPath      = "/api/realm/core/source-materialization-packets"
	realmSourceMaterializationJWKSPath        = "/api/auth/jwks/source-materialization"
	realmSourceMaterializationJWKSBodyBytes   = 64 * 1024
	realmSourceMaterializationPacketBodyBytes = 512 * 1024 * 1024
	realmSourceMaterializationHTTPTimeout     = 30 * time.Second
)

var (
	ErrRealmSourceMaterializationUnavailable    = errors.New("Realm source materialization acquisition unavailable")
	ErrRealmSourceMaterializationAccountLease   = errors.New("Realm source materialization account lease changed")
	ErrRealmSourceMaterializationDenied         = errors.New("Realm source materialization acquisition denied")
	ErrRealmSourceMaterializationInvalidRequest = errors.New("Realm source materialization request rejected")
	ErrRealmSourceMaterializationSourceBinding  = errors.New("Realm source materialization source binding rejected")
	ErrRealmSourceMaterializationContract       = errors.New("Realm source materialization contract rejected")
	ErrRealmSourceMaterializationResponseSize   = errors.New("Realm source materialization response exceeds limit")
)

// RealmSourceMaterializationAccountLease binds every private Realm request to
// one authenticated account generation. It contains no credential or origin.
type RealmSourceMaterializationAccountLease struct {
	AccountID  string
	Generation uint64
}

type RealmSourceMaterializationWorldEntityRefV3 struct {
	WorldID  string
	EntityID string
}

type RealmSourceMaterializationSourceRefV3 struct {
	Kind           string
	ID             string
	WorldID        string
	WorldEntityRef *RealmSourceMaterializationWorldEntityRefV3
	OwnerAccountID string
	SourceHash     string
}

type RealmSourceMaterializationLimitsV3 struct {
	MaxSegmentBytes          uint64
	MaxSegmentComponentCount uint64
	MaxChunkBytes            uint64
	MaxSegmentChunks         uint64
	MaxSetSegments           uint64
	MaxSetBytes              uint64
	MaxSetComponentCount     uint64
	MaxSetChunks             uint64
}

type RealmSourceMaterializationChallengeV3 struct {
	ChallengeID             string
	ChallengeDigest         string
	IntendedRuntimeAudience string
	ExpiresAt               time.Time
}

// RealmSourceMaterializationIssuanceRequest is Runtime-private. It deliberately
// has no Realm base, bearer, grant id, header, or caller-selected URL.
type RealmSourceMaterializationIssuanceRequest struct {
	AuthenticatedAccountID string
	SourceRef              RealmSourceMaterializationSourceRefV3
	Challenge              RealmSourceMaterializationChallengeV3
	Limits                 RealmSourceMaterializationLimitsV3
}

type RealmSourceMaterializationHTTPResponse struct {
	StatusCode      int
	ContentType     string
	ContentEncoding string
	ContentLength   int64
	Body            io.ReadCloser
}

type RealmSourceMaterializationAcquisition struct {
	AccountLease   RealmSourceMaterializationAccountLease
	PacketResponse RealmSourceMaterializationHTTPResponse
}

type realmSourceMaterializationCredentialLease struct {
	lease   RealmSourceMaterializationAccountLease
	baseURL string
	bearer  string
}

type realmSourceMaterializationPacketRequest struct {
	SourceRef               any                                    `json:"sourceRef"`
	MaterializerAccountID   string                                 `json:"materializerAccountId"`
	ChallengeID             string                                 `json:"challengeId"`
	ChallengeDigest         string                                 `json:"challengeDigest"`
	IntendedRuntimeAudience string                                 `json:"intendedRuntimeAudience"`
	ChallengeExpiresAt      string                                 `json:"challengeExpiresAt"`
	PublishedLimits         realmSourceMaterializationLimitsV3JSON `json:"publishedLimits"`
}

type realmSourceMaterializationLimitsV3JSON struct {
	MaxSegmentBytes          uint64 `json:"maxSegmentBytes"`
	MaxSegmentComponentCount uint64 `json:"maxSegmentComponentCount"`
	MaxChunkBytes            uint64 `json:"maxChunkBytes"`
	MaxSegmentChunks         uint64 `json:"maxSegmentChunks"`
	MaxSetSegments           uint64 `json:"maxSetSegments"`
	MaxSetBytes              uint64 `json:"maxSetBytes"`
	MaxSetComponentCount     uint64 `json:"maxSetComponentCount"`
	MaxSetChunks             uint64 `json:"maxSetChunks"`
}

type realmSourceMaterializationWorldEntityRefV3JSON struct {
	Kind     string `json:"kind"`
	WorldID  string `json:"worldId"`
	EntityID string `json:"entityId"`
}

type realmSourceMaterializationWorldRefV3JSON struct {
	Kind           string                                         `json:"kind"`
	ID             string                                         `json:"id"`
	WorldID        string                                         `json:"worldId"`
	WorldEntityRef realmSourceMaterializationWorldEntityRefV3JSON `json:"worldEntityRef"`
	SourceHash     string                                         `json:"sourceHash"`
}

type realmSourceMaterializationPersonaRefV3JSON struct {
	Kind           string `json:"kind"`
	ID             string `json:"id"`
	WorldID        string `json:"worldId"`
	OwnerAccountID string `json:"ownerAccountId"`
	SourceHash     string `json:"sourceHash"`
}

// AcquireRealmSourceMaterialization performs the authenticated first-party
// source operation directly. Realm owns the canonical account/source
// visibility decision; no app id, permission scope, grant id, or caller-side
// decision endpoint participates in this authority path.
func (s *Service) AcquireRealmSourceMaterialization(ctx context.Context, request RealmSourceMaterializationIssuanceRequest) (RealmSourceMaterializationAcquisition, error) {
	if s == nil {
		return RealmSourceMaterializationAcquisition{}, ErrRealmSourceMaterializationUnavailable
	}
	if err := validateRealmSourceMaterializationIssuanceRequest(request, s.now().UTC()); err != nil {
		return RealmSourceMaterializationAcquisition{}, err
	}
	credential, err := s.captureRealmSourceMaterializationCredential(ctx, request.AuthenticatedAccountID)
	if err != nil {
		return RealmSourceMaterializationAcquisition{}, err
	}

	packetBody, err := buildRealmSourceMaterializationPacketRequest(request, credential.lease.AccountID)
	if err != nil {
		return RealmSourceMaterializationAcquisition{}, err
	}
	packetResponse, err := s.doRealmSourceMaterializationStream(ctx, credential, http.MethodPost, realmSourceMaterializationPacketPath, packetBody, http.StatusCreated, realmSourceMaterializationPacketBodyBytes, true, false)
	if err != nil {
		return RealmSourceMaterializationAcquisition{}, err
	}
	return RealmSourceMaterializationAcquisition{
		AccountLease:   credential.lease,
		PacketResponse: packetResponse,
	}, nil
}

// FetchCurrentRealmSourceMaterializationJWKS always performs a new no-cache
// fetch. The public JWKS endpoint receives no bearer.
func (s *Service) FetchCurrentRealmSourceMaterializationJWKS(ctx context.Context, lease RealmSourceMaterializationAccountLease) (RealmSourceMaterializationHTTPResponse, error) {
	credential, err := s.captureRealmSourceMaterializationCredential(ctx, lease.AccountID)
	if err != nil {
		return RealmSourceMaterializationHTTPResponse{}, err
	}
	if credential.lease != lease {
		return RealmSourceMaterializationHTTPResponse{}, ErrRealmSourceMaterializationAccountLease
	}
	return s.doRealmSourceMaterializationStream(ctx, credential, http.MethodGet, realmSourceMaterializationJWKSPath, nil, http.StatusOK, realmSourceMaterializationJWKSBodyBytes, false, true)
}

func (s *Service) RevalidateRealmSourceMaterializationAccount(_ context.Context, lease RealmSourceMaterializationAccountLease) error {
	if s == nil || lease.AccountID == "" || lease.Generation == 0 {
		return ErrRealmSourceMaterializationAccountLease
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.validateRealmSourceMaterializationAccountLocked(lease)
}

// WithCurrentRealmSourceMaterializationAccount closes the final account-switch
// TOCTOU window around a local product commit. The callback runs while the
// account identity mutex is held, after the exact lease has been revalidated.
// It receives no bearer, Realm origin, or grant material and must not re-enter
// the account service.
func (s *Service) WithCurrentRealmSourceMaterializationAccount(ctx context.Context, lease RealmSourceMaterializationAccountLease, callback func() error) error {
	if s == nil || callback == nil || lease.AccountID == "" || lease.Generation == 0 {
		return ErrRealmSourceMaterializationAccountLease
	}
	if ctx == nil {
		return fmt.Errorf("%w: commit guard context is unavailable", ErrRealmSourceMaterializationContract)
	}
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
	}
	if err := s.validateRealmSourceMaterializationAccountLocked(lease); err != nil {
		return err
	}
	return callback()
}

// validateRealmSourceMaterializationAccountLocked requires s.mu to be held for
// writing because expiry may invalidate the current Runtime identity.
func (s *Service) validateRealmSourceMaterializationAccountLocked(lease RealmSourceMaterializationAccountLease) error {
	if s.state == runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED && s.accountMaterialExpiredLocked() {
		s.state = runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_EXPIRED
		s.invalidateAuthenticatedRuntimeIdentityLocked()
	}
	if s.state != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED || !s.authenticatedRuntimeIdentity || s.accountGeneration != lease.Generation || s.projection == nil || strings.TrimSpace(s.projection.GetAccountId()) != lease.AccountID {
		return ErrRealmSourceMaterializationAccountLease
	}
	return nil
}

func (s *Service) captureRealmSourceMaterializationCredential(ctx context.Context, requestedAccountID string) (realmSourceMaterializationCredentialLease, error) {
	accountID := strings.TrimSpace(requestedAccountID)
	if s == nil || !s.isActivated() || accountID == "" || accountID != requestedAccountID {
		return realmSourceMaterializationCredentialLease{}, ErrRealmSourceMaterializationAccountLease
	}
	_, _, ok, err := s.realmUnaryAccessToken(ctx, nil)
	if err != nil {
		return realmSourceMaterializationCredentialLease{}, fmt.Errorf("%w: refresh current Realm bearer", ErrRealmSourceMaterializationUnavailable)
	}
	if !ok {
		return realmSourceMaterializationCredentialLease{}, ErrRealmSourceMaterializationAccountLease
	}
	s.mu.RLock()
	if s.state != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED || !s.authenticatedRuntimeIdentity || s.accountGeneration == 0 || s.projection == nil || strings.TrimSpace(s.projection.GetAccountId()) != accountID || strings.TrimSpace(s.material.AccountID) != accountID || strings.TrimSpace(s.material.AccessToken) == "" {
		s.mu.RUnlock()
		return realmSourceMaterializationCredentialLease{}, ErrRealmSourceMaterializationAccountLease
	}
	credential := realmSourceMaterializationCredentialLease{
		lease:   RealmSourceMaterializationAccountLease{AccountID: accountID, Generation: s.accountGeneration},
		baseURL: s.realmBaseURL,
		bearer:  s.material.AccessToken,
	}
	s.mu.RUnlock()
	canonicalBase, canonicalErr := canonicalRealmSourceMaterializationBaseURL(credential.baseURL)
	if canonicalErr != nil {
		return realmSourceMaterializationCredentialLease{}, canonicalErr
	}
	credential.baseURL = canonicalBase
	return credential, nil
}

func (s *Service) doRealmSourceMaterializationStream(ctx context.Context, credential realmSourceMaterializationCredentialLease, method, path string, body any, expectedStatus int, maxBytes int64, authenticated, noCache bool) (RealmSourceMaterializationHTTPResponse, error) {
	if err := s.RevalidateRealmSourceMaterializationAccount(ctx, credential.lease); err != nil {
		return RealmSourceMaterializationHTTPResponse{}, err
	}
	target, err := realmSourceMaterializationEndpoint(credential.baseURL, path)
	if err != nil {
		return RealmSourceMaterializationHTTPResponse{}, err
	}
	var requestBody io.Reader
	if body != nil {
		encoded, encodeErr := json.Marshal(body)
		if encodeErr != nil {
			return RealmSourceMaterializationHTTPResponse{}, fmt.Errorf("%w: encode private Realm request", ErrRealmSourceMaterializationContract)
		}
		requestBody = bytes.NewReader(encoded)
	}
	httpRequest, err := http.NewRequestWithContext(ctx, method, target, requestBody)
	if err != nil {
		return RealmSourceMaterializationHTTPResponse{}, fmt.Errorf("%w: construct Realm request", ErrRealmSourceMaterializationUnavailable)
	}
	httpRequest.Header.Set("Accept", "application/json")
	httpRequest.Header.Set("Accept-Encoding", "identity")
	if body != nil {
		httpRequest.Header.Set("Content-Type", "application/json")
	}
	if authenticated {
		httpRequest.Header.Set("Authorization", "Bearer "+credential.bearer)
	}
	if noCache {
		httpRequest.Header.Set("Cache-Control", "no-cache, no-store, max-age=0")
		httpRequest.Header.Set("Pragma", "no-cache")
	}

	client := http.Client{Timeout: realmSourceMaterializationHTTPTimeout}
	if s.realmHTTP != nil {
		client = *s.realmHTTP
		if client.Timeout <= 0 || client.Timeout > realmSourceMaterializationHTTPTimeout {
			client.Timeout = realmSourceMaterializationHTTPTimeout
		}
	}
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	response, err := client.Do(httpRequest)
	if err != nil {
		return RealmSourceMaterializationHTTPResponse{}, fmt.Errorf("%w: Realm request failed", ErrRealmSourceMaterializationUnavailable)
	}
	closeResponse := true
	defer func() {
		if closeResponse {
			_ = response.Body.Close()
		}
	}()
	if err := s.RevalidateRealmSourceMaterializationAccount(ctx, credential.lease); err != nil {
		return RealmSourceMaterializationHTTPResponse{}, err
	}
	if response.StatusCode != expectedStatus {
		return RealmSourceMaterializationHTTPResponse{}, realmSourceMaterializationHTTPStatusError(path, response.StatusCode)
	}
	contentType, _, err := mime.ParseMediaType(response.Header.Get("Content-Type"))
	if err != nil || strings.ToLower(contentType) != "application/json" {
		return RealmSourceMaterializationHTTPResponse{}, fmt.Errorf("%w: Realm response content type is not application/json", ErrRealmSourceMaterializationContract)
	}
	contentEncoding := strings.ToLower(strings.TrimSpace(response.Header.Get("Content-Encoding")))
	if contentEncoding != "" && contentEncoding != "identity" {
		return RealmSourceMaterializationHTTPResponse{}, fmt.Errorf("%w: compressed Realm response is not admitted", ErrRealmSourceMaterializationContract)
	}
	if maxBytes <= 0 || response.ContentLength > maxBytes {
		return RealmSourceMaterializationHTTPResponse{}, ErrRealmSourceMaterializationResponseSize
	}
	if noCache && (!headerContainsDirective(response.Header.Values("Cache-Control"), "no-store") || !headerContainsDirective(response.Header.Values("Cache-Control"), "max-age=0") || !headerContainsDirective(response.Header.Values("Pragma"), "no-cache")) {
		return RealmSourceMaterializationHTTPResponse{}, fmt.Errorf("%w: current JWKS response is cacheable", ErrRealmSourceMaterializationContract)
	}
	closeResponse = false
	return RealmSourceMaterializationHTTPResponse{
		StatusCode:      response.StatusCode,
		ContentType:     response.Header.Get("Content-Type"),
		ContentEncoding: response.Header.Get("Content-Encoding"),
		ContentLength:   response.ContentLength,
		Body:            &realmSourceMaterializationBoundedReadCloser{body: response.Body, remaining: maxBytes},
	}, nil
}

// realmSourceMaterializationHTTPStatusError classifies only statuses published
// by the fixed Packet v3 endpoint. The response body is deliberately not an
// input: Realm denial details may contain private policy or source data and are
// never parsed, logged, or projected by Runtime.
func realmSourceMaterializationHTTPStatusError(path string, statusCode int) error {
	if path == realmSourceMaterializationPacketPath {
		switch statusCode {
		case http.StatusBadRequest:
			return fmt.Errorf("%w: Realm Packet request is invalid", ErrRealmSourceMaterializationInvalidRequest)
		case http.StatusUnauthorized:
			return fmt.Errorf("%w: Realm account authentication was rejected", ErrRealmSourceMaterializationAccountLease)
		case http.StatusForbidden:
			return fmt.Errorf("%w: Realm source visibility or account policy was denied", ErrRealmSourceMaterializationDenied)
		case http.StatusConflict:
			return fmt.Errorf("%w: canonical Realm source or dependency is stale or not ready", ErrRealmSourceMaterializationSourceBinding)
		}
	}
	return fmt.Errorf("%w: Realm returned HTTP status %d", ErrRealmSourceMaterializationUnavailable, statusCode)
}

func validateRealmSourceMaterializationIssuanceRequest(request RealmSourceMaterializationIssuanceRequest, now time.Time) error {
	if !validRealmSourceMaterializationIdentifier(request.AuthenticatedAccountID, 256) {
		return fmt.Errorf("%w: authenticated account is invalid", ErrRealmSourceMaterializationContract)
	}
	if _, err := realmSourceMaterializationSourceRefJSON(request.SourceRef); err != nil {
		return err
	}
	challenge := request.Challenge
	if len(challenge.ChallengeID) < 16 || len(challenge.ChallengeID) > 256 || !isRealmSourceMaterializationPrintableASCII(challenge.ChallengeID) || !isRealmSourceMaterializationLowerSHA256(challenge.ChallengeDigest) || !validRealmSourceMaterializationIdentifier(challenge.IntendedRuntimeAudience, 512) || challenge.ExpiresAt.IsZero() || !challenge.ExpiresAt.After(now) {
		return fmt.Errorf("%w: challenge binding is invalid", ErrRealmSourceMaterializationContract)
	}
	limits := request.Limits
	values := []struct{ value, maximum uint64 }{
		{limits.MaxSegmentBytes, 8388608}, {limits.MaxSegmentComponentCount, 256}, {limits.MaxChunkBytes, 262144}, {limits.MaxSegmentChunks, 4096},
		{limits.MaxSetSegments, 64}, {limits.MaxSetBytes, 134217728}, {limits.MaxSetComponentCount, 16384}, {limits.MaxSetChunks, 65536},
	}
	for _, value := range values {
		if value.value == 0 || value.value > value.maximum {
			return fmt.Errorf("%w: published limits are outside the admitted range", ErrRealmSourceMaterializationContract)
		}
	}
	if limits.MaxChunkBytes > limits.MaxSegmentBytes || limits.MaxSegmentBytes > limits.MaxSetBytes || limits.MaxSegmentComponentCount > limits.MaxSetComponentCount || limits.MaxSegmentChunks > limits.MaxSetChunks {
		return fmt.Errorf("%w: published limits are inconsistent", ErrRealmSourceMaterializationContract)
	}
	return nil
}

func buildRealmSourceMaterializationPacketRequest(request RealmSourceMaterializationIssuanceRequest, accountID string) (realmSourceMaterializationPacketRequest, error) {
	sourceRef, err := realmSourceMaterializationSourceRefJSON(request.SourceRef)
	if err != nil {
		return realmSourceMaterializationPacketRequest{}, err
	}
	limits := request.Limits
	return realmSourceMaterializationPacketRequest{
		SourceRef: sourceRef, MaterializerAccountID: accountID,
		ChallengeID: request.Challenge.ChallengeID, ChallengeDigest: request.Challenge.ChallengeDigest,
		IntendedRuntimeAudience: request.Challenge.IntendedRuntimeAudience,
		ChallengeExpiresAt:      request.Challenge.ExpiresAt.UTC().Format(time.RFC3339Nano),
		PublishedLimits: realmSourceMaterializationLimitsV3JSON{
			MaxSegmentBytes: limits.MaxSegmentBytes, MaxSegmentComponentCount: limits.MaxSegmentComponentCount,
			MaxChunkBytes: limits.MaxChunkBytes, MaxSegmentChunks: limits.MaxSegmentChunks,
			MaxSetSegments: limits.MaxSetSegments, MaxSetBytes: limits.MaxSetBytes,
			MaxSetComponentCount: limits.MaxSetComponentCount, MaxSetChunks: limits.MaxSetChunks,
		},
	}, nil
}

func realmSourceMaterializationSourceRefJSON(source RealmSourceMaterializationSourceRefV3) (any, error) {
	if !validRealmSourceMaterializationIdentifier(source.ID, 256) || !validRealmSourceMaterializationIdentifier(source.WorldID, 256) || !isRealmSourceMaterializationLowerSHA256(source.SourceHash) {
		return nil, fmt.Errorf("%w: source ref is invalid", ErrRealmSourceMaterializationContract)
	}
	switch source.Kind {
	case "worldCharacter":
		if source.WorldEntityRef == nil || source.OwnerAccountID != "" || source.WorldEntityRef.WorldID != source.WorldID || !validRealmSourceMaterializationIdentifier(source.WorldEntityRef.EntityID, 256) {
			return nil, fmt.Errorf("%w: worldCharacter source ref is invalid", ErrRealmSourceMaterializationContract)
		}
		return realmSourceMaterializationWorldRefV3JSON{
			Kind: source.Kind, ID: source.ID, WorldID: source.WorldID, SourceHash: source.SourceHash,
			WorldEntityRef: realmSourceMaterializationWorldEntityRefV3JSON{Kind: "worldEntity", WorldID: source.WorldID, EntityID: source.WorldEntityRef.EntityID},
		}, nil
	case "personaCharacter":
		if source.WorldEntityRef != nil || !validRealmSourceMaterializationIdentifier(source.OwnerAccountID, 256) {
			return nil, fmt.Errorf("%w: personaCharacter source ref is invalid", ErrRealmSourceMaterializationContract)
		}
		return realmSourceMaterializationPersonaRefV3JSON{Kind: source.Kind, ID: source.ID, WorldID: source.WorldID, OwnerAccountID: source.OwnerAccountID, SourceHash: source.SourceHash}, nil
	default:
		return nil, fmt.Errorf("%w: source ref kind is invalid", ErrRealmSourceMaterializationContract)
	}
}

func canonicalRealmSourceMaterializationBaseURL(value string) (string, error) {
	if value == "" || value != strings.TrimSpace(value) || strings.Contains(value, "#") || strings.HasSuffix(value, "?") {
		return "", fmt.Errorf("%w: canonical Realm base URL is unavailable", ErrRealmSourceMaterializationUnavailable)
	}
	parsed, err := url.Parse(value)
	if err != nil || !parsed.IsAbs() || parsed.Opaque != "" || parsed.Host == "" || parsed.Hostname() == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.ForceQuery || parsed.Fragment != "" {
		return "", fmt.Errorf("%w: canonical Realm base URL is invalid", ErrRealmSourceMaterializationUnavailable)
	}
	scheme := strings.ToLower(parsed.Scheme)
	if scheme != "https" && !(scheme == "http" && realmSourceMaterializationLoopbackHost(parsed.Hostname())) {
		return "", fmt.Errorf("%w: insecure remote Realm transport is forbidden", ErrRealmSourceMaterializationUnavailable)
	}
	parsed.Scheme = scheme
	parsed.RawQuery = ""
	parsed.ForceQuery = false
	parsed.Fragment = ""
	parsed.RawFragment = ""
	return strings.TrimRight(parsed.String(), "/"), nil
}

func realmSourceMaterializationEndpoint(baseURL, path string) (string, error) {
	parsed, err := url.Parse(baseURL)
	if err != nil || !strings.HasPrefix(path, "/") || strings.ContainsAny(path, "?#") {
		return "", fmt.Errorf("%w: fixed Realm endpoint is invalid", ErrRealmSourceMaterializationUnavailable)
	}
	parsed.Path = path
	parsed.RawPath = ""
	parsed.RawQuery = ""
	parsed.ForceQuery = false
	parsed.Fragment = ""
	parsed.RawFragment = ""
	return parsed.String(), nil
}

func realmSourceMaterializationLoopbackHost(host string) bool {
	trimmed := strings.Trim(strings.ToLower(host), "[]")
	if trimmed == "localhost" {
		return true
	}
	parsed := net.ParseIP(trimmed)
	return parsed != nil && parsed.IsLoopback()
}

func validRealmSourceMaterializationIdentifier(value string, maximum int) bool {
	return value != "" && value == strings.TrimSpace(value) && len(value) <= maximum
}

func isRealmSourceMaterializationLowerSHA256(value string) bool {
	if len(value) != 64 {
		return false
	}
	for _, character := range value {
		if (character < '0' || character > '9') && (character < 'a' || character > 'f') {
			return false
		}
	}
	return true
}

func isRealmSourceMaterializationPrintableASCII(value string) bool {
	for _, character := range []byte(value) {
		if character < 0x21 || character > 0x7e {
			return false
		}
	}
	return true
}

func headerContainsDirective(values []string, directive string) bool {
	want := strings.ToLower(strings.TrimSpace(directive))
	for _, value := range values {
		for _, part := range strings.Split(strings.ToLower(value), ",") {
			if strings.TrimSpace(part) == want {
				return true
			}
		}
	}
	return false
}

type realmSourceMaterializationBoundedReadCloser struct {
	body      io.ReadCloser
	remaining int64
}

func (reader *realmSourceMaterializationBoundedReadCloser) Read(target []byte) (int, error) {
	if reader.remaining < 0 {
		return 0, ErrRealmSourceMaterializationResponseSize
	}
	if reader.remaining == 0 {
		var probe [1]byte
		n, err := reader.body.Read(probe[:])
		if n > 0 {
			reader.remaining = -1
			return 0, ErrRealmSourceMaterializationResponseSize
		}
		return 0, err
	}
	if int64(len(target)) > reader.remaining {
		target = target[:reader.remaining]
	}
	n, err := reader.body.Read(target)
	reader.remaining -= int64(n)
	return n, err
}

func (reader *realmSourceMaterializationBoundedReadCloser) Close() error {
	return reader.body.Close()
}
