package engine

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"io"
	"net"
	"net/http"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"google.golang.org/grpc/codes"
)

const engineFaceSwapExecutionHost EngineKind = "face-swap-execution-host"
const maxFaceSwapResponseBytes = 96 * 1024 * 1024

// @nimi-authority: rule.nimi.runtime.ai-provider.face-swap-host
type FaceSwapExecutionHost struct {
	manager                   *Manager
	lease                     speechExecutionLease
	identity, endpoint, token string
	poisoned                  error
}

func NewFaceSwapExecutionHost(manager *Manager) *FaceSwapExecutionHost {
	if manager == nil {
		return nil
	}
	return &FaceSwapExecutionHost{manager: manager}
}

func (host *FaceSwapExecutionHost) AdmitImageFaceSwap(plan *capabilitydriver.ImageFaceSwapInvocationPlan) error {
	if host == nil || plan == nil || len(plan.Bindings) != 3 {
		return fmt.Errorf("face replacement Host has no captured plan")
	}
	if _, _, err := localexecution.FaceSwapImageSize(plan.ReferenceImage); err != nil {
		return err
	}
	if _, _, err := localexecution.FaceSwapImageSize(plan.TargetImage); err != nil {
		return err
	}
	return host.admitModels(plan.Models())
}

func (host *FaceSwapExecutionHost) admitModels(plan capabilitydriver.FaceSwapModelPlan) error {
	if host == nil || host.manager == nil || len(plan.Bindings) != 3 {
		return fmt.Errorf("face replacement Host has no captured model plan")
	}
	manifest, err := ReadPythonDependencyProfileManifest(plan.ProfileRoot)
	if err != nil {
		return err
	}
	identity := manifest.Identity
	if runtime.GOOS != "windows" || runtime.GOARCH != "amd64" {
		return fmt.Errorf("face replacement Host requires windows/amd64")
	}
	if identity.PlatformTuple != "windows/amd64" || identity.AcceleratorPlane != "cuda" ||
		identity.ProfileDigest != plan.ProfileDigest || identity.DriverBundleDigest != plan.DriverBundleDigest || identity.DriverProtocol != capabilitydriver.InsightFaceProtocol || manifest.ValidationConsumer != FaceSwapConsumerID {
		return fmt.Errorf("captured face replacement profile is not admitted on this Host")
	}
	return VerifyPythonDependencyProfileStaticContent(plan.ProfileRoot, FaceSwapConsumerID, identity)
}

func (host *FaceSwapExecutionHost) ExecuteImageFaceSwap(ctx context.Context, plan *capabilitydriver.ImageFaceSwapInvocationPlan, onStart func() error) (localexecution.ImageArtifact, error) {
	if err := host.AdmitImageFaceSwap(plan); err != nil {
		return localexecution.ImageArtifact{}, executionFailure(localexecution.FailureLoad, err)
	}
	release, err := host.lease.acquire(ctx)
	if err != nil {
		return localexecution.ImageArtifact{}, err
	}
	defer release()
	if host.poisoned != nil {
		return localexecution.ImageArtifact{}, executionFailure(localexecution.FailureProcessCrash, host.poisoned)
	}
	if err := ctx.Err(); err != nil {
		return localexecution.ImageArtifact{}, err
	}
	if onStart != nil {
		if err := onStart(); err != nil {
			return localexecution.ImageArtifact{}, err
		}
	}
	if _, err := sealInvocationModelContentContext(ctx, plan.Bindings); err != nil {
		return localexecution.ImageArtifact{}, err
	}
	if err := host.start(ctx, plan.Models()); err != nil {
		return localexecution.ImageArtifact{}, host.fail(ctx, executionFailure(localexecution.FailureLoad, err))
	}
	bindings := map[string]string{}
	for _, binding := range plan.Bindings {
		bindings[binding.RequirementID] = binding.AbsolutePath
	}
	body, err := json.Marshal(struct {
		Reference []byte            `json:"reference"`
		Target    []byte            `json:"target"`
		Bindings  map[string]string `json:"bindings"`
	}{plan.ReferenceImage, plan.TargetImage, bindings})
	if err != nil {
		return localexecution.ImageArtifact{}, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, host.endpoint+"/v1/image/face-swap", bytes.NewReader(body))
	if err != nil {
		return localexecution.ImageArtifact{}, err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("x-nimi-face-swap-token", host.token)
	response, err := (&http.Client{}).Do(request)
	if err != nil {
		return localexecution.ImageArtifact{}, host.fail(ctx, executionFailure(localexecution.FailureProcessCrash, err))
	}
	defer func() { _ = response.Body.Close() }()
	payload, err := io.ReadAll(io.LimitReader(response.Body, maxFaceSwapResponseBytes+1))
	if err != nil || len(payload) > maxFaceSwapResponseBytes {
		if err == nil {
			err = fmt.Errorf("face replacement response exceeds its bound")
		}
		return localexecution.ImageArtifact{}, host.fail(ctx, err)
	}
	if response.StatusCode != http.StatusOK {
		var failure struct {
			Reason string `json:"reason_code"`
			Detail string `json:"detail"`
		}
		if json.Unmarshal(payload, &failure) != nil {
			return localexecution.ImageArtifact{}, host.fail(ctx, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID))
		}
		reason := faceSwapWorkerReason(failure.Reason)
		code := codes.Internal
		if reason == runtimev1.ReasonCode_AI_FACE_REFERENCE_MISSING || reason == runtimev1.ReasonCode_AI_FACE_REFERENCE_AMBIGUOUS || reason == runtimev1.ReasonCode_AI_FACE_TARGET_MISSING || reason == runtimev1.ReasonCode_AI_FACE_TARGET_AMBIGUOUS || reason == runtimev1.ReasonCode_AI_INPUT_INVALID {
			code = codes.InvalidArgument
		}
		return localexecution.ImageArtifact{}, host.fail(ctx, grpcerr.WithReasonCodeOptions(code, reason, grpcerr.ReasonOptions{Message: failure.Detail}))
	}
	var result struct {
		Image  []byte `json:"image"`
		Width  uint32 `json:"width"`
		Height uint32 `json:"height"`
	}
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&result); err != nil {
		return localexecution.ImageArtifact{}, host.fail(ctx, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, err, grpcerr.ReasonOptions{}))
	}
	width, height, err := localexecution.FaceSwapImageSize(plan.TargetImage)
	if err != nil {
		return localexecution.ImageArtifact{}, host.fail(ctx, err)
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(result.Image))
	if err != nil || format != "png" || result.Width != width || result.Height != height || config.Width != int(width) || config.Height != int(height) {
		return localexecution.ImageArtifact{}, host.fail(ctx, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID))
	}
	if err := ctx.Err(); err != nil {
		return localexecution.ImageArtifact{}, host.fail(ctx, err)
	}
	return localexecution.ImageArtifact{Index: 1, Bytes: result.Image, MediaType: "image/png"}, nil
}

