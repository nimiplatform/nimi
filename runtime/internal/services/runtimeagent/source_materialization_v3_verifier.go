package runtimeagent

import (
	"bytes"
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"io"
	"math"
	"math/big"
	"strings"
	"time"

	realmv1 "github.com/nimiplatform/nimi/runtime/gen/realm/v1"
)

type sourceMaterializationVerificationExpectationV3 struct {
	Challenge                  sourceMaterializationChallengeV3
	ExpectedIssuer             string
	ExpectedAccessPolicyDigest string
	Now                        time.Time
}

type sourceMaterializationJWKSV3 struct {
	Keys []sourceMaterializationJWKKeyV3 `json:"keys"`
}

type sourceMaterializationJWKKeyV3 struct {
	KeyType    string   `json:"kty"`
	KeyID      string   `json:"kid"`
	Use        string   `json:"use"`
	Algorithm  string   `json:"alg"`
	Operations []string `json:"key_ops"`
	Modulus    string   `json:"n"`
	Exponent   string   `json:"e"`
	Purpose    string   `json:"purpose"`
}

type sourceMaterializationProtectedHeaderV3 struct {
	Algorithm string `json:"alg"`
	KeyID     string `json:"kid"`
	Type      string `json:"typ"`
}

// verifySourceMaterializationPacketV3 is the pure Runtime verifier boundary.
// Packet input is decoded from private seekable staging through bounded
// lexical, structural, and typed passes; the small current JWKS document uses
// a bounded max+1 read. The returned replay binding is inserted by the product
// committer in the same SQLite transaction as LocalAgent, Snapshot and
// provenance.
func verifySourceMaterializationPacketV3(
	packetBody io.ReadSeeker,
	currentJWKSBody io.Reader,
	expected sourceMaterializationVerificationExpectationV3,
) (verifiedSourceMaterializationV3, error) {
	if packetBody == nil || currentJWKSBody == nil {
		return verifiedSourceMaterializationV3{}, sourceMaterializationV3Error(sourceMaterializationFailureIssuerUnavailableV3, "verification body is unavailable")
	}
	if err := validateSourceMaterializationExpectationV3(expected); err != nil {
		return verifiedSourceMaterializationV3{}, err
	}
	wireBudget, err := sourceMaterializationWireBudgetV3(expected.Challenge.Limits)
	if err != nil {
		return verifiedSourceMaterializationV3{}, err
	}
	packet, err := decodeSourceMaterializationPacketStreamV3(packetBody, wireBudget, expected.Challenge.Limits)
	if err != nil {
		return verifiedSourceMaterializationV3{}, err
	}
	if err := validateSourceMaterializationPacketV3(&packet, expected); err != nil {
		return verifiedSourceMaterializationV3{}, err
	}

	jwksBytes, err := readSourceMaterializationBoundedBodyV3(currentJWKSBody, sourceMaterializationJWKSMaxBytesV3)
	if err != nil {
		return verifiedSourceMaterializationV3{}, err
	}
	jwksValue, err := decodeSourceMaterializationJSON(jwksBytes)
	if err != nil {
		return verifiedSourceMaterializationV3{}, sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "decode current JWKS: %v", err)
	}
	if err := validateSourceMaterializationJWKSShapeV3(jwksValue); err != nil {
		return verifiedSourceMaterializationV3{}, err
	}
	if err := validateGeneratedRealmResponseFieldsV3(
		realmv1.GetSourceMaterializationJwksOperationID,
		"$",
		jwksValue,
	); err != nil {
		return verifiedSourceMaterializationV3{}, err
	}
	var jwks sourceMaterializationJWKSV3
	if err := strictDecodeSourceMaterializationV3(jwksBytes, &jwks); err != nil {
		return verifiedSourceMaterializationV3{}, err
	}
	keyFingerprint, err := verifySourceMaterializationDetachedProofV3(packet, jwks)
	if err != nil {
		return verifiedSourceMaterializationV3{}, err
	}
	componentBytes, componentIDs, err := verifySourceMaterializationTransportV3(&packet)
	if err != nil {
		return verifiedSourceMaterializationV3{}, err
	}
	releaseSourceMaterializationPacketTransportV3(&packet)
	replayBinding, err := sourceMaterializationReplayBindingV3(packet)
	if err != nil {
		return verifiedSourceMaterializationV3{}, sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "build replay binding: %v", err)
	}
	nonceDigest, err := sourceMaterializationNonceReplayDigestV3(packet)
	if err != nil {
		return verifiedSourceMaterializationV3{}, sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "build nonce replay digest: %v", err)
	}
	return verifiedSourceMaterializationV3{
		Packet: packet, CanonicalComponentBytes: componentBytes, OrderedComponentIDs: componentIDs,
		SigningKeyFingerprint: keyFingerprint, ReplayBindingHash: replayBinding, NonceReplayDigest: nonceDigest,
		VerifiedAt: expected.Now.UTC(),
	}, nil
}

