package engine

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"google.golang.org/protobuf/proto"
)

func TestVisionResponseSeparatesJSONTransportAndProtoResultLimits(t *testing.T) {
	plan := &capabilitydriver.VisionLocateInvocationPlan{
		Request: &runtimev1.VisionLocateScenarioSpec{ImageArtifactId: "image-1", Geometry: runtimev1.VisionLocateGeometry_VISION_LOCATE_GEOMETRY_POINT},
		Width:   1200, Height: 800,
	}
	for _, labelBytes := range []int{230, 240} {
		locations := make([]map[string]any, 1000)
		for index := range locations {
			locations[index] = map[string]any{"point": []float64{.123, .456}, "label": strings.Repeat("a", labelBytes)}
		}
		encoded, err := json.Marshal(map[string]any{"image_artifact_id": "image-1", "width": 1200, "height": 800, "locations": locations})
		if err != nil {
			t.Fatal(err)
		}
		if len(encoded) <= localexecution.MaxVisionLocateResultBytes {
			t.Fatal("fixture does not exercise JSON expansion")
		}
		payload, err := readVisionLocateResponse(bytes.NewReader(encoded))
		if err != nil {
			t.Fatalf("private JSON transport rejected %d bytes: %v", len(encoded), err)
		}
		result, err := decodeVisionLocateResponse(payload, plan)
		if labelBytes == 230 {
			if err != nil {
				t.Fatal(err)
			}
			if len(result.Locations) != 1000 || proto.Size(result) > localexecution.MaxVisionLocateResultBytes {
				t.Fatal("valid typed result changed")
			}
		} else if err == nil {
			t.Fatal("public protobuf limit was expanded with the transport limit")
		}
	}
	if _, err := readVisionLocateResponse(bytes.NewReader(bytes.Repeat([]byte{' '}, maxVisionLocateJSONBytes+1))); err == nil {
		t.Fatal("private response lost its bounded read")
	}
}
