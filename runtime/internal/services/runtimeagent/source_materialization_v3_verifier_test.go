package runtimeagent

import (
	"bytes"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type sourceMaterializationReferenceVectorV3 struct {
	SchemaVersion string          `json:"schemaVersion"`
	Packet        json.RawMessage `json:"packet"`
	CurrentJWKS   json.RawMessage `json:"currentJwks"`
	Expectation   struct {
		Issuer                    string                                 `json:"issuer"`
		IntendedRuntimeAudience   string                                 `json:"intendedRuntimeAudience"`
		ChallengeID               string                                 `json:"challengeId"`
		ChallengeDigest           string                                 `json:"challengeDigest"`
		ChallengeExpiresAt        string                                 `json:"challengeExpiresAt"`
		MaterializerAccountID     string                                 `json:"materializerAccountId"`
		AccessPolicyVersionDigest string                                 `json:"accessPolicyVersionDigest"`
		PublishedLimits           sourceMaterializationPublishedLimitsV3 `json:"publishedLimits"`
		Now                       string                                 `json:"now"`
	} `json:"expectation"`
	Expected struct {
		PacketHash              string   `json:"packetHash"`
		ClosureSetManifestHash  string   `json:"closureSetManifestHash"`
		OrderedComponentSetHash string   `json:"orderedComponentSetHash"`
		SegmentCount            uint64   `json:"segmentCount"`
		ComponentCount          uint64   `json:"componentCount"`
		ChunkCount              uint64   `json:"chunkCount"`
		ComponentIDs            []string `json:"componentIds"`
	} `json:"expected"`
}

func TestVerifySourceMaterializationPacketV3ReferenceVectors(t *testing.T) {
	t.Parallel()
	for _, name := range []string{"world-character", "persona-character"} {
		name := name
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			vector := loadSourceMaterializationReferenceVectorV3(t, name)
			expected := sourceMaterializationExpectationFromVectorV3(t, vector)
			verified, err := verifySourceMaterializationPacketV3(bytes.NewReader(vector.Packet), bytes.NewReader(vector.CurrentJWKS), expected)
			if err != nil {
				t.Fatalf("verify reference vector: %v (code=%s)", err, sourceMaterializationV3FailureCode(err))
			}
			if verified.Packet.PacketHash != vector.Expected.PacketHash || verified.Packet.ClosureSetManifestHash != vector.Expected.ClosureSetManifestHash ||
				verified.Packet.ClosureSetManifest.OrderedComponentSetHash != vector.Expected.OrderedComponentSetHash {
				t.Fatalf("reference hashes differ: packet=%s closure=%s set=%s", verified.Packet.PacketHash, verified.Packet.ClosureSetManifestHash, verified.Packet.ClosureSetManifest.OrderedComponentSetHash)
			}
			if verified.Packet.ClosureSetManifest.SegmentCount != vector.Expected.SegmentCount ||
				verified.Packet.ClosureSetManifest.ComponentCount != vector.Expected.ComponentCount ||
				verified.Packet.ClosureSetManifest.ChunkCount != vector.Expected.ChunkCount {
				t.Fatalf("reference totals differ: %+v", verified.Packet.ClosureSetManifest)
			}
			if !sourceMaterializationV3CanonicalEqual(verified.OrderedComponentIDs, vector.Expected.ComponentIDs) {
				t.Fatalf("component order differs: got=%v want=%v", verified.OrderedComponentIDs, vector.Expected.ComponentIDs)
			}
			if len(verified.CanonicalComponentBytes) != len(vector.Expected.ComponentIDs) || !isLowerSHA256V3(verified.SigningKeyFingerprint) ||
				!isLowerSHA256V3(verified.ReplayBindingHash) || !isLowerSHA256V3(verified.NonceReplayDigest) {
				t.Fatalf("verified result is incomplete")
			}
			if len(verified.Packet.SemanticPayload.CanonicalSourceRaw) != 0 {
				t.Fatal("verified Packet retained raw canonical-source transport")
			}
			for _, segment := range verified.Packet.OrderedSegments {
				for _, component := range segment.OrderedComponents {
					if len(component.CanonicalBytes) != 0 {
						t.Fatalf("verified Packet retained raw component chunks for %s", component.ComponentID)
					}
				}
			}
		})
	}
}