func validateGeneratedRealmResponseFieldsV3(operationID, path string, value any) error {
	switch typed := value.(type) {
	case map[string]any:
		fields := make([]string, 0, len(typed))
		for field := range typed {
			fields = append(fields, field)
		}
		if known, valid := realmv1.ValidateMaterializationResponseObjectFields(operationID, path, fields); known && !valid {
			return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "Realm response object %s violates the generated OpenAPI field closure", path)
		}
		for field, child := range typed {
			if err := validateGeneratedRealmResponseFieldsV3(operationID, path+"."+field, child); err != nil {
				return err
			}
		}
	case []any:
		for _, child := range typed {
			if err := validateGeneratedRealmResponseFieldsV3(operationID, path+"[]", child); err != nil {
				return err
			}
		}
	}
	return nil
}

func readSourceMaterializationBoundedBodyV3(reader io.Reader, maxBytes int64) ([]byte, error) {
	if reader == nil || maxBytes <= 0 || maxBytes == math.MaxInt64 {
		return nil, sourceMaterializationV3Error(sourceMaterializationFailureCapacityV3, "invalid body read limit")
	}
	limited := &io.LimitedReader{R: reader, N: maxBytes + 1}
	body, err := io.ReadAll(limited)
	if err != nil {
		return nil, sourceMaterializationV3Error(sourceMaterializationFailureIssuerUnavailableV3, "read verification body: %v", err)
	}
	if int64(len(body)) > maxBytes {
		return nil, sourceMaterializationV3Error(sourceMaterializationFailureCapacityV3, "verification body exceeds its wire budget")
	}
	return body, nil
}

func validateSourceMaterializationExpectationV3(expected sourceMaterializationVerificationExpectationV3) error {
	if err := expected.Challenge.SourceRef.validate(); err != nil {
		return err
	}
	if err := expected.Challenge.Limits.validate(); err != nil {
		return err
	}
	for field, value := range map[string]string{
		"challengeId": expected.Challenge.ChallengeID, "challengeDigest": expected.Challenge.ChallengeDigest,
		"intendedRuntimeAudience": expected.Challenge.IntendedRuntimeAudience,
		"materializerAccountId":   expected.Challenge.MaterializerAccountID, "issuer": expected.ExpectedIssuer,
	} {
		if err := requireSourceMaterializationV3Text(value, field); err != nil {
			return err
		}
	}
	if !isLowerSHA256V3(expected.Challenge.ChallengeDigest) || !isLowerSHA256V3(expected.ExpectedAccessPolicyDigest) {
		return sourceMaterializationV3Error(sourceMaterializationFailureInvalidRequestV3, "expected challenge or policy digest is invalid")
	}
	if expected.Now.IsZero() || expected.Challenge.IssuedAt.IsZero() || expected.Challenge.ExpiresAt.IsZero() ||
		!expected.Challenge.IssuedAt.Before(expected.Challenge.ExpiresAt) || !expected.Now.Before(expected.Challenge.ExpiresAt) {
		return sourceMaterializationV3Error(sourceMaterializationFailureExpiredV3, "challenge is not currently valid")
	}
	return nil
}

