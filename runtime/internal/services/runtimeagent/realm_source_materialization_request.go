package runtimeagent

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
)

const (
	realmSourceMaterializationRequestIDMaxBytesV3 = 256
	realmSourceMaterializationChallengeTTL        = 10 * time.Minute
	realmSourceMaterializationIntentDomainV3      = "nimi.runtime.realm-source-materialization-intent/v3\x00"
)

type realmSourceMaterializationRequestV3 struct {
	AccountID string
	RequestID string
	SourceRef sourceMaterializationCharacterSourceRefV3
}

func validateRealmSourceMaterializationRequestV3(ctx context.Context, req *runtimev1.MaterializeRealmSourceRequest) (realmSourceMaterializationRequestV3, error) {
	identity := authn.IdentityFromContext(ctx)
	if identity == nil || strings.TrimSpace(identity.SubjectUserID) == "" {
		return realmSourceMaterializationRequestV3{}, status.Error(codes.Unauthenticated, "authenticated materializer account is required")
	}
	if req == nil || req.GetContext() == nil {
		return realmSourceMaterializationRequestV3{}, status.Error(codes.InvalidArgument, "Realm source materialization request context is required")
	}
	if hasRealmSourceMaterializationUnknownProtoV3(req) || hasRealmSourceMaterializationUnknownProtoV3(req.GetContext()) {
		return realmSourceMaterializationRequestV3{}, status.Error(codes.InvalidArgument, "Realm source materialization request contains unknown fields")
	}
	accountID := strings.TrimSpace(identity.SubjectUserID)
	requestContext := req.GetContext()
	if identity.SubjectUserID != accountID || requestContext.GetSubjectUserId() != accountID || requestContext.GetOwnerUserId() != accountID {
		return realmSourceMaterializationRequestV3{}, status.Error(codes.PermissionDenied, "Realm source materialization account binding mismatch")
	}
	if appID := requestContext.GetAppId(); appID == "" || appID != strings.TrimSpace(appID) {
		return realmSourceMaterializationRequestV3{}, status.Error(codes.InvalidArgument, "Realm source materialization app_id is required")
	}
	if requestContext.GetScopedBinding() != nil || requestContext.GetRuntimeSourceRef() != "" || requestContext.GetLocalAgentRef() != "" {
		return realmSourceMaterializationRequestV3{}, status.Error(codes.InvalidArgument, "caller-selected binding or LocalAgent identity is not admitted")
	}
	requestID := req.GetRequestId()
	if requestID == "" || requestID != strings.TrimSpace(requestID) || len(requestID) > realmSourceMaterializationRequestIDMaxBytesV3 || !utf8.ValidString(requestID) || strings.IndexByte(requestID, 0) >= 0 {
		return realmSourceMaterializationRequestV3{}, status.Error(codes.InvalidArgument, "Realm source materialization request_id is invalid")
	}
	for _, char := range requestID {
		if char < 0x20 || char == 0x7f {
			return realmSourceMaterializationRequestV3{}, status.Error(codes.InvalidArgument, "Realm source materialization request_id contains control characters")
		}
	}
	sourceRef, err := sourceMaterializationRefFromProtoV3(req.GetSourceRef())
	if err != nil {
		return realmSourceMaterializationRequestV3{}, status.Error(codes.InvalidArgument, err.Error())
	}
	return realmSourceMaterializationRequestV3{AccountID: accountID, RequestID: requestID, SourceRef: sourceRef}, nil
}

func sourceMaterializationRefFromProtoV3(ref *runtimev1.CharacterSourceRefV3) (sourceMaterializationCharacterSourceRefV3, error) {
	if ref == nil {
		return sourceMaterializationCharacterSourceRefV3{}, fmt.Errorf("CharacterSourceRefV3 is required")
	}
	if hasRealmSourceMaterializationUnknownProtoV3(ref) {
		return sourceMaterializationCharacterSourceRefV3{}, fmt.Errorf("CharacterSourceRefV3 contains unknown fields")
	}
	var result sourceMaterializationCharacterSourceRefV3
	switch branch := ref.GetSource().(type) {
	case *runtimev1.CharacterSourceRefV3_WorldCharacter:
		value := branch.WorldCharacter
		if value == nil || value.GetKind() != runtimev1.CharacterSourceKindV3_CHARACTER_SOURCE_KIND_V3_WORLD_CHARACTER ||
			value.GetWorldEntityRef() == nil || value.GetWorldEntityRef().GetKind() != runtimev1.WorldEntityRefKindV3_WORLD_ENTITY_REF_KIND_V3_WORLD_ENTITY {
			return sourceMaterializationCharacterSourceRefV3{}, fmt.Errorf("WorldCharacter source discriminator is invalid")
		}
		if hasRealmSourceMaterializationUnknownProtoV3(value) || hasRealmSourceMaterializationUnknownProtoV3(value.GetWorldEntityRef()) {
			return sourceMaterializationCharacterSourceRefV3{}, fmt.Errorf("WorldCharacter source contains unknown fields")
		}
		result = sourceMaterializationCharacterSourceRefV3{
			Kind: "worldCharacter", ID: value.GetId(), WorldID: value.GetWorldId(), SourceHash: value.GetSourceHash(),
			WorldEntityRef: &sourceMaterializationWorldEntityRefV3{
				Kind: "worldEntity", WorldID: value.GetWorldEntityRef().GetWorldId(), EntityID: value.GetWorldEntityRef().GetEntityId(),
			},
		}
	case *runtimev1.CharacterSourceRefV3_PersonaCharacter:
		value := branch.PersonaCharacter
		if value == nil || value.GetKind() != runtimev1.CharacterSourceKindV3_CHARACTER_SOURCE_KIND_V3_PERSONA_CHARACTER {
			return sourceMaterializationCharacterSourceRefV3{}, fmt.Errorf("PersonaCharacter source discriminator is invalid")
		}
		if hasRealmSourceMaterializationUnknownProtoV3(value) {
			return sourceMaterializationCharacterSourceRefV3{}, fmt.Errorf("PersonaCharacter source contains unknown fields")
		}
		result = sourceMaterializationCharacterSourceRefV3{
			Kind: "personaCharacter", ID: value.GetId(), WorldID: value.GetWorldId(), OwnerAccountID: value.GetOwnerAccountId(), SourceHash: value.GetSourceHash(),
		}
	default:
		return sourceMaterializationCharacterSourceRefV3{}, fmt.Errorf("CharacterSourceRefV3 branch is invalid")
	}
	if err := result.validate(); err != nil {
		return sourceMaterializationCharacterSourceRefV3{}, err
	}
	return result, nil
}

