package runtimeagent

import (
	"bytes"
	"encoding/json"
	"net/url"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

// TestDesktopRealmSourceMaterializationFixtureV3 verifies the Desktop Realm
// fixture with the same strict streaming verifier used by Runtime. This keeps
// the product E2E harness from drifting into a syntactically renamed but
// cryptographically invalid Packet implementation.
func TestDesktopRealmSourceMaterializationFixtureV3(t *testing.T) {
	modulePath, err := filepath.Abs(filepath.Join(
		"..", "..", "..", "..", "apps", "desktop", "e2e", "fixtures", "source-materialization-packet-v3.mjs",
	))
	if err != nil {
		t.Fatal(err)
	}
	moduleURLPath := filepath.ToSlash(modulePath)
	if runtime.GOOS == "windows" {
		moduleURLPath = "/" + moduleURLPath
	}
	moduleURL := (&url.URL{Scheme: "file", Path: moduleURLPath}).String()
	for _, sourceKind := range []string{"worldCharacter", "personaCharacter"} {
		sourceKind := sourceKind
		t.Run(sourceKind, func(t *testing.T) {
			now := time.Now().UTC().Truncate(time.Millisecond)
			expiresAt := now.Add(4 * time.Minute)
			result := runDesktopRealmSourceMaterializationFixtureV3(t, moduleURL, sourceKind, expiresAt)
			var packetIdentity struct {
				IssuedAt  string                                    `json:"issuedAt"`
				SourceRef sourceMaterializationCharacterSourceRefV3 `json:"sourceRef"`
			}
			if err := json.Unmarshal(result.Packet, &packetIdentity); err != nil {
				t.Fatalf("decode Desktop Packet identity: %v", err)
			}
			issuedAt, err := time.Parse(time.RFC3339Nano, packetIdentity.IssuedAt)
			if err != nil {
				t.Fatal(err)
			}
			verified, err := verifySourceMaterializationPacketV3(
				bytes.NewReader(result.Packet),
				bytes.NewReader(result.JWKS),
				sourceMaterializationVerificationExpectationV3{
					Challenge: sourceMaterializationChallengeV3{
						ChallengeID:             "desktop-fixture-challenge-" + sourceKind,
						ChallengeDigest:         strings.Repeat("a", 64),
						IntendedRuntimeAudience: "runtime-instance:desktop-fixture:materializer-1",
						MaterializerAccountID:   "materializer-1",
						SourceRef:               packetIdentity.SourceRef,
						Limits:                  sourceMaterializationProducerCeilingsV3,
						IssuedAt:                issuedAt,
						ExpiresAt:               expiresAt,
					},
					ExpectedIssuer:             realmSourceMaterializationServiceTestIssuerURL,
					ExpectedAccessPolicyDigest: compactRealmMaterializationPolicyDigest,
					Now:                        issuedAt.Add(time.Millisecond),
				},
			)
			if err != nil {
				t.Fatalf("strictly verify Desktop %s Packet v3 fixture: %v", sourceKind, err)
			}
			if verified.Packet.PacketSchemaVersion != "realm.source-materialization-packet/v3" ||
				len(verified.OrderedComponentIDs) == 0 || len(verified.CanonicalComponentBytes) == 0 {
				t.Fatalf("Desktop %s Packet v3 verification is incomplete", sourceKind)
			}
		})
	}
}

type desktopRealmSourceMaterializationFixtureV3Result struct {
	Packet json.RawMessage `json:"packet"`
	JWKS   json.RawMessage `json:"jwks"`
}

func runDesktopRealmSourceMaterializationFixtureV3(
	t *testing.T,
	moduleURL string,
	sourceKind string,
	expiresAt time.Time,
) desktopRealmSourceMaterializationFixtureV3Result {
	t.Helper()
	script := `
const fixture = await import(process.argv[1]);
fixture.configureFixtureRealmIssuer(process.argv[2]);
const sourceRef = process.argv[3] === 'personaCharacter'
  ? fixture.FIXTURE_PERSONA_SOURCE_REF
  : fixture.FIXTURE_SOURCE_REF;
const packet = fixture.createFixtureSourceMaterializationPacket({
  materializerAccountId: 'materializer-1',
  sourceRef,
  challengeId: 'desktop-fixture-challenge-' + process.argv[3],
  challengeDigest: 'a'.repeat(64),
  intendedRuntimeAudience: 'runtime-instance:desktop-fixture:materializer-1',
  challengeExpiresAt: process.argv[4],
  publishedLimits: JSON.parse(process.argv[5]),
});
process.stdout.write(JSON.stringify({ packet, jwks: fixture.FIXTURE_SOURCE_MATERIALIZATION_JWKS }));
`
	limits, err := json.Marshal(sourceMaterializationProducerCeilingsV3)
	if err != nil {
		t.Fatal(err)
	}
	command := exec.Command(
		"node", "--input-type=module", "-e", script,
		moduleURL, realmSourceMaterializationServiceTestIssuerURL, sourceKind,
		expiresAt.Format(time.RFC3339Nano), string(limits),
	)
	output, err := command.Output()
	if err != nil {
		if failure, ok := err.(*exec.ExitError); ok {
			t.Fatalf("run Desktop Packet v3 fixture: %v: %s", err, failure.Stderr)
		}
		t.Fatal(err)
	}
	var result desktopRealmSourceMaterializationFixtureV3Result
	if err := json.Unmarshal(output, &result); err != nil {
		t.Fatalf("decode Desktop Packet v3 fixture output: %v", err)
	}
	return result
}