func verifySourceMaterializationDetachedProofV3(packet sourceMaterializationPacketV3Value, jwks sourceMaterializationJWKSV3) (string, error) {
	if len(jwks.Keys) == 0 || !sourceMaterializationSortedUniqueV3(jwks.Keys, func(value sourceMaterializationJWKKeyV3) string { return value.KeyID }) {
		return "", sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "current JWKS keys are empty, duplicated, or unsorted")
	}
	var selected *sourceMaterializationJWKKeyV3
	for index := range jwks.Keys {
		key := &jwks.Keys[index]
		if key.KeyType != "RSA" || key.Use != "sig" || key.Algorithm != "RS256" || key.Purpose != "realm-source-materialization" ||
			len(key.Operations) != 1 || key.Operations[0] != "verify" {
			return "", sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "current JWKS key %d is not admitted", index)
		}
		for field, value := range map[string]string{"kid": key.KeyID, "n": key.Modulus, "e": key.Exponent} {
			if err := requireSourceMaterializationV3Text(value, "jwks."+field); err != nil {
				return "", err
			}
		}
		if key.KeyID == packet.KeyID {
			selected = key
		}
	}
	if selected == nil {
		return "", sourceMaterializationV3Error(sourceMaterializationFailureCurrentKeyV3, "packet key id is absent from the current authoritative JWKS")
	}
	publicKey, err := sourceMaterializationRSAPublicKeyV3(*selected)
	if err != nil {
		return "", err
	}
	parts := strings.Split(packet.PacketProof.CompactJWS, ".")
	if len(parts) != 3 || parts[0] == "" || parts[1] != "" || parts[2] == "" || len(packet.PacketProof.CompactJWS) > sourceMaterializationMaxProofBytesV3 {
		return "", sourceMaterializationV3Error(sourceMaterializationFailureProofV3, "detached JWS compact serialization is invalid")
	}
	headerBytes, err := decodeSourceMaterializationBase64URLV3(parts[0])
	if err != nil {
		return "", sourceMaterializationV3Error(sourceMaterializationFailureProofV3, "detached JWS header is invalid")
	}
	headerValue, err := decodeSourceMaterializationJSON(headerBytes)
	if err != nil {
		return "", sourceMaterializationV3Error(sourceMaterializationFailureProofV3, "detached JWS header JSON is invalid")
	}
	if _, err := sourceMaterializationClosedObjectV3(headerValue, "$.protected", []string{"alg", "kid", "typ"}, nil); err != nil {
		return "", sourceMaterializationV3Error(sourceMaterializationFailureProofV3, "detached JWS header is not closed")
	}
	var header sourceMaterializationProtectedHeaderV3
	if err := strictDecodeSourceMaterializationV3(headerBytes, &header); err != nil {
		return "", sourceMaterializationV3Error(sourceMaterializationFailureProofV3, "detached JWS header is invalid")
	}
	if header.Algorithm != "RS256" || header.KeyID != packet.KeyID || header.Type != "realm-source-materialization" {
		return "", sourceMaterializationV3Error(sourceMaterializationFailureProofV3, "detached JWS protected header does not match the packet")
	}
	signature, err := decodeSourceMaterializationBase64URLV3(parts[2])
	if err != nil {
		return "", sourceMaterializationV3Error(sourceMaterializationFailureProofV3, "detached JWS signature is invalid")
	}
	payload := base64.RawURLEncoding.EncodeToString([]byte(packet.PacketProof.SignedPayload))
	signingInput := []byte(parts[0] + "." + payload)
	digest := sha256.Sum256(signingInput)
	if err := rsa.VerifyPKCS1v15(publicKey, crypto.SHA256, digest[:], signature); err != nil {
		return "", sourceMaterializationV3Error(sourceMaterializationFailureProofV3, "detached JWS signature does not verify")
	}
	fingerprint, err := sourceMaterializationKeyFingerprintV3(selected.Modulus, selected.Exponent)
	if err != nil {
		return "", sourceMaterializationV3Error(sourceMaterializationFailureProofV3, "signing key fingerprint failed: %v", err)
	}
	return fingerprint, nil
}

func sourceMaterializationRSAPublicKeyV3(key sourceMaterializationJWKKeyV3) (*rsa.PublicKey, error) {
	modulusBytes, err := decodeSourceMaterializationBase64URLV3(key.Modulus)
	if err != nil || len(modulusBytes) == 0 {
		return nil, sourceMaterializationV3Error(sourceMaterializationFailureProofV3, "materialization RSA modulus is invalid")
	}
	exponentBytes, err := decodeSourceMaterializationBase64URLV3(key.Exponent)
	if err != nil || len(exponentBytes) == 0 || len(exponentBytes) > 8 {
		return nil, sourceMaterializationV3Error(sourceMaterializationFailureProofV3, "materialization RSA exponent is invalid")
	}
	exponentBig := new(big.Int).SetBytes(exponentBytes)
	if !exponentBig.IsInt64() || exponentBig.Int64() > int64(math.MaxInt) || exponentBig.Int64() < 3 || exponentBig.Int64()%2 == 0 {
		return nil, sourceMaterializationV3Error(sourceMaterializationFailureProofV3, "materialization RSA exponent is not admitted")
	}
	publicKey := &rsa.PublicKey{N: new(big.Int).SetBytes(modulusBytes), E: int(exponentBig.Int64())}
	if publicKey.N.Sign() <= 0 || publicKey.N.BitLen() < 2048 {
		return nil, sourceMaterializationV3Error(sourceMaterializationFailureProofV3, "materialization RSA key is weaker than 2048 bits")
	}
	return publicKey, nil
}

