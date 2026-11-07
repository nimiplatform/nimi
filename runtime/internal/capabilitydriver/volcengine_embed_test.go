package capabilitydriver

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestVolcengineEmbeddingCapturesNativeWidthAndSingleInputTransport(t *testing.T) {
	for _, model := range []string{"doubao-embedding-vision-251215", "doubao-embedding-vision-250615"} {
		raw, _ := structpb.NewStruct(map[string]any{"provider": "volcengine", "providerModelId": model, "remoteModelCatalogId": "reviewed"})
		d, target, err := NewProductionCloudEmbedRegistry().Resolve(Identity{ImplementationID: "volcengine", DriverID: "nimillm", DriverDialect: "volcengine"}, raw)
		if err != nil {
			t.Fatal(err)
		}
		for _, width := range []*uint32{nil, proto.Uint32(1024), proto.Uint32(2048)} {
			spec := &runtimev1.TextEmbedScenarioSpec{Inputs: []string{"  原文\n", "second"}, Dimensions: width, Purpose: runtimev1.TextEmbedPurpose_TEXT_EMBED_PURPOSE_RETRIEVAL_QUERY}
			mapped, err := d.MapRequest(target, spec, nil)
			if err != nil || mapped.Protocol() != CloudEmbedProtocolVolcengineV1 || mapped.DefaultDimensions() != 2048 || mapped.TransportBatchSize() != 1 || mapped.Inputs()[0] != "  原文\n" || mapped.Purpose() != spec.Purpose {
				t.Fatal("native capture", model, err)
			}
		}
		for _, width := range []uint32{0, 1023, 1536, 2049} {
			if _, err := d.MapRequest(target, &runtimev1.TextEmbedScenarioSpec{Inputs: []string{"hello"}, Dimensions: &width}, nil); err == nil {
				t.Fatal("unsupported width admitted", model, width)
			}
		}
	}
}
