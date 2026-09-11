package localservice

import (
	"bytes"
	"context"
	"image"
	"image/draw"
	"image/png"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/oklog/ulid/v2"
)

// Opt-in real ModelAsset import, managed profile and supervised Host test.
// This does not stand in for protected App/SDK Job acceptance.
func TestFaceSwapManagedExecution(t *testing.T) {
	root, dataRoot, python := os.Getenv("NIMI_FACE_SWAP_TEST_INPUT"), os.Getenv("NIMI_FACE_SWAP_TEST_DATA_ROOT"), os.Getenv("NIMI_FACE_SWAP_TEST_PYTHON")
	if root == "" || dataRoot == "" || python == "" {
		t.Skip("requires explicit face-swap inputs and managed Runtime dependency roots")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	manager, err := engine.NewManager(logger, engine.ManagedRoots{Environments: filepath.Join(dataRoot, "environments"), Dependencies: filepath.Join(dataRoot, "dependencies")}, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(manager.StopAll)
	manager.SetRuntimeWorkRoot(filepath.Join(root, "engine-work"))
	profile, err := manager.EnsurePythonDependencyProfile(ctx, filepath.Join(dataRoot, "dependencies", "uv", "uv.exe"), python, engine.FaceSwapConsumerID, "windows/amd64", "cuda")
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("managed profile: %s", profile.ProfileRoot)
	modelsRoot := filepath.Join(root, "managed-models")
	service, err := New(logger, nil, filepath.Join(root, "model-state.json"), 32, modelsRoot)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(service.Close)
	driver := capabilitydriver.InsightFaceImageDriver{}
	requirements, reason := driver.ProjectRecipe(capabilitydriver.InsightFaceRecipeID, nil, nil)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		t.Fatal(reason)
	}
	paths := []string{"models/analysis/detection/model.onnx", "models/analysis/recognition/model.onnx", "models/swap/inswapper_128.onnx"}
	var bindings []capabilitydriver.InvocationExactBinding
	for index, name := range paths {
		source, err := inspectModelAssetSource(filepath.Join(root, name), requirements[index].DisplayLabel)
		if err != nil {
			t.Fatal(err)
		}
		var asset *runtimev1.ModelAssetRecord
		for _, existing := range service.modelAssets {
			if existing.DisplayName == requirements[index].DisplayLabel {
				asset = existing
				break
			}
		}
		if asset == nil {
			asset, err = service.importModelAssetSync(ctx, "", "model_"+strings.ToLower(ulid.Make().String()), source)
			if err != nil {
				t.Fatal(err)
			}
		}
		bundle := filepath.Join(modelsRoot, "resolved", asset.ModelAssetId)
		entryPath := filepath.Join(bundle, asset.Entry)
		opened, err := os.Open(entryPath)
		if err != nil {
			t.Fatal(err)
		}
		info, err := opened.Stat()
		if err != nil {
			_ = opened.Close()
			t.Fatal(err)
		}
		probe, err := driver.ProbeModelAsset(capabilitydriver.ModelAssetFormatProbeInput{RecipeID: capabilitydriver.InsightFaceRecipeID, RequirementID: requirements[index].RequirementId, RelativePath: asset.Entry, Entry: true}, opened, info.Size())
		_ = opened.Close()
		if err != nil {
			t.Fatal(err)
		}
		binding := capabilitydriver.InvocationExactBinding{RequirementID: requirements[index].RequirementId, ModelAssetID: asset.ModelAssetId, AbsolutePath: entryPath, BundleDir: bundle, VerifiedContentID: asset.ContentId}
		for _, file := range asset.Files {
			binding.DeclaredFiles = append(binding.DeclaredFiles, file.RelativePath)
			if file.RelativePath == asset.Entry {
				binding.EntrySHA256 = strings.TrimPrefix(file.Sha256, "sha256:")
			}
		}
		exact := &runtimev1.ModelAssetExactBinding{RequirementId: binding.RequirementID, ModelAssetId: binding.ModelAssetID, VerifiedContentId: binding.VerifiedContentID, EntrySha256: binding.EntrySHA256}
		_, reason := driver.ProjectModelAssetBinding(capabilitydriver.ModelAssetBindingInput{RecipeID: capabilitydriver.InsightFaceRecipeID, Requirement: requirements[index], Binding: exact, Entry: capabilitydriver.ModelAssetFileFact{RelativePath: asset.Entry, SizeBytes: info.Size(), FormatProbe: probe}})
		if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
			t.Fatalf("%s model contract: %s", name, reason)
		}
		bindings = append(bindings, binding)
	}
	read := func(name string) []byte {
		data, err := os.ReadFile(filepath.Join(root, name))
		if err != nil {
			t.Fatal(err)
		}
		return data
	}
	plan := &capabilitydriver.ImageFaceSwapInvocationPlan{ProfileRoot: profile.ProfileRoot, ProfileDigest: profile.Identity.ProfileDigest, DriverBundleDigest: profile.Identity.DriverBundleDigest, Bindings: bindings, ReferenceImage: read("reference.png"), TargetImage: read("target.png")}
	host := engine.NewFaceSwapExecutionHost(manager)
	started := time.Now()
	result, err := host.ExecuteImageFaceSwap(ctx, plan, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("cold Host execution: %s, PNG bytes=%d", time.Since(started), len(result.Bytes))
	if err := os.WriteFile(filepath.Join(root, "managed-host.png"), result.Bytes, 0o600); err != nil {
		t.Fatal(err)
	}
	transparent := *plan
	decodedTarget, _, err := image.Decode(bytes.NewReader(plan.TargetImage))
	if err != nil {
		t.Fatal(err)
	}
	rgba := image.NewNRGBA(decodedTarget.Bounds())
	draw.Draw(rgba, rgba.Bounds(), decodedTarget, decodedTarget.Bounds().Min, draw.Src)
	for y := 0; y < rgba.Bounds().Dy(); y++ {
		for x := 0; x < rgba.Bounds().Dx(); x++ {
			if x < 45 || y < 45 || x >= rgba.Bounds().Dx()-45 || y >= rgba.Bounds().Dy()-45 {
				rgba.Pix[rgba.PixOffset(x, y)+3] = 0
			} else if x < 60 || y < 60 || x >= rgba.Bounds().Dx()-60 || y >= rgba.Bounds().Dy()-60 {
				rgba.Pix[rgba.PixOffset(x, y)+3] = 127
			}
		}
	}
	var transparentPNG bytes.Buffer
	if err := png.Encode(&transparentPNG, rgba); err != nil {
		t.Fatal(err)
	}
	transparent.TargetImage = transparentPNG.Bytes()
	transparentResult, err := host.ExecuteImageFaceSwap(ctx, &transparent, nil)
	if err != nil {
		t.Fatalf("transparent PNG execution: %v", err)
	}
	decodedResult, err := png.Decode(bytes.NewReader(transparentResult.Bytes))
	if err != nil || decodedResult.Bounds() != rgba.Bounds() {
		t.Fatalf("transparent PNG output dimensions: %v", err)
	}
	for y := 0; y < rgba.Bounds().Dy(); y++ {
		for x := 0; x < rgba.Bounds().Dx(); x++ {
			_, _, _, got := decodedResult.At(x, y).RGBA()
			_, _, _, want := rgba.At(x, y).RGBA()
			if got != want {
				t.Fatalf("target transparency changed at %d,%d: got %d, want %d", x, y, got, want)
			}
		}
	}
	t.Logf("transparent PNG: exact alpha preserved, PNG bytes=%d", len(transparentResult.Bytes))
	large := *plan
	large.ReferenceImage, large.TargetImage = read("reference-4096.png"), read("target-4096.png")
	started = time.Now()
	largeResult, err := host.ExecuteImageFaceSwap(ctx, &large, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("4096x4096 reference and target: %s, PNG bytes=%d", time.Since(started), len(largeResult.Bytes))
	oriented := *plan
	oriented.ReferenceImage, oriented.TargetImage = read("reference.jpg"), read("target-oriented.jpg")
	jpegResult, err := host.ExecuteImageFaceSwap(ctx, &oriented, nil)
	if err != nil {
		t.Fatalf("oriented JPEG execution: %v", err)
	}
	if err := os.WriteFile(filepath.Join(root, "managed-host-oriented-jpeg.png"), jpegResult.Bytes, 0o600); err != nil {
		t.Fatal(err)
	}
	t.Logf("oriented JPEG reference and target: PNG bytes=%d", len(jpegResult.Bytes))
	videoPlan := &capabilitydriver.VideoFaceSwapInvocationPlan{Models: plan.Models(), ReferenceImage: plan.ReferenceImage, TargetVideo: read("video-target.mp4"), NoFacePolicy: "fail"}
	videoResult, err := host.ExecuteVideoFaceSwap(ctx, videoPlan, nil, nil)
	if err != nil {
		t.Fatalf("video Host execution: %v", err)
	}
	videoBytes, readErr := io.ReadAll(videoResult.Body)
	closeErr := videoResult.Body.Close()
	if readErr != nil || closeErr != nil || int64(len(videoBytes)) != videoResult.SizeBytes || videoResult.Summary.TotalFrames != 125 || videoResult.Summary.TransformedFrames != 125 || !videoResult.Summary.AudioPreserved {
		t.Fatalf("video Host result: %+v, read=%v, close=%v", videoResult.Summary, readErr, closeErr)
	}
	if err := os.WriteFile(filepath.Join(root, "managed-host-video.mp4"), videoBytes, 0o600); err != nil {
		t.Fatal(err)
	}
	t.Logf("video Host: %d transformed frames, %d MP4 bytes", videoResult.Summary.TotalFrames, len(videoBytes))
	for _, sample := range []struct {
		name                   string
		policy                 string
		transformed, preserved uint32
	}{
		{"video-rate24.mp4", "fail", 48, 0},
		{"video-rate30.mp4", "fail", 60, 0},
		{"video-no-face.mp4", "preserve_frame", 100, 25},
	} {
		candidate := *videoPlan
		candidate.TargetVideo, candidate.NoFacePolicy = read(sample.name), sample.policy
		result, err := host.ExecuteVideoFaceSwap(ctx, &candidate, nil, nil)
		if err != nil {
			t.Fatalf("%s: %v", sample.name, err)
		}
		if result.Summary.TransformedFrames != sample.transformed || result.Summary.PreservedFrames != sample.preserved || result.Summary.AudioPreserved {
			_ = result.Body.Close()
			t.Fatalf("%s: %+v", sample.name, result.Summary)
		}
		if err := result.Body.Close(); err != nil {
			t.Fatal(err)
		}
	}
	t.Log("silent 24/30 FPS video and explicit no-face preservation passed")
	videoCtx, cancelVideo := context.WithCancel(ctx)
	_, err = host.ExecuteVideoFaceSwap(videoCtx, videoPlan, nil, func(done, total int32) {
		if done > 0 {
			cancelVideo()
		}
	})
	cancelVideo()
	if err == nil {
		t.Fatal("video processing cancellation returned success")
	}
	entries, err := os.ReadDir(filepath.Join(root, "engine-work", "face-swap"))
	if err != nil || len(entries) != 0 {
		t.Fatalf("video temporary work survived completion/cancellation: %v, %v", entries, err)
	}
	t.Log("video cancellation after actual frame progress stopped execution and cleaned temporary output")
	for _, test := range []struct {
		reference, target string
		want              runtimev1.ReasonCode
	}{
		{"no-face.png", "target.png", runtimev1.ReasonCode_AI_FACE_REFERENCE_MISSING},
		{"multiple.png", "target.png", runtimev1.ReasonCode_AI_FACE_REFERENCE_AMBIGUOUS},
		{"reference.png", "no-face.png", runtimev1.ReasonCode_AI_FACE_TARGET_MISSING},
		{"reference.png", "multiple.png", runtimev1.ReasonCode_AI_FACE_TARGET_AMBIGUOUS},
	} {
		candidate := *plan
		candidate.ReferenceImage, candidate.TargetImage = read(test.reference), read(test.target)
		_, err := host.ExecuteImageFaceSwap(ctx, &candidate, nil)
		reason, ok := grpcerr.ExtractReasonCode(err)
		if !ok || reason != test.want {
			t.Fatalf("face selection: got %v, want %s", err, test.want)
		}
	}
	cancelCtx, stop := context.WithCancel(ctx)
	startedSignal := make(chan struct{})
	finished := make(chan error, 1)
	go func() {
		_, err := host.ExecuteImageFaceSwap(cancelCtx, plan, func() error { close(startedSignal); return nil })
		finished <- err
	}()
	select {
	case <-startedSignal:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	for {
		info, err := manager.EngineStatus(engine.EngineKind("face-swap-execution-host"))
		if err == nil && info.PID > 0 && info.Status == engine.StatusHealthy {
			break
		}
		select {
		case err := <-finished:
			stop()
			t.Fatalf("execution ended before active-Worker cancellation: %v", err)
		case <-ctx.Done():
			stop()
			t.Fatal(ctx.Err())
		case <-time.After(10 * time.Millisecond):
		}
	}
	started = time.Now()
	stop()
	if err := <-finished; err == nil {
		t.Fatal("canceled inference succeeded")
	}
	t.Logf("cancellation and lease release: %s", time.Since(started))
	if _, err := host.ExecuteImageFaceSwap(ctx, plan, nil); err != nil {
		t.Fatalf("subsequent Host request: %v", err)
	}
	session, err := host.OpenVideoFaceSwapSession(ctx, plan.Models(), plan.ReferenceImage, "live-session-1", 1280, 720)
	if err != nil {
		t.Fatalf("video Session open: %v", err)
	}
	frame := make([]byte, 1280*720*3)
	for y := 0; y < 720; y++ {
		for x := 0; x < 1280; x++ {
			r, g, b, _ := decodedTarget.At(x, y).RGBA()
			offset := (y*1280 + x) * 3
			frame[offset], frame[offset+1], frame[offset+2] = byte(r>>8), byte(g>>8), byte(b>>8)
		}
	}
	started = time.Now()
	for index := 0; index < 30; index++ {
		result, err := session.ReplaceFrame(ctx, frame)
		if err != nil || len(result) != len(frame) || bytes.Equal(result, frame) {
			_ = session.Close()
			t.Fatalf("Session frame %d: %v", index, err)
		}
	}
	t.Logf("30 actual 720p Session frames: %s", time.Since(started))
	if _, err := session.ReplaceFrame(ctx, make([]byte, len(frame))); err == nil {
		_ = session.Close()
		t.Fatal("empty scene became a transformed Session frame")
	}
	if _, err := session.ReplaceFrame(ctx, frame); err != nil {
		_ = session.Close()
		t.Fatalf("Session did not recover from no-target-face: %v", err)
	}
	if err := session.Close(); err != nil {
		t.Fatalf("Session Close: %v", err)
	}
	if _, err := host.ExecuteImageFaceSwap(ctx, plan, nil); err != nil {
		t.Fatalf("Session did not release shared Host capacity: %v", err)
	}
}