func TestVerifySourceMaterializationPacketV3NegativeManifest(t *testing.T) {
	vector := loadSourceMaterializationReferenceVectorV3(t, "world-character")
	manifestBytes, err := os.ReadFile(sourceMaterializationReferenceVectorPathV3("negative-mutations"))
	if err != nil {
		t.Fatal(err)
	}
	var manifest struct {
		Mutations []struct {
			MutationID        string `json:"mutationId"`
			ExpectedErrorCode string `json:"expectedErrorCode"`
		} `json:"mutations"`
	}
	if err := json.Unmarshal(manifestBytes, &manifest); err != nil {
		t.Fatal(err)
	}
	for _, mutation := range manifest.Mutations {
		mutation := mutation
		t.Run(mutation.MutationID, func(t *testing.T) {
			packet := append(json.RawMessage(nil), vector.Packet...)
			jwks := append(json.RawMessage(nil), vector.CurrentJWKS...)
			expected := sourceMaterializationExpectationFromVectorV3(t, vector)
			switch mutation.MutationID {
			case "missing_segment":
				packet = mutateSourceMaterializationJSONV3(t, packet, func(root map[string]any) { root["orderedSegments"] = root["orderedSegments"].([]any)[:2] })
			case "reordered_segments":
				packet = mutateSourceMaterializationJSONV3(t, packet, func(root map[string]any) {
					segments := root["orderedSegments"].([]any)
					for left, right := 0, len(segments)-1; left < right; left, right = left+1, right-1 {
						segments[left], segments[right] = segments[right], segments[left]
					}
				})
			case "tampered_segment_reference":
				packet = mutateSourceMaterializationJSONV3(t, packet, func(root map[string]any) {
					root["closureSetManifest"].(map[string]any)["segments"].([]any)[0].(map[string]any)["segmentManifestHash"] = strings.Repeat("f", 64)
				})
			case "tampered_chunk_bytes":
				packet = mutateSourceMaterializationJSONV3(t, packet, func(root map[string]any) {
					root["orderedSegments"].([]any)[0].(map[string]any)["orderedComponents"].([]any)[0].(map[string]any)["canonicalBytes"].([]any)[0] = "e30"
				})
			case "wrong_audience":
				expected.Challenge.IntendedRuntimeAudience = "runtime-instance:wrong"
			case "wrong_challenge_digest":
				expected.Challenge.ChallengeDigest = strings.Repeat("d", 64)
			case "expired_packet":
				expected.Now = mustSourceMaterializationTimeV3(t, "2030-01-01T00:06:00.000Z")
			case "unknown_current_key":
				jwks = mutateSourceMaterializationJSONV3(t, jwks, func(root map[string]any) { root["keys"].([]any)[0].(map[string]any)["kid"] = "unknown-key" })
			case "invalid_signature":
				packet = mutateSourceMaterializationJSONV3(t, packet, func(root map[string]any) {
					proof := root["packetProof"].(map[string]any)
					parts := strings.Split(proof["compactJws"].(string), ".")
					if strings.HasPrefix(parts[2], "A") {
						parts[2] = "B" + parts[2][1:]
					} else {
						parts[2] = "A" + parts[2][1:]
					}
					proof["compactJws"] = strings.Join(parts, ".")
				})
			case "replayed_binding":
				first, firstErr := verifySourceMaterializationPacketV3(bytes.NewReader(packet), bytes.NewReader(jwks), expected)
				second, secondErr := verifySourceMaterializationPacketV3(bytes.NewReader(packet), bytes.NewReader(jwks), expected)
				if firstErr != nil || secondErr != nil || !isLowerSHA256V3(first.ReplayBindingHash) || first.ReplayBindingHash != second.ReplayBindingHash {
					t.Fatalf("pure verifier replay binding is not deterministic: first=%+v/%v second=%+v/%v", first, firstErr, second, secondErr)
				}
				// replay_binding_rejected is owned by the atomic product transaction.
				return
			case "stale_source_hash":
				packet = mutateSourceMaterializationJSONV3(t, packet, func(root map[string]any) { root["sourceRef"].(map[string]any)["sourceHash"] = strings.Repeat("e", 64) })
			case "missing_owning_world":
				packet = mutateSourceMaterializationJSONV3(t, packet, func(root map[string]any) {
					delete(root["semanticPayload"].(map[string]any)["materializationContext"].(map[string]any), "owningWorld")
				})
			default:
				t.Fatalf("unimplemented mutation %s", mutation.MutationID)
			}
			_, err := verifySourceMaterializationPacketV3(bytes.NewReader(packet), bytes.NewReader(jwks), expected)
			if err == nil {
				t.Fatal("mutation unexpectedly verified")
			}
			if actual := string(sourceMaterializationV3FailureCode(err)); actual != mutation.ExpectedErrorCode {
				t.Fatalf("failure code=%s want=%s: %v", actual, mutation.ExpectedErrorCode, err)
			}
		})
	}
}

