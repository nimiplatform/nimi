//go:build realm_v3_full_data

package runtimeagent

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"
)

type realmV3FullDataHTTPAuditV1 struct {
	base        http.RoundTripper
	preparation *realmV3FullDataAuditPreparationV1

	mu                         sync.Mutex
	packetRequestHash          string
	packetRequestAuthenticated bool
	packetSummary              *realmV3FullDataExpectedTransportV1
	packetSummaryErr           error
	packetRaw                  []byte
	challenge                  *sourceMaterializationChallengeV3
	jwksObserved               bool
	packetRequestCount         uint64
	jwksRequestCount           uint64
	protocolErr                error
}

type realmV3FullDataAuditPreparationV1 struct {
	Request           realmV3FullDataPartitionRequestV1
	JournalPath       string
	Generation        uint64
	AttemptRequestID  string
	AccountID         string
	RuntimeInstanceID string
}

var (
	realmV3FullDataAfterPreparedHookMuV1 sync.Mutex
	realmV3FullDataAfterPreparedHookV1   func()
)

func newRealmV3FullDataHTTPAuditV1(preparation ...realmV3FullDataAuditPreparationV1) *realmV3FullDataHTTPAuditV1 {
	transport := http.DefaultTransport
	if base, ok := http.DefaultTransport.(*http.Transport); ok {
		transport = base.Clone()
	}
	audit := &realmV3FullDataHTTPAuditV1{base: transport}
	if len(preparation) == 1 {
		copy := preparation[0]
		audit.preparation = &copy
	}
	return audit
}