func hasRealmSourceMaterializationUnknownProtoV3(message proto.Message) bool {
	return message != nil && len(message.ProtoReflect().GetUnknown()) != 0
}

func sourceMaterializationProtoRefV3(ref sourceMaterializationCharacterSourceRefV3) *runtimev1.CharacterSourceRefV3 {
	if ref.Kind == "worldCharacter" && ref.WorldEntityRef != nil {
		return &runtimev1.CharacterSourceRefV3{Source: &runtimev1.CharacterSourceRefV3_WorldCharacter{WorldCharacter: &runtimev1.WorldCharacterSourceRefV3{
			Kind: runtimev1.CharacterSourceKindV3_CHARACTER_SOURCE_KIND_V3_WORLD_CHARACTER,
			Id:   ref.ID, WorldId: ref.WorldID, SourceHash: ref.SourceHash,
			WorldEntityRef: &runtimev1.WorldEntityRefV3{
				Kind:    runtimev1.WorldEntityRefKindV3_WORLD_ENTITY_REF_KIND_V3_WORLD_ENTITY,
				WorldId: ref.WorldEntityRef.WorldID, EntityId: ref.WorldEntityRef.EntityID,
			},
		}}}
	}
	if ref.Kind == "personaCharacter" {
		return &runtimev1.CharacterSourceRefV3{Source: &runtimev1.CharacterSourceRefV3_PersonaCharacter{PersonaCharacter: &runtimev1.PersonaCharacterSourceRefV3{
			Kind: runtimev1.CharacterSourceKindV3_CHARACTER_SOURCE_KIND_V3_PERSONA_CHARACTER,
			Id:   ref.ID, WorldId: ref.WorldID, OwnerAccountId: ref.OwnerAccountID, SourceHash: ref.SourceHash,
		}}}
	}
	return nil
}

func sourceMaterializationProtoRefV3ID(ref *runtimev1.CharacterSourceRefV3) string {
	if ref == nil {
		return ""
	}
	if world := ref.GetWorldCharacter(); world != nil {
		return world.GetId()
	}
	if persona := ref.GetPersonaCharacter(); persona != nil {
		return persona.GetId()
	}
	return ""
}

func canonicalRealmSourceMaterializationRefV3(ref sourceMaterializationCharacterSourceRefV3) ([]byte, error) {
	return canonicalizeSourceMaterializationRealmV3(ref)
}

func realmSourceMaterializationIntentDigestV3(request realmSourceMaterializationRequestV3) (string, error) {
	return hashSourceMaterializationRealmDomainV3(realmSourceMaterializationIntentDomainV3, map[string]any{
		"materializerAccountId": request.AccountID,
		"requestId":             request.RequestID,
		"sourceRef":             request.SourceRef,
	})
}

