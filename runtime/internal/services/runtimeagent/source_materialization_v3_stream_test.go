package runtimeagent

import (
	"bytes"
	"strings"
	"testing"
)

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
