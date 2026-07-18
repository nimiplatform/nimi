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
	"strconv"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

const (
	realmSourceMaterializationAppID             = "nimi.avatar"
	realmSourceMaterializationScopeFamily       = "realm_source"
	realmSourceMaterializationScopeName         = "realm_source.snapshot.consume"
	realmSourceMaterializationRequestReason     = "Nimi Runtime Realm source materialization"
	realmSourceMaterializationRequestGrantPath  = "/api/human/me/permission-grants"
	realmSourceMaterializationGrantPathPrefix   = "/api/human/me/permission-grants/by-id/"
	realmSourceMaterializationPacketPath        = "/api/realm/core/source-materialization-packets"
	realmSourceMaterializationJWKSPath          = "/api/auth/jwks/source-materialization"
	realmSourceMaterializationControlBodyBytes  = 64 * 1024
	realmSourceMaterializationJWKSBodyBytes     = 64 * 1024
	realmSourceMaterializationPacketBodyBytes   = 512 * 1024 * 1024
	realmSourceMaterializationHTTPTimeout       = 30 * time.Second
	realmSourceMaterializationMaxSafeJSONNumber = uint64(1<<53 - 1)
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

type realmSourceMaterializationGrantRequest struct {
	AppID       string `json:"appId"`
	ScopeFamily string `json:"scopeFamily"`
	ScopeName   string `json:"scopeName"`
	Reason      string `json:"reason"`
}

type realmSourceMaterializationGrantDecision struct {
	ExpectedVersion uint64 `json:"expectedVersion"`
}

type realmSourceMaterializationPacketRequest struct {
	SourceRef               any                                    `json:"sourceRef"`
	MaterializerAccountID   string                                 `json:"materializerAccountId"`
	AccessGrantID           string                                 `json:"accessGrantId"`
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

type realmSourceMaterializationNullableString struct {
	Present bool
	Null    bool
	Value   string
}

func (value *realmSourceMaterializationNullableString) UnmarshalJSON(raw []byte) error {
	value.Present = true
	if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		value.Null = true
		value.Value = ""
		return nil
	}
	value.Null = false
	return json.Unmarshal(raw, &value.Value)
}

type realmSourceMaterializationGrant struct {
	GrantID               string                                   `json:"grantId"`
	SubjectAccountID      string                                   `json:"subjectAccountId"`
	AppID                 string                                   `json:"appId"`
	ScopeFamily           string                                   `json:"scopeFamily"`
	ScopeName             string                                   `json:"scopeName"`
	Qualifier             realmSourceMaterializationNullableString `json:"qualifier"`
	State                 string                                   `json:"state"`
	Reason                string                                   `json:"reason"`
	Version               json.Number                              `json:"version"`
	RequestedAt           string                                   `json:"requestedAt"`
	RequestedByAccountID  string                                   `json:"requestedByAccountId"`
	GrantedAt             realmSourceMaterializationNullableString `json:"grantedAt"`
	GrantedByAccountID    realmSourceMaterializationNullableString `json:"grantedByAccountId"`
	DeniedAt              realmSourceMaterializationNullableString `json:"deniedAt"`
	DeniedByAccountID     realmSourceMaterializationNullableString `json:"deniedByAccountId"`
	ExpiredAt             realmSourceMaterializationNullableString `json:"expiredAt"`
	ExpiresAt             realmSourceMaterializationNullableString `json:"expiresAt"`
	RevokedAt             realmSourceMaterializationNullableString `json:"revokedAt"`
	RevokedByAccountID    realmSourceMaterializationNullableString `json:"revokedByAccountId"`
	SupersededAt          realmSourceMaterializationNullableString `json:"supersededAt"`
	SupersededByAccountID realmSourceMaterializationNullableString `json:"supersededByAccountId"`
	SupersededByGrantID   realmSourceMaterializationNullableString `json:"supersededByGrantId"`
}

func (grant realmSourceMaterializationGrant) version() (uint64, error) {
	version, err := strconv.ParseUint(grant.Version.String(), 10, 64)
	if err != nil || version == 0 || version > realmSourceMaterializationMaxSafeJSONNumber {
		return 0, fmt.Errorf("%w: grant version is invalid", ErrRealmSourceMaterializationContract)
	}
	return version, nil
}

// AcquireRealmSourceMaterialization owns the exact Realm grant request,
// optional PENDING decision, and Packet v3 request. Existing exact GRANTED
// authority is reused and is never sent to the decision endpoint again.
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

	grantRequest := realmSourceMaterializationGrantRequest{
		AppID:       realmSourceMaterializationAppID,
		ScopeFamily: realmSourceMaterializationScopeFamily,
		ScopeName:   realmSourceMaterializationScopeName,
		Reason:      realmSourceMaterializationRequestReason,
	}
	grantResponse, err := s.doRealmSourceMaterializationJSON(ctx, credential, http.MethodPost, realmSourceMaterializationRequestGrantPath, grantRequest, http.StatusOK, realmSourceMaterializationControlBodyBytes, true)
	if err != nil {
		return RealmSourceMaterializationAcquisition{}, err
	}
	grant, err := decodeRealmSourceMaterializationGrant(grantResponse)
	if err != nil {
		return RealmSourceMaterializationAcquisition{}, err
	}
	requestVersion, err := validateRealmSourceMaterializationGrant(grant, credential.lease.AccountID, s.now().UTC(), true)
	if err != nil {
		return RealmSourceMaterializationAcquisition{}, err
	}

	if grant.State == "PENDING" {
		decisionResponse, decisionErr := s.doRealmSourceMaterializationJSON(
			ctx,
			credential,
			http.MethodPost,
			realmSourceMaterializationGrantPathPrefix+url.PathEscape(grant.GrantID)+"/grant",
			realmSourceMaterializationGrantDecision{ExpectedVersion: requestVersion},
			http.StatusOK,
			realmSourceMaterializationControlBodyBytes,
			true,
		)
		if decisionErr != nil {
			return RealmSourceMaterializationAcquisition{}, decisionErr
		}
		decidedGrant, decodeErr := decodeRealmSourceMaterializationGrant(decisionResponse)
		if decodeErr != nil {
			return RealmSourceMaterializationAcquisition{}, decodeErr
		}
		decisionVersion, validateErr := validateRealmSourceMaterializationGrant(decidedGrant, credential.lease.AccountID, s.now().UTC(), false)
		if validateErr != nil {
			return RealmSourceMaterializationAcquisition{}, validateErr
		}
		if decidedGrant.State != "GRANTED" || decidedGrant.GrantID != grant.GrantID || requestVersion == realmSourceMaterializationMaxSafeJSONNumber || decisionVersion != requestVersion+1 {
			return RealmSourceMaterializationAcquisition{}, fmt.Errorf("%w: grant decision did not advance the same PENDING record exactly once", ErrRealmSourceMaterializationContract)
		}
		grant = decidedGrant
	} else if grant.State != "GRANTED" {
		return RealmSourceMaterializationAcquisition{}, fmt.Errorf("%w: grant request returned non-authorizing state", ErrRealmSourceMaterializationContract)
	}

	packetBody, err := buildRealmSourceMaterializationPacketRequest(request, credential.lease.AccountID, grant.GrantID)
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

func (s *Service) doRealmSourceMaterializationJSON(ctx context.Context, credential realmSourceMaterializationCredentialLease, method, path string, body any, expectedStatus int, maxBytes int64, authenticated bool) ([]byte, error) {
	response, err := s.doRealmSourceMaterializationStream(ctx, credential, method, path, body, expectedStatus, maxBytes, authenticated, false)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(response.Body)
	if err != nil {
		if errors.Is(err, ErrRealmSourceMaterializationResponseSize) {
			return nil, err
		}
		return nil, fmt.Errorf("%w: read Realm response", ErrRealmSourceMaterializationUnavailable)
	}
	return raw, nil
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
			return fmt.Errorf("%w: Realm grant or source visibility was denied", ErrRealmSourceMaterializationDenied)
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
		if value.value == 0 || value.value > value.maximum || value.value > realmSourceMaterializationMaxSafeJSONNumber {
			return fmt.Errorf("%w: published limits are outside the admitted range", ErrRealmSourceMaterializationContract)
		}
	}
	if limits.MaxChunkBytes > limits.MaxSegmentBytes || limits.MaxSegmentBytes > limits.MaxSetBytes || limits.MaxSegmentComponentCount > limits.MaxSetComponentCount || limits.MaxSegmentChunks > limits.MaxSetChunks {
		return fmt.Errorf("%w: published limits are inconsistent", ErrRealmSourceMaterializationContract)
	}
	return nil
}

