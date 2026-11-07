package nimillm

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/protobuf/proto"
	"image"
	"image/color"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func ideogramTestImage(t *testing.T, picture image.Image, id string) *CapturedMediaReference {
	t.Helper()
	var b bytes.Buffer
	if err := png.Encode(&b, picture); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(b.Bytes())
	return &CapturedMediaReference{ArtifactID: id, MIMEType: "image/png", Bytes: b.Bytes(), SHA256: hex.EncodeToString(sum[:])}
}

func TestIdeogram45OwnedMultipartMaskDirectionAndWholeTaskResult(t *testing.T) {
	picture := image.NewGray(image.Rect(0, 0, 2, 1))
	picture.SetGray(0, 0, color.Gray{Y: 255})
	source := ideogramTestImage(t, picture, "source")
	mask := ideogramTestImage(t, picture, "mask")
	s := &runtimev1.ImageGenerateScenarioSpec{Prompt: "edit white area", ReferenceImageArtifactId: "source", MaskArtifactId: "mask", Seed: proto.Int64(0), N: proto.Int32(2), Quality: "low"}
	if err := ValidateIdeogram45OwnedSource(s, source); err != nil {
		t.Fatal(err)
	}
	if err := ValidateIdeogram45OwnedMask(s, source, mask); err != nil {
		t.Fatal(err)
	}
	ctx := WithImageMaskReference(WithImageReference(context.Background(), source), mask)
	status, id, safe := "pending", "generation", true
	creates, downloads := 0, 0
	var endpoint string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/image" {
			downloads++
			if r.Header.Get("Api-Key") != "" || r.Header.Get("Authorization") != "" {
				t.Error("credential leaked to result")
			}
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write(source.Bytes)
			return
		}
		if r.Header.Get("Api-Key") != "key" || r.Header.Get("Authorization") != "" {
			t.Error("incorrect auth")
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/gateway/v2/image/generate/ideogram-4-5":
			creates++
			if err := r.ParseMultipartForm(1 << 20); err != nil {
				t.Error(err)
				return
			}
			defer func(cleanup func() error) { _ = cleanup() }(r.MultipartForm.RemoveAll)
			if r.FormValue("async") != "true" || r.FormValue("seed") != "0" || r.FormValue("num_images") != "2" || r.FormValue("size") != "" {
				t.Error("native fields changed")
			}
			f, _, err := r.FormFile("images")
			if err != nil {
				t.Error(err)
				return
			}
			data, _ := io.ReadAll(f)
			_ = f.Close()
			if !bytes.Equal(data, source.Bytes) {
				t.Error("source changed")
			}
			f, _, err = r.FormFile("mask")
			if err != nil {
				t.Error(err)
				return
			}
			m, err := png.Decode(f)
			_ = f.Close()
			if err != nil {
				t.Error(err)
				return
			}
			v, _, _, _ := m.At(0, 0).RGBA()
			v2, _, _, _ := m.At(1, 0).RGBA()
			if v != 0 || v2 != 65535 {
				t.Error("mask inversion lost")
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"generation_id": "generation", "generation_kind": "sampling"})
		case "/gateway/v2/generations/generation":
			_ = json.NewEncoder(w).Encode(map[string]any{"generation_id": id, "status": status, "response_type": "url", "data": []any{map[string]any{"is_image_safe": true, "url": endpoint + "/image", "resolution": "2x1"}, map[string]any{"is_image_safe": safe, "url": endpoint + "/image", "resolution": "2x1"}}})
		default:
			t.Errorf("unexpected %s", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer server.Close()
	endpoint = server.URL
	var receipt *NativeTaskReceipt
	ctx = WithNativeTaskPublisher(ctx, func(r *NativeTaskReceipt) error { receipt = CloneNativeTaskReceipt(r); return nil })
	cfg := MediaAdapterConfig{BaseURL: endpoint + "/gateway/v2", APIKey: "key", AllowLoopbackEndpoint: true}
	_, _, _, err := executeIdeogram45Image(ctx, cfg, s)
	if !errors.Is(err, ErrNativeTaskYielded) {
		t.Fatal(err)
	}
	if _, terminal, e := ObserveNativeTask(context.Background(), cfg, receipt); terminal || e != nil {
		t.Fatal("pending", e)
	}
	status = "completed"
	id = "foreign"
	if _, _, e := ObserveNativeTask(context.Background(), cfg, receipt); e == nil {
		t.Fatal("foreign generation accepted")
	}
	id = "generation"
	safe = false
	if result, terminal, e := ObserveNativeTask(context.Background(), cfg, receipt); e == nil || !terminal || result != nil {
		t.Fatal("unsafe partial success")
	}
	safe = true
	result, terminal, err := ObserveNativeTask(context.Background(), cfg, receipt)
	if err != nil || !terminal || len(result.Artifacts) != 2 || result.Artifacts[1].ArtifactId != receipt.Artifact.ArtifactId+"-1" {
		t.Fatal(result, err)
	}
	bodies, err := OpenNativeTaskArtifacts(context.Background(), cfg, receipt, result)
	if err != nil {
		t.Fatal(err)
	}
	for _, b := range bodies {
		_, _ = io.Copy(io.Discard, b.Stream)
		_ = b.Stream.Close()
	}
	if creates != 1 || downloads != 2 {
		t.Fatal("generation replay or incomplete output")
	}
}

func TestIdeogram45MaskRejectsRoundingAndGeometryChanges(t *testing.T) {
	for _, value := range []uint8{0, 128, 255} {
		m := image.NewGray(image.Rect(0, 0, 2, 1))
		m.SetGray(0, 0, color.Gray{Y: value})
		m.SetGray(1, 0, color.Gray{Y: value})
		r := ideogramTestImage(t, m, "mask")
		if _, err := ideogram45NativeMask(m.Bounds(), r.Bytes, r.MIMEType); err == nil {
			t.Fatal("uniform or gray mask admitted")
		}
	}
	m := image.NewGray(image.Rect(0, 0, 2, 1))
	m.SetGray(0, 0, color.Gray{Y: 255})
	r := ideogramTestImage(t, m, "mask")
	if _, err := ideogram45NativeMask(image.Rect(0, 0, 3, 1), r.Bytes, r.MIMEType); err == nil {
		t.Fatal("mask resized")
	}
	r.Bytes[0] ^= 0xff
	err := validateCapturedMediaReferenceIdentity(r, "mask")
	reason, _ := grpcerr.ExtractReasonCode(err)
	if reason != runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID {
		t.Fatal("tampered capture accepted")
	}
}