func faceSwapWorkerReason(value string) runtimev1.ReasonCode {
	switch value {
	case "AI_FACE_REFERENCE_MISSING":
		return runtimev1.ReasonCode_AI_FACE_REFERENCE_MISSING
	case "AI_FACE_REFERENCE_AMBIGUOUS":
		return runtimev1.ReasonCode_AI_FACE_REFERENCE_AMBIGUOUS
	case "AI_FACE_TARGET_MISSING":
		return runtimev1.ReasonCode_AI_FACE_TARGET_MISSING
	case "AI_FACE_TARGET_AMBIGUOUS":
		return runtimev1.ReasonCode_AI_FACE_TARGET_AMBIGUOUS
	case "AI_INPUT_INVALID":
		return runtimev1.ReasonCode_AI_INPUT_INVALID
	case "AI_MEDIA_OPTION_UNSUPPORTED":
		return runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED
	case "AI_LOCAL_EXECUTION_LOAD_FAILED":
		return runtimev1.ReasonCode_AI_LOCAL_EXECUTION_LOAD_FAILED
	case "AI_OUTPUT_INVALID":
		return runtimev1.ReasonCode_AI_OUTPUT_INVALID
	case "AI_VIDEO_DECODE_FAILED":
		return runtimev1.ReasonCode_AI_VIDEO_DECODE_FAILED
	case "AI_VIDEO_ENCODE_FAILED":
		return runtimev1.ReasonCode_AI_VIDEO_ENCODE_FAILED
	case "AI_REALTIME_SESSION_CLOSED":
		return runtimev1.ReasonCode_AI_REALTIME_SESSION_CLOSED
	default:
		return runtimev1.ReasonCode_AI_LOCAL_EXECUTION_INFERENCE_FAILED
	}
}

func (host *FaceSwapExecutionHost) start(ctx context.Context, plan capabilitydriver.FaceSwapModelPlan) error {
	parts := []string{plan.ProfileRoot, plan.ProfileDigest, plan.DriverBundleDigest}
	for _, binding := range plan.Bindings {
		parts = append(parts, binding.RequirementID, binding.AbsolutePath, binding.VerifiedContentID)
	}
	identity := strings.Join(parts, "\n")
	info, err := host.manager.EngineStatus(engineFaceSwapExecutionHost)
	if err == nil && info.Status == StatusHealthy && info.PID > 0 && identity == host.identity && host.token != "" {
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
	env["NIMI_RUNTIME_FACE_SWAP_TOKEN"] = token
	env["NO_ALBUMENTATIONS_UPDATE"] = "1"
	cfg := EngineConfig{Kind: engineFaceSwapExecutionHost, Port: port, BinaryPath: managedPythonPath(plan.ProfileRoot),
		CommandArgs: []string{filepath.Join(plan.ProfileRoot, "face_swap_server.py"), "--port", strconv.Itoa(port)}, CommandEnv: env, WorkingDir: plan.ProfileRoot, ExecutionHostIdentity: identity,
		HealthMode: HealthModeHTTP, HealthPath: "/health", HealthResponse: capabilitydriver.InsightFaceProtocol,
		StartupTimeout: 30 * time.Second, ShutdownTimeout: 3 * time.Second, ForceTerminationTimeout: 3 * time.Second, HealthInterval: 30 * time.Second, MaxRestarts: 0}
	if err := host.manager.StartEngine(ctx, cfg); err != nil {
		return err
	}
	host.identity, host.endpoint, host.token = identity, cfg.Endpoint(), token
	return nil
}

func (host *FaceSwapExecutionHost) stop() error {
	err := host.manager.StopEngine(engineFaceSwapExecutionHost)
	if err != nil && !errors.Is(err, ErrEngineNotRunning) {
		host.poisoned = fmt.Errorf("stop face replacement Worker before releasing capacity: %w", err)
		return executionFailure(localexecution.FailureProcessCrash, host.poisoned)
	}
	host.identity, host.endpoint, host.token = "", "", ""
	return nil
}

func (host *FaceSwapExecutionHost) fail(ctx context.Context, cause error) error {
	if err := host.stop(); err != nil {
		return err
	}
	if ctx.Err() != nil {
		return executionFailure(localexecution.FailureCanceled, ctx.Err())
	}
	return cause
}