func TestSourceMaterializationV3RejectsClosedSchemaAndNormalizedKeyViolations(t *testing.T) {
	vector := loadSourceMaterializationReferenceVectorV3(t, "persona-character")
	expected := sourceMaterializationExpectationFromVectorV3(t, vector)
	for name, packet := range map[string]json.RawMessage{
		"unknown": mutateSourceMaterializationJSONV3(t, vector.Packet, func(root map[string]any) { root["unsupportedSourceEnvelope"] = map[string]any{} }),
		"missing": mutateSourceMaterializationJSONV3(t, vector.Packet, func(root map[string]any) { delete(root, "packetId") }),
		"union": mutateSourceMaterializationJSONV3(t, vector.Packet, func(root map[string]any) {
			root["sourceRef"].(map[string]any)["worldEntityRef"] = map[string]any{"kind": "worldEntity", "worldId": "x", "entityId": "x"}
		}),
	} {
		t.Run(name, func(t *testing.T) {
			_, err := verifySourceMaterializationPacketV3(bytes.NewReader(packet), bytes.NewReader(vector.CurrentJWKS), expected)
			if err == nil || sourceMaterializationV3FailureCode(err) != sourceMaterializationFailurePacketContractV3 {
				t.Fatalf("got %v", err)
			}
		})
	}
	value, err := decodeSourceMaterializationJSON([]byte(`{"e\u0301":1,"é":2}`))
	if err != nil {
		t.Fatal(err)
	}
	if err := validateSourceMaterializationNormalizedKeysV3(value, "$"); err == nil {
		t.Fatal("normalized-key collision admitted")
	}
	if _, err := decodeSourceMaterializationJSON([]byte(`{"a":1,"a":2}`)); err == nil {
		t.Fatal("duplicate key admitted")
	}
}

func TestReadSourceMaterializationBoundedBodyV3ReadsMaxPlusOne(t *testing.T) {
	if value, err := readSourceMaterializationBoundedBodyV3(strings.NewReader("1234"), 4); err != nil || string(value) != "1234" {
		t.Fatalf("exact limit: %q %v", value, err)
	}
	if _, err := readSourceMaterializationBoundedBodyV3(strings.NewReader("12345"), 4); err == nil || sourceMaterializationV3FailureCode(err) != sourceMaterializationFailureCapacityV3 {
		t.Fatalf("over limit: %v", err)
	}
	if _, err := readSourceMaterializationBoundedBodyV3(io.LimitReader(strings.NewReader("x"), 1), 0); err == nil {
		t.Fatal("zero limit admitted")
	}
}

