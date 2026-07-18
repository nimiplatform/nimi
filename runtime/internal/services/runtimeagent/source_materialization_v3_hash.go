package runtimeagent

import (
	"bytes"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"golang.org/x/text/unicode/norm"
)

const (
	sourceMaterializationReplayHashDomainV3      = "nimi.realm.source-materialization-replay/v3\x00"
	sourceMaterializationNonceReplayHashDomainV3 = "nimi.runtime.realm-source-nonce-replay/v3\x00"
	sourceMaterializationKeyHashDomainV3         = "nimi.realm.source-materialization-key/v1\x00"
)

// Realm domain hashes are not plain JCS hashes. Realm first normalizes every
// string and object key to LF + NFC, rejects normalized-key collisions, and
// only then applies canonical JSON. Transport component bytes deliberately do
// not use this normalization and continue to use plain JCS.
func normalizeSourceMaterializationRealmValueV3(value any, path string) (any, error) {
	switch typed := value.(type) {
	case nil, bool, json.Number:
		return typed, nil
	case string:
		return normalizeSourceMaterializationRealmStringV3(typed), nil
	case []any:
		result := make([]any, len(typed))
		for index, item := range typed {
			normalized, err := normalizeSourceMaterializationRealmValueV3(item, fmt.Sprintf("%s[%d]", path, index))
			if err != nil {
				return nil, err
			}
			result[index] = normalized
		}
		return result, nil
	case map[string]any:
		result := make(map[string]any, len(typed))
		for key, item := range typed {
			normalizedKey := normalizeSourceMaterializationRealmStringV3(key)
			if _, exists := result[normalizedKey]; exists {
				return nil, fmt.Errorf("%s contains duplicate normalized object key %q", path, normalizedKey)
			}
			normalized, err := normalizeSourceMaterializationRealmValueV3(item, path+"."+normalizedKey)
			if err != nil {
				return nil, err
			}
			result[normalizedKey] = normalized
		}
		return result, nil
	default:
		encoded, err := json.Marshal(value)
		if err != nil {
			return nil, err
		}
		decoded, err := decodeSourceMaterializationJSON(encoded)
		if err != nil {
			return nil, err
		}
		return normalizeSourceMaterializationRealmValueV3(decoded, path)
	}
}

func normalizeSourceMaterializationRealmStringV3(value string) string {
	value = strings.ReplaceAll(value, "\r\n", "\n")
	value = strings.ReplaceAll(value, "\r", "\n")
	return norm.NFC.String(value)
}

func canonicalizeSourceMaterializationRealmV3(value any) ([]byte, error) {
	normalized, err := normalizeSourceMaterializationRealmValueV3(value, "$")
	if err != nil {
		return nil, err
	}
	return canonicalizeSourceMaterializationJCS(normalized)
}

func hashSourceMaterializationRealmDomainV3(domain string, value any) (string, error) {
	if !strings.HasSuffix(domain, "\x00") {
		return "", fmt.Errorf("Realm hash domain must end with NUL")
	}
	canonical, err := canonicalizeSourceMaterializationRealmV3(value)
	if err != nil {
		return "", err
	}
	return sha256HexBytes(append([]byte(domain), canonical...)), nil
}

func sourceMaterializationRealmEqualV3(left, right any) bool {
	leftBytes, leftErr := canonicalizeSourceMaterializationRealmV3(left)
	rightBytes, rightErr := canonicalizeSourceMaterializationRealmV3(right)
	return leftErr == nil && rightErr == nil && bytes.Equal(leftBytes, rightBytes)
}

func sourceMaterializationContextHashV3(context sourceMaterializationContextV3Value) (string, error) {
	closure, err := sourceMaterializationV3Any(context.DependencyClosure)
	if err != nil {
		return "", err
	}
	dependencyHashes, err := sourceMaterializationDependencyContentHashesV3(closure)
	if err != nil {
		return "", err
	}
	return hashSourceMaterializationRealmDomainV3(sourceMaterializationContextHashDomainV3, map[string]any{
		"contextSchemaVersion":            context.ContextSchemaVersion,
		"sourceRef":                       context.SourceRef,
		"owningWorldContentHash":          context.OwningWorld.ContentHash,
		"dependencyClosureContentHashes":  dependencyHashes,
		"sourceComponentDigests":          context.SourceComponentDigests,
		"worldAndClosureComponentDigests": context.WorldAndClosureComponentDigests,
		"closurePolicyVersion":            context.ClosurePolicyVersion,
		"materializationCoverageHash":     context.MaterializationCoverageHash,
	})
}

func sourceMaterializationCoverageHashV3(coverage sourceMaterializationCoverageManifestV3Value) (string, error) {
	value, err := sourceMaterializationV3Any(coverage)
	if err != nil {
		return "", err
	}
	record, ok := value.(map[string]any)
	if !ok {
		return "", fmt.Errorf("coverage is not an object")
	}
	delete(record, "materializationCoverageHash")
	return hashSourceMaterializationRealmDomainV3(sourceMaterializationCoverageHashDomainV3, record)
}

