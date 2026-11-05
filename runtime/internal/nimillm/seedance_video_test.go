package nimillm

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/protobuf/proto"
)

func TestSeedanceSerializedBudgetCountsBase64ExpansionOfValidImages(t *testing.T) {
	picture := image.NewRGBA(image.Rect(0, 0, 2048, 2048))
	draw.Draw(picture, picture.Bounds(), image.NewUniform(color.RGBA{B: 200, A: 255}), image.Point{}, draw.Src)
	var encoded bytes.Buffer
	encoder := png.Encoder{CompressionLevel: png.NoCompression}
	if err := encoder.Encode(&encoded, picture); err != nil {
		t.Fatal(err)
	}
	data := encoded.Bytes()
	digest := sha256.Sum256(data)
	spec := &runtimev1.VideoGenerateScenarioSpec{Mode: runtimev1.VideoMode_VIDEO_MODE_I2V_REFERENCE, Prompt: "Animate the blue reference images."}
	var refs []CloudVideoMediaReference
	for i := 0; i < 4; i++ {
		id := string(rune('a' + i))
		spec.Content = append(spec.Content, &runtimev1.VideoContentItem{Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_ARTIFACT_REF, Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_IMAGE, ArtifactRef: &runtimev1.VideoContentArtifactRef{ArtifactId: id}})
		refs = append(refs, CloudVideoMediaReference{ContentIndex: i, Reference: CapturedMediaReference{ArtifactID: id, MIMEType: "image/png", Bytes: data, SHA256: hex.EncodeToString(digest[:])}})
	}
	if 4*len(data) >= 64_000_000 {
		t.Fatal("fixture must fit the raw-byte capture budget")
	}
	err := ValidateCloudVideoMediaReferences("volcengine", capabilitydriver.Seedance25VideoModel, spec, refs)
	if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_ARTIFACT_TOO_LARGE {
		t.Fatalf("serialized native body budget not enforced: %v", err)
	}
	spec.Content = spec.Content[:2]
	if err := ValidateCloudVideoMediaReferences("volcengine", capabilitydriver.Seedance25VideoModel, spec, refs[:2]); err != nil {
		t.Fatalf("bounded valid images rejected: %v", err)
	}
}

func TestSeedanceNativeOwnedAudioPreservesPromptPositionAndExplicitFalse(t *testing.T) {
	// The byte fixture tests projection only; native codec acceptance is a
	// separate real-provider test, and no generated artifact is fabricated here.
	data := []byte("owned-audio-projection-fixture")
	digest := sha256.Sum256(data)
	ref := CloudVideoMediaReference{ContentIndex: 0, Reference: CapturedMediaReference{ArtifactID: "owned", MIMEType: "audio/wav", Bytes: data, SHA256: hex.EncodeToString(digest[:])}}
	s := &runtimev1.VideoGenerateScenarioSpec{Mode: runtimev1.VideoMode_VIDEO_MODE_I2V_REFERENCE, Prompt: "A harbor.", Content: []*runtimev1.VideoContentItem{{Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_ARTIFACT_REF, Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_AUDIO, ArtifactRef: &runtimev1.VideoContentArtifactRef{ArtifactId: "owned"}}}, Options: &runtimev1.VideoGenerationOptions{DurationSec: proto.Int32(-1), GenerateAudio: proto.Bool(false), Watermark: proto.Bool(false), ReturnLastFrame: proto.Bool(true)}}
	body, err := buildSeedanceVideoPayload(WithCloudVideoMediaReferences(context.Background(), []CloudVideoMediaReference{ref}), capabilitydriver.Seedance25VideoModel, s)
	if err != nil {
		t.Fatal(err)
	}
	content := body["content"].([]map[string]any)
	if len(content) != 2 || content[0]["text"] != "A harbor." || content[1]["type"] != "audio_url" || content[1]["role"] != "reference_audio" || !strings.HasPrefix(content[1]["audio_url"].(map[string]any)["url"].(string), "data:audio/wav;base64,") {
		t.Fatalf("wrong owned media/prompt projection: %+v", content)
	}
	if body["duration"] != int32(-1) || body["generate_audio"] != false || body["watermark"] != false || body["return_last_frame"] != true {
		t.Fatalf("controls changed: %+v", body)
	}
	if _, err := buildSeedanceVideoPayload(context.Background(), capabilitydriver.Seedance25VideoModel, s); err == nil {
		t.Fatal("missing captured material became a forwarded artifact ID")
	}
	if s.GetContent()[0].GetArtifactRef().GetArtifactId() != "owned" {
		t.Fatal("dispatch mutated the frozen spec")
	}
}

func TestSeedanceObservationKeepsExactIdentityJPEGAndReportedUsage(t *testing.T) {
	receipt := &NativeTaskReceipt{Version: 1, Adapter: AdapterBytedanceARKTask, TaskID: "original", Model: capabilitydriver.Seedance25VideoModel, QueryPathTemplate: resolveBytedanceARKVideoQueryPathTemplate(), Artifact: BinaryArtifact("video/mp4", nil, nil)}
	response := func() map[string]any {
		return map[string]any{"id": "original", "model": capabilitydriver.Seedance25VideoModel, "status": "succeeded", "duration": 4, "content": map[string]any{"video_url": "https://media.example.test/actual.mp4", "last_frame_url": "https://media.example.test/actual.jpg"}, "usage": map[string]any{"completion_tokens": 12345, "total_tokens": 12345}}
	}
	result, done, err := observeSeedanceVideoResponse(receipt, response())
	if err != nil || !done || len(result.GetArtifacts()) != 2 {
		t.Fatalf("observation=%+v done=%v err=%v", result, done, err)
	}
	if result.Artifacts[1].GetMimeType() != "image/jpeg" || result.Artifacts[0].GetDurationMs() != 0 || result.Usage.GetOutputTokens() != 12345 {
		t.Fatalf("invented physical facts or wrong JPEG/usage: %+v", result)
	}
	for _, mutate := range []func(map[string]any){
		func(p map[string]any) { p["id"] = "other" },
		func(p map[string]any) { p["model"] = capabilitydriver.Seedance20VideoModel },
		func(p map[string]any) { delete(p, "model") },
		func(p map[string]any) { p["content"].(map[string]any)["last_frame_url"] = "" },
		func(p map[string]any) { p["usage"] = map[string]any{"completion_tokens": -1, "total_tokens": -1} },
		func(p map[string]any) { p["usage"] = map[string]any{"completion_tokens": 10, "total_tokens": 11} },
		func(p map[string]any) {
			p["content"].(map[string]any)["video_url"] = "https://user:password@media.example.test/video.mp4"
		},
	} {
		bad := response()
		mutate(bad)
		if _, _, err := observeSeedanceVideoResponse(receipt, bad); err == nil {
			t.Fatal("invalid native observation accepted")
		}
	}
	pending := map[string]any{"id": "original", "status": "running"}
	if _, done, err := observeSeedanceVideoResponse(receipt, pending); done || err != nil {
		t.Fatalf("pending=%v %v", done, err)
	}
}