func decodeSourceMaterializationBase64URLV3(value string) ([]byte, error) {
	if value == "" || strings.Contains(value, "=") {
		return nil, fmt.Errorf("empty or padded base64url")
	}
	decoded, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil || base64.RawURLEncoding.EncodeToString(decoded) != value {
		return nil, fmt.Errorf("non-canonical base64url")
	}
	return decoded, nil
}

func verifySourceMaterializationTransportV3(packet *sourceMaterializationPacketV3Value) (map[string][]byte, []string, error) {
	if packet == nil {
		return nil, nil, sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "Packet v3 transport is unavailable")
	}
	expectedComponents, expectedOrder, err := sourceMaterializationSemanticComponentMapV3(*packet)
	if err != nil {
		return nil, nil, err
	}
	carriedCount := 0
	for _, segment := range packet.OrderedSegments {
		carriedCount += len(segment.OrderedComponents)
	}
	if len(expectedComponents) != carriedCount || len(expectedOrder) != carriedCount {
		return nil, nil, sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "semantic and transport component counts differ")
	}
	result := make(map[string][]byte, carriedCount)
	orderedIDs := make([]string, 0, carriedCount)
	globalComponentOrdinal := uint64(0)
	globalChunkOrdinal := uint64(0)
	for segmentIndex := range packet.OrderedSegments {
		segment := &packet.OrderedSegments[segmentIndex]
		for componentIndex := range segment.OrderedComponents {
			component := &segment.OrderedComponents[componentIndex]
			if int(globalComponentOrdinal) >= len(expectedOrder) || component.ComponentID != expectedOrder[globalComponentOrdinal] {
				return nil, nil, sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "transport component order is not canonical")
			}
			expectedValue, exists := expectedComponents[component.ComponentID]
			if !exists {
				return nil, nil, sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "unexpected transport component %s", component.ComponentID)
			}
			descriptors := make([]sourceMaterializationChunkDescriptorV3, 0, len(component.CanonicalBytes))
			for _, descriptor := range segment.SegmentManifest.Chunks {
				if descriptor.GlobalComponentOrdinal == globalComponentOrdinal {
					descriptors = append(descriptors, descriptor)
				}
			}
			if len(descriptors) != len(component.CanonicalBytes) {
				return nil, nil, sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "component chunk descriptor count differs")
			}
			var assembled bytes.Buffer
			componentOffset := uint64(0)
			for index, encoded := range component.CanonicalBytes {
				chunk, err := decodeSourceMaterializationBase64URLV3(encoded)
				if err != nil || len(chunk) == 0 || uint64(len(chunk)) > packet.PublishedLimits.MaxChunkBytes {
					return nil, nil, sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "component chunk is invalid or exceeds its limit")
				}
				descriptor := descriptors[index]
				if descriptor.GlobalChunkOrdinal != globalChunkOrdinal || descriptor.GlobalComponentOrdinal != globalComponentOrdinal ||
					descriptor.ComponentOffset != componentOffset || descriptor.Length != uint64(len(chunk)) || descriptor.ChunkSHA256 != sha256HexBytes(chunk) {
					return nil, nil, sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "component chunk descriptor is stale")
				}
				_, _ = assembled.Write(chunk)
				componentOffset += uint64(len(chunk))
				globalChunkOrdinal++
			}
			canonicalBytes := assembled.Bytes()
			if uint64(len(canonicalBytes)) != component.CanonicalByteLength || sha256HexBytes(canonicalBytes) != component.CanonicalBytesHash {
				return nil, nil, sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "component canonical bytes hash is stale")
			}
			decoded, err := decodeSourceMaterializationJSON(canonicalBytes)
			if err != nil {
				return nil, nil, sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "component bytes are not closed JSON: %v", err)
			}
			reencoded, err := canonicalizeSourceMaterializationJCS(decoded)
			if err != nil || !bytes.Equal(reencoded, canonicalBytes) {
				return nil, nil, sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "component bytes are not canonical JSON")
			}
			expectedBytes, err := canonicalizeSourceMaterializationJCS(expectedValue)
			if err != nil || !bytes.Equal(expectedBytes, canonicalBytes) {
				return nil, nil, sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "component bytes do not match packet semantics")
			}
			contentHash, err := sourceMaterializationComponentContentHashV3(component.Kind, decoded)
			if err != nil || contentHash != component.ContentHash {
				return nil, nil, sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "component content hash is stale")
			}
			result[component.ComponentID] = canonicalBytes
			orderedIDs = append(orderedIDs, component.ComponentID)
			globalComponentOrdinal++
		}
	}
	if globalComponentOrdinal != packet.ClosureSetManifest.ComponentCount || globalChunkOrdinal != packet.ClosureSetManifest.ChunkCount {
		return nil, nil, sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "transport closure coverage is incomplete")
	}
	return result, orderedIDs, nil
}