func sourceMaterializationPayloadHashV3(payload sourceMaterializationPayloadV3Value) (string, error) {
	if len(payload.CanonicalSourceRaw) == 0 && payload.CanonicalSource.ID != "" {
		source, err := sourceMaterializationCanonicalSourceSemanticV3(payload)
		if err != nil {
			return "", err
		}
		sourceBytes, err := canonicalizeSourceMaterializationJCS(source)
		if err != nil {
			return "", err
		}
		payload.CanonicalSourceRaw = sourceBytes
	}
	return hashSourceMaterializationRealmDomainV3(sourceMaterializationPayloadHashDomainV3, payload)
}

func sourceMaterializationSegmentManifestHashV3(manifest sourceMaterializationSegmentManifestV3Value) (string, error) {
	return hashSourceMaterializationRealmDomainV3(sourceMaterializationSegmentManifestHashDomainV3, manifest)
}

func sourceMaterializationClosureSetManifestHashV3(manifest sourceMaterializationClosureSetManifestV3Value) (string, error) {
	return hashSourceMaterializationRealmDomainV3(sourceMaterializationClosureSetHashDomainV3, manifest)
}

func sourceMaterializationOrderedComponentSetHashV3(components []sourceMaterializationManifestComponentV3) (string, error) {
	metadata := make([]any, 0, len(components))
	for _, component := range components {
		metadata = append(metadata, map[string]any{
			"componentId": component.ComponentID, "kind": component.Kind,
			"schemaVersion": component.SchemaVersion, "revision": component.Revision,
			"contentHash": component.ContentHash, "canonicalBytesHash": component.CanonicalBytesHash,
			"canonicalByteLength": component.CanonicalByteLength,
		})
	}
	return hashSourceMaterializationRealmDomainV3(sourceMaterializationComponentSetHashDomainV3, metadata)
}

func sourceMaterializationPacketHashV3(packet sourceMaterializationPacketV3Value) (string, error) {
	return hashSourceMaterializationRealmDomainV3(sourceMaterializationPacketHashDomainV3, map[string]any{
		"packetSchemaVersion": packet.PacketSchemaVersion, "packetId": packet.PacketID,
		"issuer": packet.Issuer, "keyId": packet.KeyID, "algorithm": packet.Algorithm,
		"keyUse": packet.KeyUse, "issuedAt": packet.IssuedAt, "expiresAt": packet.ExpiresAt,
		"nonce": packet.Nonce, "intendedRuntimeAudience": packet.IntendedRuntimeAudience,
		"challengeId": packet.ChallengeID, "challengeDigest": packet.ChallengeDigest,
		"publishedLimits": packet.PublishedLimits, "materializerAccountId": packet.MaterializerAccountID,
		"sourceRef": packet.SourceRef, "authorizationDecisionDigest": packet.AuthorizationDecisionDigest,
		"accessPolicyVersionDigest":  packet.AccessPolicyVersionDigest,
		"materializationContextHash": packet.MaterializationContextHash, "payloadHash": packet.PayloadHash,
		"closureSetManifestHash": packet.ClosureSetManifestHash,
	})
}

func sourceMaterializationReplayBindingV3(packet sourceMaterializationPacketV3Value) (string, error) {
	return hashSourceMaterializationRealmDomainV3(sourceMaterializationReplayHashDomainV3, map[string]any{
		"issuer": packet.Issuer, "packetId": packet.PacketID, "nonce": packet.Nonce,
		"challengeId": packet.ChallengeID, "challengeDigest": packet.ChallengeDigest,
		"intendedRuntimeAudience": packet.IntendedRuntimeAudience,
		"materializerAccountId":   packet.MaterializerAccountID, "packetHash": packet.PacketHash,
	})
}

func sourceMaterializationNonceReplayDigestV3(packet sourceMaterializationPacketV3Value) (string, error) {
	return hashSourceMaterializationRealmDomainV3(sourceMaterializationNonceReplayHashDomainV3, map[string]any{
		"nonce": packet.Nonce,
	})
}

func sourceMaterializationKeyFingerprintV3(modulus, exponent string) (string, error) {
	return hashSourceMaterializationRealmDomainV3(sourceMaterializationKeyHashDomainV3, map[string]any{
		"kty": "RSA", "n": modulus, "e": exponent,
	})
}

func sourceMaterializationSortedUniqueV3[T any](values []T, key func(T) string) bool {
	keys := make([]string, len(values))
	seen := make(map[string]struct{}, len(values))
	for index, value := range values {
		keys[index] = key(value)
		if _, exists := seen[keys[index]]; exists {
			return false
		}
		seen[keys[index]] = struct{}{}
	}
	sorted := make([]string, len(keys))
	copy(sorted, keys)
	sort.Slice(sorted, func(i, j int) bool { return bytes.Compare([]byte(sorted[i]), []byte(sorted[j])) < 0 })
	return sourceMaterializationRealmEqualV3(keys, sorted)
}