func newRealmSourceMaterializationChallengeV3(
	runtimeInstanceID string,
	request realmSourceMaterializationRequestV3,
	intentDigest string,
	now time.Time,
) (sourceMaterializationChallengeV3, error) {
	if runtimeInstanceID == "" || runtimeInstanceID != strings.TrimSpace(runtimeInstanceID) {
		return sourceMaterializationChallengeV3{}, fmt.Errorf("Realm source materialization Runtime identity is unavailable")
	}
	var nonce [16]byte
	if _, err := rand.Read(nonce[:]); err != nil {
		return sourceMaterializationChallengeV3{}, fmt.Errorf("generate Realm source challenge id: %w", err)
	}
	challengeID := "challenge-v3-" + hex.EncodeToString(nonce[:])
	audience := "runtime-instance:" + runtimeInstanceID + ":" + request.AccountID
	digestValue := map[string]any{
		"schemaVersion":           "realm.fullchain-challenge/v1",
		"challengeId":             challengeID,
		"intendedRuntimeAudience": audience,
		"materializerAccountId":   request.AccountID,
		"sourceRef":               request.SourceRef,
	}
	canonical, err := canonicalizeSourceMaterializationRealmV3(digestValue)
	if err != nil {
		return sourceMaterializationChallengeV3{}, fmt.Errorf("canonicalize Realm source challenge: %w", err)
	}
	issuedAt := now.UTC().Truncate(time.Millisecond)
	return sourceMaterializationChallengeV3{
		ChallengeID: challengeID, ChallengeDigest: sha256HexBytes(canonical), IntendedRuntimeAudience: audience,
		RuntimeInstanceID: runtimeInstanceID, MaterializerAccountID: request.AccountID,
		RequestID: request.RequestID, IntentDigest: intentDigest, SourceRef: request.SourceRef,
		Limits: sourceMaterializationProducerCeilingsV3, IssuedAt: issuedAt, ExpiresAt: issuedAt.Add(realmSourceMaterializationChallengeTTL),
	}, nil
}

type realmSourceMaterializationRequestLockV3 struct {
	mu   sync.Mutex
	refs int
}

type realmSourceMaterializationRequestLocksV3 struct {
	mu    sync.Mutex
	locks map[string]*realmSourceMaterializationRequestLockV3
}

func newRealmSourceMaterializationRequestLocksV3() *realmSourceMaterializationRequestLocksV3 {
	return &realmSourceMaterializationRequestLocksV3{locks: make(map[string]*realmSourceMaterializationRequestLockV3)}
}

func (l *realmSourceMaterializationRequestLocksV3) acquire(accountID, requestID string) func() {
	key := accountID + "\x00" + requestID
	l.mu.Lock()
	item := l.locks[key]
	if item == nil {
		item = &realmSourceMaterializationRequestLockV3{}
		l.locks[key] = item
	}
	item.refs++
	l.mu.Unlock()
	item.mu.Lock()
	return func() {
		item.mu.Unlock()
		l.mu.Lock()
		item.refs--
		if item.refs == 0 {
			delete(l.locks, key)
		}
		l.mu.Unlock()
	}
}

func realmSourceMaterializationReasonCodeV3(code sourceMaterializationFailureCodeV3) runtimev1.RealmSourceMaterializationReasonCode {
	switch code {
	case sourceMaterializationFailureInvalidRequestV3:
		return runtimev1.RealmSourceMaterializationReasonCode_REALM_SOURCE_MATERIALIZATION_REASON_CODE_INVALID_REQUEST
	case sourceMaterializationFailureRequestConflictV3, sourceMaterializationFailureCommitInProgressV3:
		return runtimev1.RealmSourceMaterializationReasonCode_REALM_SOURCE_MATERIALIZATION_REASON_CODE_REQUEST_CONFLICT
	case sourceMaterializationFailureAcquisitionDeniedV3:
		return runtimev1.RealmSourceMaterializationReasonCode_REALM_SOURCE_MATERIALIZATION_REASON_CODE_ACQUISITION_DENIED
	case sourceMaterializationFailureIssuerUnavailableV3:
		return runtimev1.RealmSourceMaterializationReasonCode_REALM_SOURCE_MATERIALIZATION_REASON_CODE_ACQUISITION_FAILED
	case sourceMaterializationFailureAccountBindingV3, sourceMaterializationFailureSourceBindingV3,
		sourceMaterializationFailureAudienceV3, sourceMaterializationFailureChallengeDigestV3:
		return runtimev1.RealmSourceMaterializationReasonCode_REALM_SOURCE_MATERIALIZATION_REASON_CODE_BINDING_MISMATCH
	case sourceMaterializationFailureCapacityV3:
		return runtimev1.RealmSourceMaterializationReasonCode_REALM_SOURCE_MATERIALIZATION_REASON_CODE_CAPACITY_EXCEEDED
	case sourceMaterializationFailureCurrentKeyV3:
		return runtimev1.RealmSourceMaterializationReasonCode_REALM_SOURCE_MATERIALIZATION_REASON_CODE_JWKS_INVALID
	case sourceMaterializationFailureProofV3:
		return runtimev1.RealmSourceMaterializationReasonCode_REALM_SOURCE_MATERIALIZATION_REASON_CODE_PROOF_INVALID
	case sourceMaterializationFailureReplayV3:
		return runtimev1.RealmSourceMaterializationReasonCode_REALM_SOURCE_MATERIALIZATION_REASON_CODE_REPLAY_DETECTED
	case sourceMaterializationFailurePersistenceV3, sourceMaterializationFailureCleanupV3:
		return runtimev1.RealmSourceMaterializationReasonCode_REALM_SOURCE_MATERIALIZATION_REASON_CODE_PERSISTENCE_FAILED
	default:
		return runtimev1.RealmSourceMaterializationReasonCode_REALM_SOURCE_MATERIALIZATION_REASON_CODE_PACKET_INVALID
	}
}
