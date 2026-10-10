package engine

import (
	"context"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
)

// This opt-in check invokes the real managed dependency materializer, exact
// captured model seal, supervised private Worker and actual encoder. It does
// not establish a protected App session or recognition/matching quality.
func TestSpeakerEncoderActualManagedExecution(t *testing.T) {
	root := os.Getenv("NIMI_TEST_SPEAKER_LIVE_ROOT")
	model := os.Getenv("NIMI_TEST_SPEAKER_ONNX_PATH")
	audio := os.Getenv("NIMI_TEST_SPEAKER_AUDIO_PATH")
	if root == "" || model == "" || audio == "" {
		t.Skip("isolated real speaker inputs not supplied")
	}
	if !filepath.IsAbs(root) || !filepath.IsAbs(model) || !filepath.IsAbs(audio) {
		t.Fatal("live test inputs must be absolute")
	}
	manager, err := NewManager(slog.New(slog.NewTextHandler(io.Discard, nil)), ManagedRoots{Environments: filepath.Join(root, "environments"), Dependencies: filepath.Join(root, "dependencies")}, nil)
	if err != nil {
		t.Fatal(err)
	}
	manager.SetRuntimeWorkRoot(filepath.Join(root, "work"))
	defer manager.StopAll(context.Background())
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	uv, err := manager.EnsureUVToolDependency(ctx)
	if err != nil {
		t.Fatal(err)
	}
	python, err := manager.EnsurePythonRuntimeDependency(ctx, uv.ExecutablePath, "python", ManagedPythonVersion, ManagedPythonVersion)
	if err != nil {
		t.Fatal(err)
	}
	status, err := manager.EnsurePythonDependencyProfile(ctx, uv.ExecutablePath, python.InterpreterPath, SpeakerEncoderConsumerID, "windows/amd64", "cpu")
	if err != nil {
		t.Fatal(err)
	}
	digest, err := hashInvocationContentFileContext(ctx, model)
	if err != nil {
		t.Fatal(err)
	}
	bytes, err := os.ReadFile(audio)
	if err != nil {
		t.Fatal(err)
	}
	plan := &capabilitydriver.SpeakerEmbeddingInvocationPlan{ProfileRoot: status.ProfileRoot, ProfileDigest: status.Identity.ProfileDigest, DriverBundleDigest: status.Identity.DriverBundleDigest,
		Binding:    capabilitydriver.InvocationExactBinding{RequirementID: capabilitydriver.SpeakerEncoderSlot, ModelAssetID: "actual-input-model", AbsolutePath: model, BundleDir: filepath.Dir(model), DeclaredFiles: []string{filepath.Base(model)}, VerifiedContentID: "sha256:" + digest, EntrySHA256: digest},
		AudioBytes: bytes, MIMEType: "audio/wav", Dimension: 512}
	// Private plan needs the captured canonical spec even though the Worker
	// receives only its exact media/model facts.
	plan.Request = &runtimev1.AudioSpeakerEmbedScenarioSpec{MimeType: "audio/wav"}
	host := NewSpeakerEmbeddingExecutionHost(manager)
	result, err := host.ExecuteSpeakerEmbedding(ctx, plan, func() error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	if err := localexecution.ValidateSpeakerEmbeddingResult(result, 512, false); err != nil {
		t.Fatal(err)
	}
	t.Logf("actual managed speaker vector width=%d", len(result.GetVector().GetValues()))
}