func (audit *realmV3FullDataHTTPAuditV1) RoundTrip(request *http.Request) (*http.Response, error) {
	if audit == nil || audit.base == nil || request == nil || request.URL == nil {
		return nil, fmt.Errorf("full-data HTTP audit transport is unavailable")
	}
	requestPath := request.URL.EscapedPath()
	for _, retired := range []string{
		"/api/human/me/permission-grants",
		"/api/runtime/realm-grants/issue",
	} {
		if requestPath == retired || strings.HasPrefix(requestPath, retired+"/") {
			return nil, fmt.Errorf("retired materialization permission endpoint %s is forbidden", requestPath)
		}
	}
	if requestPath == realmV3FullDataPacketOperationPathV1 {
		if request.Method != http.MethodPost || request.URL.RawQuery != "" || audit.preparation == nil {
			return nil, fmt.Errorf("full-data Packet request operation or preparation is invalid")
		}
		var packetRequest struct {
			SourceRef               sourceMaterializationCharacterSourceRefV3 `json:"sourceRef"`
			MaterializerAccountID   string                                    `json:"materializerAccountId"`
			ChallengeID             string                                    `json:"challengeId"`
			ChallengeDigest         string                                    `json:"challengeDigest"`
			IntendedRuntimeAudience string                                    `json:"intendedRuntimeAudience"`
			ChallengeExpiresAt      string                                    `json:"challengeExpiresAt"`
			PublishedLimits         sourceMaterializationPublishedLimitsV3    `json:"publishedLimits"`
		}
		if err := realmV3FullDataDecodeHTTPRequestV1(request, &packetRequest); err != nil {
			return nil, fmt.Errorf("closed decode full-data first-party Packet request: %w", err)
		}
		expiresAt, timeErr := time.Parse(time.RFC3339Nano, packetRequest.ChallengeExpiresAt)
		authHeader := strings.TrimSpace(request.Header.Get("Authorization"))
		authenticated := strings.HasPrefix(authHeader, "Bearer ") && strings.TrimSpace(strings.TrimPrefix(authHeader, "Bearer ")) != ""
		if timeErr != nil || !authenticated || packetRequest.MaterializerAccountID != audit.preparation.AccountID ||
			!reflect.DeepEqual(packetRequest.SourceRef, audit.preparation.Request.Source.SourceRef) ||
			!reflect.DeepEqual(packetRequest.PublishedLimits, sourceMaterializationProducerCeilingsV3) {
			return nil, fmt.Errorf("full-data Packet request changed the authenticated prepared generation binding")
		}
		intent, intentErr := realmSourceMaterializationIntentDigestV3(realmSourceMaterializationRequestV3{
			AccountID: audit.preparation.AccountID, RequestID: audit.preparation.AttemptRequestID,
			SourceRef: audit.preparation.Request.Source.SourceRef,
		})
		if intentErr != nil {
			return nil, intentErr
		}
		requestHash, hashErr := realmV3FullDataCanonicalDomainHashV1(
			"nimi.realm-v3-full-data-first-party-packet-request/v1",
			packetRequest,
		)
		if hashErr != nil {
			return nil, hashErr
		}
		challenge := sourceMaterializationChallengeV3{
			ChallengeID: packetRequest.ChallengeID, ChallengeDigest: packetRequest.ChallengeDigest,
			IntendedRuntimeAudience: packetRequest.IntendedRuntimeAudience,
			RuntimeInstanceID:       audit.preparation.RuntimeInstanceID,
			MaterializerAccountID:   audit.preparation.AccountID,
			RequestID:               audit.preparation.AttemptRequestID, IntentDigest: intent,
			SourceRef: packetRequest.SourceRef, Limits: packetRequest.PublishedLimits,
			IssuedAt: expiresAt.UTC().Add(-realmSourceMaterializationChallengeTTL), ExpiresAt: expiresAt.UTC(),
		}
		audit.mu.Lock()
		audit.packetRequestCount++
		if audit.packetRequestHash != "" || audit.packetRequestCount != 1 {
			audit.protocolErr = errors.Join(audit.protocolErr, fmt.Errorf("duplicate full-data Packet request"))
		}
		audit.packetRequestHash = requestHash
		audit.packetRequestAuthenticated = authenticated
		audit.challenge = &challenge
		audit.mu.Unlock()
	}
	if request.Method == http.MethodGet && requestPath == "/api/auth/jwks/source-materialization" {
		audit.mu.Lock()
		audit.jwksRequestCount++
		if audit.jwksRequestCount != 1 {
			audit.protocolErr = errors.Join(audit.protocolErr, fmt.Errorf("duplicate current JWKS request"))
		}
		audit.mu.Unlock()
	}

	response, err := audit.base.RoundTrip(request)
	if err != nil {
		return nil, err
	}
	if response == nil {
		return nil, fmt.Errorf("full-data HTTP audit received nil response")
	}

	switch {
	case request.Method == http.MethodPost && requestPath == realmV3FullDataPacketOperationPathV1 && response.StatusCode == http.StatusCreated:
		wireBudget, budgetErr := sourceMaterializationWireBudgetV3(sourceMaterializationProducerCeilingsV3)
		if budgetErr != nil {
			_ = response.Body.Close()
			return nil, budgetErr
		}
		response.Body = newRealmV3FullDataPacketAuditBodyV1(response.Body, wireBudget, func(summary realmV3FullDataExpectedTransportV1, raw []byte, summaryErr error) {
			audit.mu.Lock()
			defer audit.mu.Unlock()
			if audit.packetSummary != nil || audit.packetSummaryErr != nil {
				audit.protocolErr = errors.Join(audit.protocolErr, fmt.Errorf("duplicate full-data Packet response"))
				return
			}
			audit.packetSummary = &summary
			audit.packetRaw = append([]byte(nil), raw...)
			audit.packetSummaryErr = summaryErr
		})
	case request.Method == http.MethodGet && requestPath == "/api/auth/jwks/source-materialization" && response.StatusCode == http.StatusOK:
		requestNoCache := strings.Contains(strings.ToLower(request.Header.Get("Cache-Control")), "no-cache") &&
			strings.Contains(strings.ToLower(request.Header.Get("Cache-Control")), "no-store") &&
			strings.Contains(strings.ToLower(request.Header.Get("Pragma")), "no-cache") &&
			strings.TrimSpace(request.Header.Get("Authorization")) == ""
		responseNoCache := realmV3FullDataHeaderDirectiveV1(response.Header.Values("Cache-Control"), "no-store") &&
			realmV3FullDataHeaderDirectiveV1(response.Header.Values("Cache-Control"), "max-age=0") &&
			realmV3FullDataHeaderDirectiveV1(response.Header.Values("Pragma"), "no-cache")
		audit.mu.Lock()
		if audit.jwksObserved || audit.jwksRequestCount != 1 {
			audit.protocolErr = errors.Join(audit.protocolErr, fmt.Errorf("duplicate current JWKS request"))
		}
		audit.jwksObserved = requestNoCache && responseNoCache
		audit.mu.Unlock()
		response.Body = newRealmV3FullDataJWKSAuditBodyV1(response.Body, sourceMaterializationJWKSMaxBytesV3, func(raw []byte) error {
			err := audit.prepareJournal(raw)
			if err != nil {
				audit.recordProtocolError(err)
			}
			return err
		})
	}
	return response, nil
}