func releaseSourceMaterializationPacketTransportV3(packet *sourceMaterializationPacketV3Value) {
	if packet == nil {
		return
	}
	packet.SemanticPayload.CanonicalSourceRaw = nil
	for segmentIndex := range packet.OrderedSegments {
		for componentIndex := range packet.OrderedSegments[segmentIndex].OrderedComponents {
			packet.OrderedSegments[segmentIndex].OrderedComponents[componentIndex].CanonicalBytes = nil
		}
	}
}

func sourceMaterializationSemanticComponentMapV3(packet sourceMaterializationPacketV3Value) (map[string]any, []string, error) {
	values := make(map[string]any)
	order := make([]string, 0)
	put := func(id string, value any) error {
		if existing, exists := values[id]; exists && !sourceMaterializationV3CanonicalEqual(existing, value) {
			return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "semantic component identity conflict for %s", id)
		}
		if _, exists := values[id]; !exists {
			values[id] = value
			order = append(order, id)
		}
		return nil
	}
	payload := packet.SemanticPayload
	canonicalSource, err := sourceMaterializationCanonicalSourceSemanticV3(payload)
	if err != nil {
		return nil, nil, err
	}
	if err := put(packet.SourceRef.Kind+":"+packet.SourceRef.ID, canonicalSource); err != nil {
		return nil, nil, err
	}
	if err := put("worldCore:"+payload.MaterializationContext.OwningWorld.ID, payload.MaterializationContext.OwningWorld); err != nil {
		return nil, nil, err
	}
	closure := payload.MaterializationContext.DependencyClosure
	putEntity := func(value sourceMaterializationEntityRecordV3) error {
		return put("worldEntity:"+value.WorldID+":"+value.ID, value)
	}
	putRelationship := func(value sourceMaterializationRelationshipRecordV3) error {
		return put("worldRelationship:"+value.WorldID+":"+value.ID, value)
	}
	if closure.Kind == "worldCharacter" {
		if closure.BoundEntity == nil {
			return nil, nil, sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "world closure bound entity is absent")
		}
		if err := putEntity(*closure.BoundEntity); err != nil {
			return nil, nil, err
		}
		for _, value := range closure.IncidentRelationships {
			if err := putRelationship(value); err != nil {
				return nil, nil, err
			}
		}
		entities := append(append([]sourceMaterializationEntityRecordV3(nil), closure.EndpointEntities...), closure.ExplicitEntities...)
		sortSourceMaterializationEntitiesV3(entities)
		for _, value := range entities {
			if err := putEntity(value); err != nil {
				return nil, nil, err
			}
		}
	} else {
		for _, value := range closure.ExplicitEntities {
			if err := putEntity(value); err != nil {
				return nil, nil, err
			}
		}
		for _, value := range closure.ExplicitRelationships {
			if err := putRelationship(value); err != nil {
				return nil, nil, err
			}
		}
	}
	if err := put("materializationCoverage", payload.MaterializationCoverage); err != nil {
		return nil, nil, err
	}
	return values, order, nil
}

func sourceMaterializationCanonicalSourceSemanticV3(payload sourceMaterializationPayloadV3Value) (any, error) {
	if len(payload.CanonicalSourceRaw) > 0 {
		return payload.CanonicalSourceRaw, nil
	}
	source := payload.CanonicalSource
	if source.ID == "" || !source.Profile.Present {
		return nil, sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "canonical source is unavailable")
	}
	value := map[string]any{
		"id": source.ID, "schemaVersion": source.SchemaVersion, "contentRevision": source.ContentRevision,
		"contentHash": source.ContentHash, "createdAt": source.CreatedAt, "updatedAt": source.UpdatedAt,
		"origin": source.Origin, "visibility": source.Visibility, "worldId": source.WorldID,
		"lorebookDeclaration": source.LorebookDeclaration,
		"profile":             source.Profile, "validity": source.Validity,
		"materializationReadiness": source.MaterializationReadiness, "sourceHash": source.SourceHash,
	}
	switch source.Kind {
	case "worldCharacter":
		value["creatorId"] = source.CreatorID
		value["worldEntityRef"] = source.WorldEntityRef
	case "personaCharacter":
		value["ownerAccountId"] = source.OwnerAccountID
	default:
		return nil, sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "canonical source kind is invalid")
	}
	return value, nil
}