func buildRealmSourceMaterializationPacketRequest(request RealmSourceMaterializationIssuanceRequest, accountID, grantID string) (realmSourceMaterializationPacketRequest, error) {
	sourceRef, err := realmSourceMaterializationSourceRefJSON(request.SourceRef)
	if err != nil {
		return realmSourceMaterializationPacketRequest{}, err
	}
	if !validRealmSourceMaterializationGrantID(grantID) {
		return realmSourceMaterializationPacketRequest{}, fmt.Errorf("%w: canonical grant id is invalid", ErrRealmSourceMaterializationContract)
	}
	limits := request.Limits
	return realmSourceMaterializationPacketRequest{
		SourceRef: sourceRef, MaterializerAccountID: accountID, AccessGrantID: grantID,
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

func decodeRealmSourceMaterializationGrant(raw []byte) (realmSourceMaterializationGrant, error) {
	if err := rejectRealmSourceMaterializationDuplicateJSONKeys(raw); err != nil {
		return realmSourceMaterializationGrant{}, err
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	decoder.UseNumber()
	var grant realmSourceMaterializationGrant
	if err := decoder.Decode(&grant); err != nil {
		return realmSourceMaterializationGrant{}, fmt.Errorf("%w: grant response schema is invalid", ErrRealmSourceMaterializationContract)
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return realmSourceMaterializationGrant{}, fmt.Errorf("%w: grant response has trailing JSON", ErrRealmSourceMaterializationContract)
	}
	return grant, nil
}

func validateRealmSourceMaterializationGrant(grant realmSourceMaterializationGrant, accountID string, now time.Time, allowPending bool) (uint64, error) {
	version, err := grant.version()
	if err != nil {
		return 0, err
	}
	if !validRealmSourceMaterializationGrantID(grant.GrantID) || grant.SubjectAccountID != accountID || grant.RequestedByAccountID != accountID || grant.AppID != realmSourceMaterializationAppID || grant.ScopeFamily != realmSourceMaterializationScopeFamily || grant.ScopeName != realmSourceMaterializationScopeName || !grant.Qualifier.Present || !grant.Qualifier.Null || len(grant.Reason) > 2000 {
		return 0, fmt.Errorf("%w: canonical grant selector or subject is invalid", ErrRealmSourceMaterializationContract)
	}
	if _, err := time.Parse(time.RFC3339Nano, grant.RequestedAt); err != nil {
		return 0, fmt.Errorf("%w: grant requestedAt is invalid", ErrRealmSourceMaterializationContract)
	}
	for _, terminal := range []realmSourceMaterializationNullableString{grant.DeniedAt, grant.DeniedByAccountID, grant.ExpiredAt, grant.RevokedAt, grant.RevokedByAccountID, grant.SupersededAt, grant.SupersededByAccountID, grant.SupersededByGrantID} {
		if terminal.Present && !terminal.Null {
			return 0, fmt.Errorf("%w: authorizing grant contains terminal state evidence", ErrRealmSourceMaterializationContract)
		}
	}
	switch grant.State {
	case "PENDING":
		if !allowPending || (grant.GrantedAt.Present && !grant.GrantedAt.Null) || (grant.GrantedByAccountID.Present && !grant.GrantedByAccountID.Null) || (grant.ExpiresAt.Present && !grant.ExpiresAt.Null) {
			return 0, fmt.Errorf("%w: PENDING grant state is invalid", ErrRealmSourceMaterializationContract)
		}
	case "GRANTED":
		if !grant.GrantedAt.Present || grant.GrantedAt.Null || !grant.GrantedByAccountID.Present || grant.GrantedByAccountID.Null || grant.GrantedByAccountID.Value != accountID {
			return 0, fmt.Errorf("%w: GRANTED record lacks exact decision evidence", ErrRealmSourceMaterializationContract)
		}
		if _, err := time.Parse(time.RFC3339Nano, grant.GrantedAt.Value); err != nil {
			return 0, fmt.Errorf("%w: grant grantedAt is invalid", ErrRealmSourceMaterializationContract)
		}
		if grant.ExpiresAt.Present && !grant.ExpiresAt.Null {
			expiresAt, parseErr := time.Parse(time.RFC3339Nano, grant.ExpiresAt.Value)
			if parseErr != nil || !expiresAt.After(now) {
				return 0, fmt.Errorf("%w: GRANTED record is expired", ErrRealmSourceMaterializationContract)
			}
		}
	default:
		return 0, fmt.Errorf("%w: grant state is not admitted", ErrRealmSourceMaterializationContract)
	}
	return version, nil
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

func validRealmSourceMaterializationGrantID(value string) bool {
	if !validRealmSourceMaterializationIdentifier(value, 256) {
		return false
	}
	for _, character := range []byte(value) {
		if (character >= 'a' && character <= 'z') || (character >= 'A' && character <= 'Z') || (character >= '0' && character <= '9') || strings.ContainsRune("-._~", rune(character)) {
			continue
		}
		return false
	}
	return true
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

func rejectRealmSourceMaterializationDuplicateJSONKeys(raw []byte) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if err := scanRealmSourceMaterializationJSONValue(decoder); err != nil {
		return fmt.Errorf("%w: grant response JSON is invalid", ErrRealmSourceMaterializationContract)
	}
	if token, err := decoder.Token(); !errors.Is(err, io.EOF) || token != nil {
		return fmt.Errorf("%w: grant response has trailing JSON", ErrRealmSourceMaterializationContract)
	}
	return nil
}

func scanRealmSourceMaterializationJSONValue(decoder *json.Decoder) error {
	token, err := decoder.Token()
	if err != nil {
		return err
	}
	delimiter, ok := token.(json.Delim)
	if !ok {
		return nil
	}
	switch delimiter {
	case '{':
		seen := make(map[string]struct{})
		for decoder.More() {
			keyToken, keyErr := decoder.Token()
			if keyErr != nil {
				return keyErr
			}
			key, ok := keyToken.(string)
			if !ok {
				return fmt.Errorf("object key is not a string")
			}
			if _, duplicate := seen[key]; duplicate {
				return fmt.Errorf("duplicate object key")
			}
			seen[key] = struct{}{}
			if err := scanRealmSourceMaterializationJSONValue(decoder); err != nil {
				return err
			}
		}
		end, err := decoder.Token()
		if err != nil || end != json.Delim('}') {
			return fmt.Errorf("object is not closed")
		}
	case '[':
		for decoder.More() {
			if err := scanRealmSourceMaterializationJSONValue(decoder); err != nil {
				return err
			}
		}
		end, err := decoder.Token()
		if err != nil || end != json.Delim(']') {
			return fmt.Errorf("array is not closed")
		}
	default:
		return fmt.Errorf("invalid JSON delimiter")
	}
	return nil
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
