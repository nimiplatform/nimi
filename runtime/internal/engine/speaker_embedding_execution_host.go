package engine

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
)

const engineSpeakerEmbeddingHost EngineKind = "speaker-encoder-host"

// @nimi-authority: rule.nimi.runtime.speaker-representation.sherpa-speaker-encoder
type SpeakerEmbeddingExecutionHost struct {
	residentModelAssets
	manager  *Manager
	lease    speechExecutionLease
	identity string
	endpoint string
	token    string
	poisoned error
}

func NewSpeakerEmbeddingExecutionHost(manager *Manager) *SpeakerEmbeddingExecutionHost {
	if manager == nil {
		return nil
	}
	return &SpeakerEmbeddingExecutionHost{manager: manager}
}

func (host *SpeakerEmbeddingExecutionHost) ExecuteSpeakerEmbedding(ctx context.Context, plan *capabilitydriver.SpeakerEmbeddingInvocationPlan, onStart func() error) (*runtimev1.AudioSpeakerEmbedResult, error) {
	if host == nil || plan == nil || plan.Request == nil || len(plan.AudioBytes) == 0 {
		return nil, executionFailure(localexecution.FailureLoad, fmt.Errorf("speaker encoder Host or captured plan is unavailable"))
	}
	release, err := host.lease.acquire(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { release(); host.residentModelAssets.notifyIdle() }()
	host.residentModelAssets.capture([]capabilitydriver.InvocationExactBinding{plan.Binding})
	if host.poisoned != nil {
		return nil, executionFailure(localexecution.FailureProcessCrash, host.poisoned)
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if plan.Dimension < 1 || plan.Dimension > 4096 {
		return nil, fmt.Errorf("speaker embedding dimension was not captured")
	}
	if onStart != nil {
		if err := onStart(); err != nil {
			return nil, err
		}
	}
	if _, err := sealInvocationModelContentContext(ctx, []capabilitydriver.InvocationExactBinding{plan.Binding}); err != nil {
		return nil, err
	}
	if err := host.start(ctx, plan); err != nil {
		return nil, host.fail(ctx, err)
	}
	host.manager.mu.RLock()
	root := host.manager.runtimeWorkRoot
	host.manager.mu.RUnlock()
	if root == "" || !filepath.IsAbs(root) {
		return nil, executionFailure(localexecution.FailureLoad, fmt.Errorf("Runtime speaker work root is unavailable"))
	}
	if err := os.MkdirAll(root, 0700); err != nil {
		return nil, err
	}
	work, err := os.MkdirTemp(root, "speaker-work-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(work)
	audio := filepath.Join(work, "audio.input")
	if err := os.WriteFile(audio, plan.AudioBytes, 0600); err != nil {
		return nil, err
	}
	body, err := json.Marshal(map[string]any{
		"protocol": capabilitydriver.SpeakerEncoderProtocol, "dimension": plan.Dimension, "audio_path": audio,
		"model": map[string]any{"bundle_dir": plan.Binding.BundleDir, "entry_path": plan.Binding.AbsolutePath, "declared_files": plan.Binding.DeclaredFiles},
	})
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, host.endpoint+"/v1/audio/speaker-embed", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-nimi-speaker-token", host.token)
	response, err := (&http.Client{}).Do(req)
	if err != nil {
		return nil, host.fail(ctx, err)
	}
	defer func() { _ = response.Body.Close() }()
	payload, err := io.ReadAll(io.LimitReader(response.Body, 128*1024+1))
	if err != nil || len(payload) > 128*1024 {
		return nil, host.fail(ctx, fmt.Errorf("speaker encoder Worker response is unreadable or oversized"))
	}
	if response.StatusCode != http.StatusOK {
		var failure struct {
			ReasonCode string `json:"reason_code"`
			Detail     string `json:"detail"`
		}
		if json.Unmarshal(payload, &failure) != nil {
			return nil, host.fail(ctx, fmt.Errorf("speaker encoder Worker returned an invalid failure"))
		}
		if response.StatusCode == http.StatusBadRequest && failure.ReasonCode == "AI_INPUT_INVALID" {
			return nil, executionFailure(localexecution.FailureInputInvalid, fmt.Errorf("speaker input is invalid"))
		}
		return nil, host.fail(ctx, fmt.Errorf("speaker encoder Worker: %s: %s", failure.ReasonCode, failure.Detail))
	}
	var result struct {
		Protocol string    `json:"protocol"`
		Vector   []float64 `json:"vector"`
	}
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&result); err != nil || result.Protocol != capabilitydriver.SpeakerEncoderProtocol || len(result.Vector) != plan.Dimension {
		return nil, host.fail(ctx, fmt.Errorf("speaker Worker returned an invalid representation"))
	}
	nonzero := false
	for _, value := range result.Vector {
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return nil, host.fail(ctx, fmt.Errorf("speaker Worker returned a nonfinite representation"))
		}
		nonzero = nonzero || value != 0
	}
	if !nonzero {
		return nil, host.fail(ctx, fmt.Errorf("speaker Worker returned a zero representation"))
	}
	return &runtimev1.AudioSpeakerEmbedResult{Vector: &runtimev1.EmbeddingVector{Values: result.Vector}}, nil

}

func (host *SpeakerEmbeddingExecutionHost) start(ctx context.Context, plan *capabilitydriver.SpeakerEmbeddingInvocationPlan) error {
	manifest, err := ReadPythonDependencyProfileManifest(plan.ProfileRoot)
	if err != nil {
		return executionFailure(localexecution.FailureLoad, err)
	}
	profile := manifest.Identity
	if profile.PlatformTuple != runtime.GOOS+"/"+runtime.GOARCH || profile.AcceleratorPlane != "cpu" || manifest.ValidationConsumer != SpeakerEncoderConsumerID ||
		profile.ProfileDigest != plan.ProfileDigest || profile.DriverBundleDigest != plan.DriverBundleDigest || profile.DriverProtocol != capabilitydriver.SpeakerEncoderProtocol {
		return executionFailure(localexecution.FailureLoad, fmt.Errorf("captured speaker encoder profile does not match the Worker"))
	}
	if err := VerifyPythonDependencyProfileStaticContent(plan.ProfileRoot, SpeakerEncoderConsumerID, profile); err != nil {
		return err
	}
	identity := SpeakerEncoderConsumerID + "\n" + plan.ProfileRoot + "\n" + plan.ProfileDigest + "\n" + plan.DriverBundleDigest + "\n" + capabilitydriver.SpeakerEncoderProtocol + "\n" + plan.Binding.BundleDir + "\n" + plan.Binding.VerifiedContentID
	info, statusErr := host.manager.EngineStatus(engineSpeakerEmbeddingHost)
	if statusErr == nil && info.Status == StatusHealthy && info.PID > 0 && host.identity == identity && host.token != "" {
		return nil
	}
	if err := host.stop(); err != nil {
		return err
	}
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return err
	}
	port := listener.Addr().(*net.TCPAddr).Port
	if err := listener.Close(); err != nil {
		return err
	}
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		return err
	}
	token := hex.EncodeToString(secret)
	env := pythonDependencyProfileReadOnlyEnv()
	env["NIMI_RUNTIME_SPEAKER_ADMISSION_TOKEN"] = token

	cfg := EngineConfig{
		Kind: engineSpeakerEmbeddingHost, Port: port, BinaryPath: managedPythonPath(plan.ProfileRoot),
		CommandArgs: []string{filepath.Join(plan.ProfileRoot, "speaker_embedding_server.py"), "--port", strconv.Itoa(port)},
		CommandEnv:  env, WorkingDir: plan.ProfileRoot, ExecutionHostIdentity: identity,
		HealthMode: HealthModeHTTP, HealthPath: "/health", HealthResponse: capabilitydriver.SpeakerEncoderProtocol,
		StartupTimeout: 60 * time.Second, HealthInterval: 30 * time.Second, ShutdownTimeout: 3 * time.Second, MaxRestarts: 0,
	}
	if err := host.manager.StartEngine(ctx, cfg); err != nil {
		return err
	}
	host.identity, host.token, host.endpoint = identity, token, cfg.Endpoint()
	return nil
}

func (host *SpeakerEmbeddingExecutionHost) stop() error {
	err := host.manager.StopEngine(engineSpeakerEmbeddingHost)
	if err != nil && !errors.Is(err, ErrEngineNotRunning) {
		host.poisoned = fmt.Errorf("stop speaker encoder Worker before releasing its lease: %w", err)
		return executionFailure(localexecution.FailureProcessCrash, host.poisoned)
	}
	host.identity, host.token, host.endpoint = "", "", ""
	return nil
}

func (host *SpeakerEmbeddingExecutionHost) fail(ctx context.Context, cause error) error {
	if err := host.stop(); err != nil {
		return err
	}
	if ctx.Err() != nil {
		return executionFailure(localexecution.FailureCanceled, ctx.Err())
	}
	return executionFailure(localexecution.FailureInference, cause)
}
