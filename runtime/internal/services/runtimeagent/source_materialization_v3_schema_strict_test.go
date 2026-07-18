package runtimeagent

import (
	"bytes"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
)

func TestSourceMaterializationProfileSchemaV3RejectsNonCanonicalNestedValues(t *testing.T) {
	vector := loadSourceMaterializationReferenceVectorV3(t, "world-character")
	profile := sourceMaterializationStrictSchemaProfileV3(t, vector.Packet)
	if err := validateSourceMaterializationProfileShapeJSONV3(profile, "$.profile"); err != nil {
		t.Fatalf("official profile rejected: %v", err)
	}
	registered := sourceMaterializationStrictSchemaCloneV3(t, profile)
	registered["authoring"].(map[string]any)["extensions"] = map[string]any{
		"works.nimi.role-setting": map[string]any{
			"extensionSchemaVersion": "role-setting/v1", "namespace": "works.nimi.role-setting",
			"productSemantic": true, "fields": map[string]any{"guidelines": []any{"source-grounded"}, "priority": json.Number("1")},
		},
		"works.nimi.diagnostics": map[string]any{
			"extensionSchemaVersion": "diag/v1", "namespace": "works.nimi.diagnostics",
			"productSemantic": false, "fields": map[string]any{},
		},
	}
	if err := validateSourceMaterializationProfileShapeJSONV3(registered, "$.profile"); err != nil {
		t.Fatalf("registered extensions rejected: %v", err)
	}

	cases := map[string]func(map[string]any){
		"wrong nested type": func(candidate map[string]any) {
			candidate["identity"].(map[string]any)["name"] = json.Number("7")
		},
		"null optional value": func(candidate map[string]any) {
			candidate["presentation"].(map[string]any)["shortBio"] = nil
		},
		"normalized empty required string": func(candidate map[string]any) {
			candidate["narrative"].(map[string]any)["summary"] = " \r\n\t "
		},
		"unsorted set": func(candidate map[string]any) {
			candidate["identity"].(map[string]any)["aliases"] = []any{"Zulu", "Alpha"}
		},
		"duplicate normalized set value": func(candidate map[string]any) {
			candidate["identity"].(map[string]any)["aliases"] = []any{"e\u0301", "é"}
		},
		"duplicate semantic-order value": func(candidate map[string]any) {
			candidate["interactionProfile"].(map[string]any)["interactionModes"] = []any{"dialogue", "dialogue"}
		},
		"unsorted stable ids": func(candidate map[string]any) {
			candidate["capabilities"] = map[string]any{"tools": []any{
				map[string]any{"toolId": "tool-z"},
				map[string]any{"toolId": "tool-a"},
			}}
		},
		"duplicate stable ids": func(candidate map[string]any) {
			candidate["assets"].(map[string]any)["intents"] = []any{
				map[string]any{"intentId": "same", "kind": "voice"},
				map[string]any{"intentId": "same", "kind": "image"},
			}
		},
		"unknown authoring extension": func(candidate map[string]any) {
			candidate["authoring"].(map[string]any)["extensions"] = map[string]any{
				"invalid.example": map[string]any{
					"extensionSchemaVersion": "invalid.example/v1", "namespace": "invalid.example",
					"productSemantic": true, "fields": map[string]any{},
				},
			}
		},
		"registered extension namespace mismatch": func(candidate map[string]any) {
			candidate["authoring"].(map[string]any)["extensions"] = map[string]any{
				"works.nimi.role-setting": map[string]any{
					"extensionSchemaVersion": "role-setting/v1", "namespace": "works.nimi.diagnostics",
					"productSemantic": true, "fields": map[string]any{},
				},
			}
		},
		"registered extension schema mismatch": func(candidate map[string]any) {
			candidate["authoring"].(map[string]any)["extensions"] = map[string]any{
				"works.nimi.role-setting": map[string]any{
					"extensionSchemaVersion": "role-setting/v2", "namespace": "works.nimi.role-setting",
					"productSemantic": true, "fields": map[string]any{},
				},
			}
		},
		"registered extension policy mismatch": func(candidate map[string]any) {
			candidate["authoring"].(map[string]any)["extensions"] = map[string]any{
				"works.nimi.diagnostics": map[string]any{
					"extensionSchemaVersion": "diag/v1", "namespace": "works.nimi.diagnostics",
					"productSemantic": true, "fields": map[string]any{},
				},
			}
		},
		"null extension field": func(candidate map[string]any) {
			candidate["authoring"].(map[string]any)["extensions"] = map[string]any{
				"realm.character-context": map[string]any{
					"extensionSchemaVersion": "realm.character-context/v1", "namespace": "realm.character-context",
					"productSemantic": true, "fields": map[string]any{"context": nil},
				},
			}
		},
		"unknown coverage enum": func(candidate map[string]any) {
			candidate["profileCoverage"].(map[string]any)["aggregateStatus"] = "READY"
		},
	}

	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			candidate := sourceMaterializationStrictSchemaCloneV3(t, profile)
			mutate(candidate)
			err := validateSourceMaterializationProfileShapeJSONV3(candidate, "$.profile")
			if err == nil || sourceMaterializationV3FailureCode(err) != sourceMaterializationFailurePacketContractV3 {
				t.Fatalf("mutation admitted or misclassified: %v", err)
			}
		})
	}
}