func TestVerifySourceMaterializationPacketV3ExpectationBindings(t *testing.T) {
	vector := loadSourceMaterializationReferenceVectorV3(t, "world-character")
	cases := map[string]func(*sourceMaterializationVerificationExpectationV3){
		"source": func(value *sourceMaterializationVerificationExpectationV3) {
			value.Challenge.SourceRef.SourceHash = strings.Repeat("1", 64)
		},
		"account": func(value *sourceMaterializationVerificationExpectationV3) {
			value.Challenge.MaterializerAccountID = "other-account"
		},
		"policy": func(value *sourceMaterializationVerificationExpectationV3) {
			value.ExpectedAccessPolicyDigest = strings.Repeat("2", 64)
		},
		"issuer": func(value *sourceMaterializationVerificationExpectationV3) {
			value.ExpectedIssuer = "https://other.realm.invalid"
		},
		"challenge_id": func(value *sourceMaterializationVerificationExpectationV3) {
			value.Challenge.ChallengeID = "other-challenge"
		},
		"ttl": func(value *sourceMaterializationVerificationExpectationV3) {
			value.Challenge.ExpiresAt = mustSourceMaterializationTimeV3(t, "2030-01-01T00:04:00.000Z")
		},
		"packet_ttl_exceeds_challenge_ttl": func(value *sourceMaterializationVerificationExpectationV3) {
			value.Challenge.IssuedAt = mustSourceMaterializationTimeV3(t, "2030-01-01T00:02:00.000Z")
			value.Challenge.ExpiresAt = mustSourceMaterializationTimeV3(t, "2030-01-01T00:06:00.000Z")
		},
		"limits": func(value *sourceMaterializationVerificationExpectationV3) { value.Challenge.Limits.MaxSetChunks-- },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			expected := sourceMaterializationExpectationFromVectorV3(t, vector)
			mutate(&expected)
			_, err := verifySourceMaterializationPacketV3(bytes.NewReader(vector.Packet), bytes.NewReader(vector.CurrentJWKS), expected)
			if err == nil {
				t.Fatal("binding mismatch verified")
			}
		})
	}
	packet := mutateSourceMaterializationJSONV3(t, vector.Packet, func(root map[string]any) { root["nonce"] = "tampered-nonce" })
	expected := sourceMaterializationExpectationFromVectorV3(t, vector)
	if _, err := verifySourceMaterializationPacketV3(bytes.NewReader(packet), bytes.NewReader(vector.CurrentJWKS), expected); err == nil {
		t.Fatal("tampered nonce verified")
	}
}

func TestVerifySourceMaterializationPacketV3CurrentJWKSIsClosedAndStrong(t *testing.T) {
	vector := loadSourceMaterializationReferenceVectorV3(t, "persona-character")
	expected := sourceMaterializationExpectationFromVectorV3(t, vector)
	cases := map[string]json.RawMessage{
		"unknown_field": mutateSourceMaterializationJSONV3(t, vector.CurrentJWKS, func(root map[string]any) { root["issuer"] = "legacy" }),
		"wrong_key_use": mutateSourceMaterializationJSONV3(t, vector.CurrentJWKS, func(root map[string]any) { root["keys"].([]any)[0].(map[string]any)["use"] = "enc" }),
		"weak_rsa":      mutateSourceMaterializationJSONV3(t, vector.CurrentJWKS, func(root map[string]any) { root["keys"].([]any)[0].(map[string]any)["n"] = "AQ" }),
	}
	for name, jwks := range cases {
		t.Run(name, func(t *testing.T) {
			candidate := expected
			_, err := verifySourceMaterializationPacketV3(bytes.NewReader(vector.Packet), bytes.NewReader(jwks), candidate)
			if err == nil {
				t.Fatal("invalid current JWKS verified")
			}
		})
	}
}