func (audit *realmV3FullDataHTTPAuditV1) recordProtocolError(err error) {
	if err == nil {
		return
	}
	audit.mu.Lock()
	audit.protocolErr = errors.Join(audit.protocolErr, err)
	audit.mu.Unlock()
}

func realmV3FullDataDecodeHTTPRequestV1(request *http.Request, target any) error {
	var body io.ReadCloser
	if request.GetBody != nil {
		cloned, err := request.GetBody()
		if err != nil {
			return err
		}
		body = cloned
	} else {
		raw, err := io.ReadAll(io.LimitReader(request.Body, 1<<20))
		if err != nil {
			return err
		}
		if err := request.Body.Close(); err != nil {
			return err
		}
		request.Body = io.NopCloser(bytes.NewReader(raw))
		request.ContentLength = int64(len(raw))
		body = io.NopCloser(bytes.NewReader(raw))
	}
	defer body.Close()
	decoder := json.NewDecoder(io.LimitReader(body, 1<<20))
	decoder.DisallowUnknownFields()
	decoder.UseNumber()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if decoder.Decode(&struct{}{}) != io.EOF {
		return fmt.Errorf("HTTP request has trailing JSON")
	}
	return nil
}

func realmV3FullDataHeaderDirectiveV1(values []string, directive string) bool {
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

type realmV3FullDataPacketAuditBodyV1 struct {
	source   io.ReadCloser
	pipe     *io.PipeWriter
	done     chan realmV3FullDataPacketAuditResultV1
	once     sync.Once
	maxRaw   int64
	raw      bytes.Buffer
	rawErr   error
	onResult func(realmV3FullDataExpectedTransportV1, []byte, error)
}

type realmV3FullDataPacketAuditResultV1 struct {
	summary realmV3FullDataExpectedTransportV1
	err     error
}

func newRealmV3FullDataPacketAuditBodyV1(
	source io.ReadCloser,
	maxRaw int64,
	onResult func(realmV3FullDataExpectedTransportV1, []byte, error),
) *realmV3FullDataPacketAuditBodyV1 {
	reader, writer := io.Pipe()
	body := &realmV3FullDataPacketAuditBodyV1{
		source: source, pipe: writer, done: make(chan realmV3FullDataPacketAuditResultV1, 1), maxRaw: maxRaw, onResult: onResult,
	}
	go func() {
		defer reader.Close()
		body.done <- realmV3FullDataParsePacketSummaryV1(reader)
	}()
	return body
}

func (body *realmV3FullDataPacketAuditBodyV1) Read(buffer []byte) (int, error) {
	count, readErr := body.source.Read(buffer)
	if count > 0 {
		if body.rawErr == nil {
			if int64(body.raw.Len()+count) > body.maxRaw {
				body.rawErr = fmt.Errorf("full-data Packet audit capture exceeds the verified wire budget")
			} else if _, err := body.raw.Write(buffer[:count]); err != nil {
				body.rawErr = err
			}
		}
		if _, err := body.pipe.Write(buffer[:count]); err != nil {
			_ = body.pipe.CloseWithError(err)
			return count, err
		}
	}
	if readErr != nil {
		_ = body.pipe.CloseWithError(readErr)
	}
	return count, readErr
}

func (body *realmV3FullDataPacketAuditBodyV1) Close() error {
	var resultErr error
	body.once.Do(func() {
		sourceErr := body.source.Close()
		_ = body.pipe.Close()
		result := <-body.done
		result.err = errors.Join(result.err, body.rawErr)
		if body.onResult != nil {
			body.onResult(result.summary, append([]byte(nil), body.raw.Bytes()...), result.err)
		}
		body.raw.Reset()
		resultErr = errors.Join(sourceErr, result.err)
	})
	return resultErr
}

type realmV3FullDataJWKSAuditBodyV1 struct {
	source  io.ReadCloser
	maxRaw  int64
	raw     bytes.Buffer
	rawErr  error
	once    sync.Once
	onClose func([]byte) error
}

func newRealmV3FullDataJWKSAuditBodyV1(source io.ReadCloser, maxRaw int64, onClose func([]byte) error) *realmV3FullDataJWKSAuditBodyV1 {
	return &realmV3FullDataJWKSAuditBodyV1{source: source, maxRaw: maxRaw, onClose: onClose}
}

func (body *realmV3FullDataJWKSAuditBodyV1) Read(buffer []byte) (int, error) {
	count, err := body.source.Read(buffer)
	if count > 0 && body.rawErr == nil {
		if int64(body.raw.Len()+count) > body.maxRaw {
			body.rawErr = fmt.Errorf("full-data current JWKS audit capture exceeds the fixed read bound")
		} else if _, writeErr := body.raw.Write(buffer[:count]); writeErr != nil {
			body.rawErr = writeErr
		}
	}
	return count, err
}

func (body *realmV3FullDataJWKSAuditBodyV1) Close() error {
	var result error
	body.once.Do(func() {
		if body.rawErr == nil && int64(body.raw.Len()) <= body.maxRaw {
			remaining := body.maxRaw - int64(body.raw.Len())
			tail, readErr := io.ReadAll(io.LimitReader(body.source, remaining+1))
			if readErr != nil {
				body.rawErr = readErr
			} else if int64(len(tail)) > remaining {
				body.rawErr = fmt.Errorf("full-data current JWKS audit capture exceeds the fixed read bound")
			} else if _, writeErr := body.raw.Write(tail); writeErr != nil {
				body.rawErr = writeErr
			}
		}
		sourceErr := body.source.Close()
		var callbackErr error
		if body.onClose != nil && body.rawErr == nil {
			callbackErr = body.onClose(append([]byte(nil), body.raw.Bytes()...))
		}
		body.raw.Reset()
		result = errors.Join(sourceErr, body.rawErr, callbackErr)
	})
	return result
}

func realmV3FullDataParsePacketSummaryV1(reader io.Reader) realmV3FullDataPacketAuditResultV1 {
	var packet struct {
		PacketHash                 string `json:"packetHash"`
		ClosureSetManifestHash     string `json:"closureSetManifestHash"`
		MaterializationContextHash string `json:"materializationContextHash"`
		PayloadHash                string `json:"payloadHash"`
		ClosureSetManifest         struct {
			OrderedComponentSetHash string `json:"orderedComponentSetHash"`
			SegmentCount            uint64 `json:"segmentCount"`
			ComponentCount          uint64 `json:"componentCount"`
			ChunkCount              uint64 `json:"chunkCount"`
			TotalCanonicalBytes     uint64 `json:"totalCanonicalBytes"`
		} `json:"closureSetManifest"`
	}
	decoder := json.NewDecoder(reader)
	if err := decoder.Decode(&packet); err != nil {
		return realmV3FullDataPacketAuditResultV1{err: fmt.Errorf("stream full-data Packet audit summary: %w", err)}
	}
	if decoder.Decode(&struct{}{}) != io.EOF {
		return realmV3FullDataPacketAuditResultV1{err: fmt.Errorf("full-data Packet response has trailing JSON")}
	}
	return realmV3FullDataPacketAuditResultV1{summary: realmV3FullDataExpectedTransportV1{
		PacketHash: packet.PacketHash, ClosureSetManifestHash: packet.ClosureSetManifestHash,
		OrderedComponentSetHash:    packet.ClosureSetManifest.OrderedComponentSetHash,
		MaterializationContextHash: packet.MaterializationContextHash, PayloadHash: packet.PayloadHash,
		SegmentCount: packet.ClosureSetManifest.SegmentCount, ComponentCount: packet.ClosureSetManifest.ComponentCount,
		ChunkCount: packet.ClosureSetManifest.ChunkCount, CanonicalBytes: packet.ClosureSetManifest.TotalCanonicalBytes,
	}}
}

func (audit *realmV3FullDataHTTPAuditV1) evidence(
	t *testing.T,
	request realmV3FullDataPartitionRequestV1,
) (realmV3FullDataLiveAuthorizationV1, realmV3FullDataExpectedTransportV1) {
	t.Helper()
	authorization, transport, err := audit.evidenceValue(request)
	if err != nil {
		t.Fatalf("current Realm HTTP audit is invalid: %v", err)
	}
	return authorization, transport
}

func (audit *realmV3FullDataHTTPAuditV1) evidenceValue(
	request realmV3FullDataPartitionRequestV1,
) (realmV3FullDataLiveAuthorizationV1, realmV3FullDataExpectedTransportV1, error) {
	audit.mu.Lock()
	defer audit.mu.Unlock()
	if audit.preparation == nil || audit.protocolErr != nil || audit.packetSummaryErr != nil || audit.packetSummary == nil ||
		audit.packetRequestHash == "" || !audit.packetRequestAuthenticated || !audit.jwksObserved ||
		audit.packetRequestCount != 1 || audit.jwksRequestCount != 1 {
		return realmV3FullDataLiveAuthorizationV1{}, realmV3FullDataExpectedTransportV1{}, fmt.Errorf(
			"audit is incomplete: protocol=%v packet=%v", audit.protocolErr, audit.packetSummaryErr,
		)
	}
	if !reflect.DeepEqual(request.AuthorizationBoundary, realmV3FullDataExpectedAuthorizationBoundaryV1()) {
		return realmV3FullDataLiveAuthorizationV1{}, realmV3FullDataExpectedTransportV1{}, fmt.Errorf("authorization boundary is not the admitted first-party operation")
	}
	boundaryDigest, err := realmV3FullDataCanonicalDomainHashV1(
		"nimi.realm-v3-full-data-authorization-boundary/v1",
		request.AuthorizationBoundary,
	)
	if err != nil {
		return realmV3FullDataLiveAuthorizationV1{}, realmV3FullDataExpectedTransportV1{}, err
	}
	authorization := realmV3FullDataLiveAuthorizationV1{
		LiveAuthorizationProven:           true,
		AccessPolicyVersion:               realmV3FullDataAccessPolicyVersionV5,
		AccessPolicyDigest:                request.Identity.Realm.PolicyDigest,
		AuthorityClass:                    realmV3FullDataAuthorityClassV1,
		AuthorizationBoundaryDigest:       boundaryDigest,
		AuthenticatedAccountIDHash:        sha256HexBytes([]byte(audit.preparation.AccountID)),
		PacketOperation:                   realmV3FullDataPacketOperationV1Value(),
		PacketRequestHash:                 audit.packetRequestHash,
		PacketRequestAuthenticated:        true,
		CanonicalSourceVisibilityEnforced: true,
		SourceVisibilityDecisionOwner:     "realm",
		ThirdPartyAppPermissionRequired:   false,
		PermissionCatalog:                 realmV3FullDataPermissionCatalogV1,
		ForbiddenInputObserved:            false,
		SyntheticDecisionObserved:         false,
		FreshChallenge:                    true,
		FreshNonce:                        true,
		FreshTTL:                          true,
		CurrentJWKS:                       true,
	}
	transport := *audit.packetSummary
	for field, value := range map[string]string{
		"packetHash": transport.PacketHash, "closureSetManifestHash": transport.ClosureSetManifestHash,
		"orderedComponentSetHash":    transport.OrderedComponentSetHash,
		"materializationContextHash": transport.MaterializationContextHash, "payloadHash": transport.PayloadHash,
	} {
		if !isLowerSHA256V3(value) {
			return realmV3FullDataLiveAuthorizationV1{}, realmV3FullDataExpectedTransportV1{}, fmt.Errorf("Packet audit %s is invalid", field)
		}
	}
	if transport.SegmentCount == 0 || transport.ComponentCount == 0 || transport.ChunkCount == 0 || transport.CanonicalBytes == 0 {
		return realmV3FullDataLiveAuthorizationV1{}, realmV3FullDataExpectedTransportV1{}, fmt.Errorf("Packet audit counts are incomplete")
	}
	return authorization, transport, nil
}

func (audit *realmV3FullDataHTTPAuditV1) prepareJournal(jwksRaw []byte) error {
	if audit == nil || audit.preparation == nil {
		return fmt.Errorf("full-data precommit audit preparation is unavailable")
	}
	audit.mu.Lock()
	packetRaw := append([]byte(nil), audit.packetRaw...)
	var challenge sourceMaterializationChallengeV3
	if audit.challenge != nil {
		challenge = *audit.challenge
	}
	audit.packetRaw = nil
	audit.mu.Unlock()
	defer func() {
		for index := range packetRaw {
			packetRaw[index] = 0
		}
		for index := range jwksRaw {
			jwksRaw[index] = 0
		}
	}()
	if len(packetRaw) == 0 || len(jwksRaw) == 0 || challenge.ChallengeID == "" {
		return fmt.Errorf("full-data precommit audit transport capture is incomplete: packet=%d jwks=%d challenge=%t", len(packetRaw), len(jwksRaw), challenge.ChallengeID != "")
	}
	var packetAuthority struct {
		AccessPolicyVersionDigest string `json:"accessPolicyVersionDigest"`
	}
	if err := json.Unmarshal(packetRaw, &packetAuthority); err != nil {
		return fmt.Errorf("inspect original Packet authority before independent verification: %w", err)
	}
	if packetAuthority.AccessPolicyVersionDigest != audit.preparation.Request.Identity.Realm.PolicyDigest {
		return fmt.Errorf(
			"original Packet policy digest differs from frozen authority: packet=%s frozen=%s",
			packetAuthority.AccessPolicyVersionDigest,
			audit.preparation.Request.Identity.Realm.PolicyDigest,
		)
	}
	verified, err := verifySourceMaterializationPacketV3(
		bytes.NewReader(packetRaw),
		bytes.NewReader(jwksRaw),
		sourceMaterializationVerificationExpectationV3{
			Challenge: challenge, ExpectedIssuer: audit.preparation.Request.LiveEnvironment.ExpectedIssuer,
			ExpectedAccessPolicyDigest: audit.preparation.Request.Identity.Realm.PolicyDigest, Now: time.Now().UTC(),
		},
	)
	if err != nil {
		return fmt.Errorf("independently verify original Packet before Runtime commit: %w", err)
	}
	authorization, transport, err := audit.evidenceValue(audit.preparation.Request)
	if err != nil {
		return err
	}
	if err := validateRealmV3FullDataVerifiedTransportV1(verified, transport); err != nil {
		return err
	}
	journal := realmV3FullDataAuditJournalV2{
		SchemaVersion: realmV3FullDataAuditJournalSchemaV2, Phase: realmV3FullDataAuditPhasePreparedV2,
		InputDigest: audit.preparation.Request.InputDigest, PartitionKey: audit.preparation.Request.PartitionKey,
		SourceRefHash:         audit.preparation.Request.Source.SourceRefHash,
		LiveEnvironmentDigest: realmV3FullDataLiveEnvironmentDigestValueV1(audit.preparation.Request.LiveEnvironment),
		Generation:            audit.preparation.Generation, AttemptRequestIDHash: sha256HexBytes([]byte(audit.preparation.AttemptRequestID)),
		Authorization: authorization, Transport: transport,
	}
	if err := validateRealmV3FullDataAuditJournalV2(journal, audit.preparation.Request, audit.preparation.Generation, audit.preparation.AttemptRequestID); err != nil {
		return err
	}
	if err := writeRealmV3FullDataAuditJournalAtomicV2(audit.preparation.JournalPath, journal, false); err != nil {
		return fmt.Errorf("durably write prepared full-data audit journal before Runtime commit: %w", err)
	}
	realmV3FullDataAfterPreparedHookMuV1.Lock()
	afterPrepared := realmV3FullDataAfterPreparedHookV1
	realmV3FullDataAfterPreparedHookV1 = nil
	realmV3FullDataAfterPreparedHookMuV1.Unlock()
	if afterPrepared != nil {
		afterPrepared()
	}
	verified.CanonicalComponentBytes = nil
	verified.OrderedComponentIDs = nil
	return nil
}

func validateRealmV3FullDataVerifiedTransportV1(verified verifiedSourceMaterializationV3, want realmV3FullDataExpectedTransportV1) error {
	manifest := verified.Packet.ClosureSetManifest
	var canonicalBytes uint64
	for _, segment := range manifest.Segments {
		canonicalBytes += segment.TotalCanonicalBytes
	}
	got := realmV3FullDataExpectedTransportV1{
		PacketHash: verified.Packet.PacketHash, ClosureSetManifestHash: verified.Packet.ClosureSetManifestHash,
		OrderedComponentSetHash:    manifest.OrderedComponentSetHash,
		MaterializationContextHash: verified.Packet.MaterializationContextHash, PayloadHash: verified.Packet.PayloadHash,
		SegmentCount: manifest.SegmentCount, ComponentCount: manifest.ComponentCount,
		ChunkCount: manifest.ChunkCount, CanonicalBytes: canonicalBytes,
	}
	if !reflect.DeepEqual(got, want) {
		return fmt.Errorf("independent precommit transport verification differs from the observed Packet summary")
	}
	return nil
}

func realmV3FullDataLiveEnvironmentDigestValueV1(environment *realmV3FullDataLiveEnvironmentV1) string {
	if environment == nil {
		return ""
	}
	digest, err := realmV3FullDataCanonicalDomainHashV1("nimi.realm-v3-full-data-live-environment/v1", environment)
	if err != nil {
		return ""
	}
	return digest
}