func TestSourceMaterializationProfileSchemaV3RejectsRehashedResignedWrongType(t *testing.T) {
	vector := loadSourceMaterializationReferenceVectorV3(t, "world-character")
	value, err := decodeSourceMaterializationJSON(vector.Packet)
	if err != nil {
		t.Fatal(err)
	}
	packetObject := value.(map[string]any)
	profile := packetObject["semanticPayload"].(map[string]any)["canonicalSource"].(map[string]any)["profile"].(map[string]any)
	profile["authoring"].(map[string]any)["notes"] = []any{true}

	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	const keyID = "strict-profile-schema-test-key"
	packetObject["keyId"] = keyID
	payloadHash, err := hashSourceMaterializationRealmDomainV3(sourceMaterializationPayloadHashDomainV3, packetObject["semanticPayload"])
	if err != nil {
		t.Fatal(err)
	}
	packetObject["payloadHash"] = payloadHash
	packetObject["packetHash"] = strings.Repeat("0", 64)
	packetObject["packetProof"] = map[string]any{"compactJws": "placeholder..placeholder", "signedPayload": "placeholder"}

	unsigned, err := json.Marshal(packetObject)
	if err != nil {
		t.Fatal(err)
	}
	var typed sourceMaterializationPacketV3Value
	if err := strictDecodeSourceMaterializationV3(unsigned, &typed); err != nil {
		t.Fatal(err)
	}
	packetHash, err := sourceMaterializationPacketHashV3(typed)
	if err != nil {
		t.Fatal(err)
	}
	proof := sourceMaterializationStrictSchemaProofV3(t, privateKey, keyID, packetHash)
	packetObject["packetHash"] = packetHash
	packetObject["packetProof"] = proof
	packetBytes, err := json.Marshal(packetObject)
	if err != nil {
		t.Fatal(err)
	}
	if err := strictDecodeSourceMaterializationV3(packetBytes, &typed); err != nil {
		t.Fatal(err)
	}
	jwks := sourceMaterializationJWKSV3{Keys: []sourceMaterializationJWKKeyV3{sourceMaterializationStrictSchemaJWKSV3(privateKey, keyID)}}
	if _, err := verifySourceMaterializationDetachedProofV3(typed, jwks); err != nil {
		t.Fatalf("re-signed mutation does not carry a valid proof: %v", err)
	}
	jwksBytes, err := json.Marshal(jwks)
	if err != nil {
		t.Fatal(err)
	}
	_, err = verifySourceMaterializationPacketV3(
		bytes.NewReader(packetBytes),
		bytes.NewReader(jwksBytes),
		sourceMaterializationExpectationFromVectorV3(t, vector),
	)
	if err == nil || sourceMaterializationV3FailureCode(err) != sourceMaterializationFailurePacketContractV3 || !strings.Contains(err.Error(), "authoring.notes[0]") {
		t.Fatalf("rehashed and re-signed wrong type was not rejected by strict schema: %v", err)
	}
}

func sourceMaterializationStrictSchemaProfileV3(t *testing.T, packet json.RawMessage) map[string]any {
	t.Helper()
	value, err := decodeSourceMaterializationJSON(packet)
	if err != nil {
		t.Fatal(err)
	}
	return value.(map[string]any)["semanticPayload"].(map[string]any)["canonicalSource"].(map[string]any)["profile"].(map[string]any)
}

func sourceMaterializationStrictSchemaCloneV3(t *testing.T, profile map[string]any) map[string]any {
	t.Helper()
	raw, err := json.Marshal(profile)
	if err != nil {
		t.Fatal(err)
	}
	value, err := decodeSourceMaterializationJSON(raw)
	if err != nil {
		t.Fatal(err)
	}
	return value.(map[string]any)
}

func sourceMaterializationStrictSchemaProofV3(t *testing.T, privateKey *rsa.PrivateKey, keyID, packetHash string) sourceMaterializationPacketProofV3 {
	t.Helper()
	header, err := canonicalizeSourceMaterializationRealmV3(map[string]any{
		"alg": "RS256", "kid": keyID, "typ": "realm-source-materialization",
	})
	if err != nil {
		t.Fatal(err)
	}
	headerEncoded := base64.RawURLEncoding.EncodeToString(header)
	signedPayload := sourceMaterializationProofDomainV3 + packetHash
	payloadEncoded := base64.RawURLEncoding.EncodeToString([]byte(signedPayload))
	digest := sha256.Sum256([]byte(headerEncoded + "." + payloadEncoded))
	signature, err := rsa.SignPKCS1v15(rand.Reader, privateKey, crypto.SHA256, digest[:])
	if err != nil {
		t.Fatal(err)
	}
	return sourceMaterializationPacketProofV3{
		CompactJWS:    headerEncoded + ".." + base64.RawURLEncoding.EncodeToString(signature),
		SignedPayload: signedPayload,
	}
}

func sourceMaterializationStrictSchemaJWKSV3(privateKey *rsa.PrivateKey, keyID string) sourceMaterializationJWKKeyV3 {
	exponent := []byte{byte(privateKey.E >> 16), byte(privateKey.E >> 8), byte(privateKey.E)}
	for len(exponent) > 1 && exponent[0] == 0 {
		exponent = exponent[1:]
	}
	return sourceMaterializationJWKKeyV3{
		KeyType: "RSA", KeyID: keyID, Use: "sig", Algorithm: "RS256", Operations: []string{"verify"},
		Modulus: base64.RawURLEncoding.EncodeToString(privateKey.N.Bytes()), Exponent: base64.RawURLEncoding.EncodeToString(exponent),
		Purpose: "realm-source-materialization",
	}
}
