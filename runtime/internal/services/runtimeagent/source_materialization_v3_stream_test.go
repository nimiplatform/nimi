package runtimeagent

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

func TestSourceMaterializationPacketStreamV3PreservesLongAuthoredBodies(t *testing.T) {
	vector := loadSourceMaterializationReferenceVectorV3(t, "world-character")
	// Larger than both the envelope limit and one encoded transport chunk.
	text := strings.Repeat("完整世界正文。", 20000)
	var document map[string]any
	if err := json.Unmarshal(vector.Packet, &document); err != nil {
		t.Fatal(err)
	}
	payload := document["semanticPayload"].(map[string]any)
	context := payload["materializationContext"].(map[string]any)
	world := context["owningWorld"].(map[string]any)
	world["core"].(map[string]any)["narrative"] = map[string]any{"setting": text}
	profile := payload["canonicalSource"].(map[string]any)["profile"].(map[string]any)
	profile["identity"].(map[string]any)["summary"] = text
	raw, err := json.Marshal(document)
	if err != nil {
		t.Fatal(err)
	}
	packet, err := decodeSourceMaterializationPacketStreamV3(bytes.NewReader(raw), int64(len(raw)), vector.Expectation.PublishedLimits)
	if err != nil {
		t.Fatalf("authored content within its component budget was rejected: %v", err)
	}
	decoded, err := json.Marshal(packet.SemanticPayload)
	if err != nil || bytes.Count(decoded, []byte(text)) != 2 {
		t.Fatalf("authored bodies were not preserved: %v", err)
	}
	limits := vector.Expectation.PublishedLimits
	limits.MaxSegmentBytes = uint64(len(text) - 1)
	_, err = decodeSourceMaterializationPacketStreamV3(bytes.NewReader(raw), int64(len(raw)), limits)
	if err == nil || sourceMaterializationV3FailureCode(err) != sourceMaterializationFailureCapacityV3 {
		t.Fatalf("authored body exceeding its published component bound was admitted: %v", err)
	}
}

func TestSourceMaterializationPacketStreamV3AcceptsReferenceWorldAndPersona(t *testing.T) {
	for _, name := range []string{"world-character", "persona-character"} {
		name := name
		t.Run(name, func(t *testing.T) {
			vector := loadSourceMaterializationReferenceVectorV3(t, name)
			packet, err := decodeSourceMaterializationPacketStreamV3(
				bytes.NewReader(vector.Packet),
				int64(len(vector.Packet)),
				vector.Expectation.PublishedLimits,
			)
			if err != nil {
				t.Fatalf("stream-decode reference Packet v3: %v", err)
			}
			if packet.PacketID == "" || packet.SourceRef.Kind == "" || len(packet.OrderedSegments) == 0 {
				t.Fatalf("stream-decode omitted Packet v3 authority: %+v", packet.SourceRef)
			}
		})
	}
}

func TestSourceMaterializationPacketStreamV3RejectsCapacityBeforeTypedDecode(t *testing.T) {
	limits := sourceMaterializationProducerCeilingsV3
	limits.MaxSetSegments = 1

	t.Run("field-string", func(t *testing.T) {
		raw := []byte(`{"packetId":"` + strings.Repeat("a", sourceMaterializationMaxTextBytesV3+1) + `"}`)
		_, err := decodeSourceMaterializationPacketStreamV3(bytes.NewReader(raw), int64(len(raw)), limits)
		if err == nil || sourceMaterializationV3FailureCode(err) != sourceMaterializationFailureCapacityV3 {
			t.Fatalf("oversized field string was not rejected as capacity: %v", err)
		}
	})

	t.Run("published-segment-array", func(t *testing.T) {
		raw := []byte(`{"orderedSegments":[{},{}]}`)
		_, err := decodeSourceMaterializationPacketStreamV3(bytes.NewReader(raw), int64(len(raw)), limits)
		if err == nil || sourceMaterializationV3FailureCode(err) != sourceMaterializationFailureCapacityV3 {
			t.Fatalf("published segment array overflow was not rejected as capacity: %v", err)
		}
	})
}

func TestSourceMaterializationPacketStreamV3RejectsLexicalAndClosedSchemaMutations(t *testing.T) {
	limits := sourceMaterializationProducerCeilingsV3
	for name, raw := range map[string][]byte{
		"duplicate-normalized-key": []byte(`{"e\u0301":1,"é":2}`),
		"unknown-root-field":       []byte(`{"unsupportedPacketField":{}}`),
		"unpaired-surrogate":       []byte(`{"packetId":"\ud800"}`),
		"trailing-value":           []byte(`{} {}`),
	} {
		name, raw := name, raw
		t.Run(name, func(t *testing.T) {
			_, err := decodeSourceMaterializationPacketStreamV3(bytes.NewReader(raw), int64(len(raw)), limits)
			if err == nil || sourceMaterializationV3FailureCode(err) != sourceMaterializationFailurePacketContractV3 {
				t.Fatalf("stream mutation was not rejected as Packet contract: %v", err)
			}
		})
	}
}