func TestSourceMaterializationRealmHashV3NormalizesLFAndNFC(t *testing.T) {
	left, err := hashSourceMaterializationRealmDomainV3("test.realm/v1\x00", map[string]any{"line": "e\u0301\r\nnext"})
	if err != nil {
		t.Fatal(err)
	}
	right, err := hashSourceMaterializationRealmDomainV3("test.realm/v1\x00", map[string]any{"line": "é\nnext"})
	if err != nil {
		t.Fatal(err)
	}
	if left != right {
		t.Fatalf("Realm normalization differs: %s != %s", left, right)
	}
	if _, err := hashSourceMaterializationRealmDomainV3("test.realm/v1\x00", map[string]any{"e\u0301": 1, "é": 2}); err == nil {
		t.Fatal("normalized object-key collision was hashed")
	}
}

func loadSourceMaterializationReferenceVectorV3(t *testing.T, name string) sourceMaterializationReferenceVectorV3 {
	t.Helper()
	raw, err := os.ReadFile(sourceMaterializationReferenceVectorPathV3(name))
	if err != nil {
		t.Fatal(err)
	}
	var vector sourceMaterializationReferenceVectorV3
	if err := json.Unmarshal(raw, &vector); err != nil {
		t.Fatal(err)
	}
	return vector
}

func sourceMaterializationReferenceVectorPathV3(name string) string {
	return filepath.Join("testdata", "source-materialization-v3", name+".json")
}

func sourceMaterializationReferenceSourceRefV3(name string) sourceMaterializationCharacterSourceRefV3 {
	raw, err := os.ReadFile(sourceMaterializationReferenceVectorPathV3(name))
	if err != nil {
		panic(err)
	}
	var vector sourceMaterializationReferenceVectorV3
	if err := json.Unmarshal(raw, &vector); err != nil {
		panic(err)
	}
	var packet struct {
		SourceRef sourceMaterializationCharacterSourceRefV3 `json:"sourceRef"`
	}
	if err := json.Unmarshal(vector.Packet, &packet); err != nil {
		panic(err)
	}
	return packet.SourceRef
}

func sourceMaterializationExpectationFromVectorV3(t *testing.T, vector sourceMaterializationReferenceVectorV3) sourceMaterializationVerificationExpectationV3 {
	t.Helper()
	var packet struct {
		IssuedAt  string                                    `json:"issuedAt"`
		SourceRef sourceMaterializationCharacterSourceRefV3 `json:"sourceRef"`
	}
	if err := json.Unmarshal(vector.Packet, &packet); err != nil {
		t.Fatal(err)
	}
	return sourceMaterializationVerificationExpectationV3{
		Challenge: sourceMaterializationChallengeV3{
			ChallengeID: vector.Expectation.ChallengeID, ChallengeDigest: vector.Expectation.ChallengeDigest,
			IntendedRuntimeAudience: vector.Expectation.IntendedRuntimeAudience, MaterializerAccountID: vector.Expectation.MaterializerAccountID,
			SourceRef: packet.SourceRef, Limits: vector.Expectation.PublishedLimits,
			IssuedAt: mustSourceMaterializationTimeV3(t, packet.IssuedAt), ExpiresAt: mustSourceMaterializationTimeV3(t, vector.Expectation.ChallengeExpiresAt),
		},
		ExpectedIssuer: vector.Expectation.Issuer, ExpectedAccessPolicyDigest: vector.Expectation.AccessPolicyVersionDigest,
		Now: mustSourceMaterializationTimeV3(t, vector.Expectation.Now),
	}
}

func mutateSourceMaterializationJSONV3(t *testing.T, raw json.RawMessage, mutate func(map[string]any)) json.RawMessage {
	t.Helper()
	value, err := decodeSourceMaterializationJSON(raw)
	if err != nil {
		t.Fatal(err)
	}
	root, ok := value.(map[string]any)
	if !ok {
		t.Fatal("fixture root is not an object")
	}
	mutate(root)
	encoded, err := json.Marshal(root)
	if err != nil {
		t.Fatal(err)
	}
	return encoded
}

func mustSourceMaterializationTimeV3(t *testing.T, value string) time.Time {
	t.Helper()
	parsed, err := time.Parse("2006-01-02T15:04:05.000Z", value)
	if err != nil {
		t.Fatal(err)
	}
	return parsed
}
