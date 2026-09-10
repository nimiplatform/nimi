package engine

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"path/filepath"
	"runtime"
	"strconv"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"google.golang.org/grpc/codes"
)

const engineVisionExecutionHost EngineKind = "vision-execution-host"

// The private JSON DTO can expand labels by 6x when escaping, with additional
// geometry/envelope syntax. This is not the public serialized-proto limit.
const maxVisionLocateJSONBytes = 2 * 1024 * 1024

// @nimi-authority: rule.nimi.runtime.local-compute.r117
// VisionExecutionHost owns one supervised resident Worker and serial lease.
// All model/profile inputs come from the captured plan, including on cold start.
type VisionExecutionHost struct {
	manager  *Manager
	lease    speechExecutionLease
	identity string
	endpoint string
	token    string
	poisoned error
}

func NewVisionExecutionHost(manager *Manager) *VisionExecutionHost {
	if manager == nil {
		return nil
	}
	return &VisionExecutionHost{manager: manager}
}

func (host *VisionExecutionHost) ExecuteVisionLocate(ctx context.Context, plan *capabilitydriver.VisionLocateInvocationPlan, onStart func() error) (*runtimev1.VisionLocateResult, error) {
	if host == nil || plan == nil || plan.Request == nil {
		return nil, executionFailure(localexecution.FailureLoad, fmt.Errorf("Locate Host or captured plan is unavailable"))
	}
	release, err := host.lease.acquire(ctx)
	if err != nil {
		return nil, err
	}
	defer release()
	if host.poisoned != nil {
		return nil, executionFailure(localexecution.FailureProcessCrash, host.poisoned)
	}
	if err := ctx.Err(); err != nil {
		return nil, err
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
	geometry := "BOX"
	if plan.Request.Geometry == runtimev1.VisionLocateGeometry_VISION_LOCATE_GEOMETRY_POINT {
		geometry = "POINT"
	}
	body, err := json.Marshal(map[string]any{
		"image_artifact_id": plan.Request.ImageArtifactId, "query": plan.Request.Query, "geometry": geometry,
		"image_base64": base64.StdEncoding.EncodeToString(plan.ImageBytes), "width": plan.Width, "height": plan.Height,
		"model_dir": plan.Binding.BundleDir, "model_content_id": plan.Binding.VerifiedContentID,
		"profile_digest": plan.ProfileDigest, "backend": plan.Backend,
	})
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, host.endpoint+"/v1/vision/locate", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-nimi-vision-token", host.token)
	response, err := (&http.Client{}).Do(req)
	if err != nil {
		return nil, host.fail(ctx, err)
	}
	defer func() { _ = response.Body.Close() }()
	payload, err := readVisionLocateResponse(response.Body)
	if err != nil {
		return nil, host.fail(ctx, err)
	}
	if response.StatusCode != http.StatusOK {
		var failure struct {
			ReasonCode string `json:"reason_code"`
			Detail     string `json:"detail"`
		}
		if json.Unmarshal(payload, &failure) != nil {
			return nil, host.fail(ctx, visionOutputError(fmt.Errorf("Locate Worker returned an invalid failure")))
		}
		reason := runtimev1.ReasonCode_AI_LOCAL_EXECUTION_INFERENCE_FAILED
		switch failure.ReasonCode {
		case "AI_OUTPUT_INVALID":
			reason = runtimev1.ReasonCode_AI_OUTPUT_INVALID
		case "AI_INPUT_INVALID":
			reason = runtimev1.ReasonCode_AI_INPUT_INVALID
		case "AI_LOCAL_EXECUTION_LOAD_FAILED":
			reason = runtimev1.ReasonCode_AI_LOCAL_EXECUTION_LOAD_FAILED
		}
		return nil, host.fail(ctx, grpcerr.WithReasonCodeOptions(codes.Internal, reason, grpcerr.ReasonOptions{Message: failure.Detail}))
	}
	result, err := decodeVisionLocateResponse(payload, plan)
	if err != nil {
		return nil, host.fail(ctx, visionOutputError(err))
	}
	if err := ctx.Err(); err != nil {
		return nil, host.fail(ctx, err)
	}
	return result, nil
}

func visionOutputError(err error) error {
	return grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, err, grpcerr.ReasonOptions{Message: err.Error()})
}

func readVisionLocateResponse(body io.Reader) ([]byte, error) {
	payload, err := io.ReadAll(io.LimitReader(body, maxVisionLocateJSONBytes+1))
	if err != nil {
		return nil, err
	}
	if len(payload) > maxVisionLocateJSONBytes {
		return nil, visionOutputError(fmt.Errorf("Locate Worker response exceeds its private JSON transport bound"))
	}
	return payload, nil
}

func (host *VisionExecutionHost) start(ctx context.Context, plan *capabilitydriver.VisionLocateInvocationPlan) error {
	manifest, err := ReadPythonDependencyProfileManifest(plan.ProfileRoot)
	if err != nil {
		return executionFailure(localexecution.FailureLoad, err)
	}
	profile := manifest.Identity
	backend, err := visionPythonBackend(profile.PlatformTuple, profile.AcceleratorPlane)
	if err != nil || profile.PlatformTuple != runtime.GOOS+"/"+runtime.GOARCH || backend != plan.Backend || manifest.ValidationConsumer != VisionLocateConsumerID ||
		profile.ProfileDigest != plan.ProfileDigest || profile.DriverBundleDigest != plan.DriverBundleDigest || profile.DriverProtocol != plan.DriverProtocol {
		return executionFailure(localexecution.FailureLoad, fmt.Errorf("captured Locate profile does not match the Worker"))
	}
	if err := VerifyPythonDependencyProfileStaticContent(plan.ProfileRoot, VisionLocateConsumerID, profile); err != nil {
		return err
	}
	identity := plan.ProfileRoot + "\n" + plan.ProfileDigest + "\n" + plan.DriverBundleDigest + "\n" + plan.DriverProtocol + "\n" + plan.Backend + "\n" + plan.Binding.BundleDir + "\n" + plan.Binding.VerifiedContentID
	info, statusErr := host.manager.EngineStatus(engineVisionExecutionHost)
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
	env["NIMI_RUNTIME_VISION_ADMISSION_TOKEN"] = token
	env["HF_HUB_OFFLINE"] = "1"
	env["TRANSFORMERS_OFFLINE"] = "1"
	cfg := EngineConfig{
		Kind: engineVisionExecutionHost, Port: port, BinaryPath: managedPythonPath(plan.ProfileRoot),
		CommandArgs: []string{filepath.Join(plan.ProfileRoot, "vision_server.py"), "--port", strconv.Itoa(port)},
		CommandEnv:  env, WorkingDir: plan.ProfileRoot, ExecutionHostIdentity: identity,
		HealthMode: HealthModeHTTP, HealthPath: "/health", HealthResponse: visionDriverProtocolVersion,
		StartupTimeout: 60 * time.Second, HealthInterval: 30 * time.Second, ShutdownTimeout: 3 * time.Second, MaxRestarts: 0,
	}
	if err := host.manager.StartEngine(ctx, cfg); err != nil {
		return err
	}
	host.identity, host.token, host.endpoint = identity, token, cfg.Endpoint()
	return nil
}

func (host *VisionExecutionHost) stop() error {
	err := host.manager.StopEngine(engineVisionExecutionHost)
	if err != nil && !errors.Is(err, ErrEngineNotRunning) {
		host.poisoned = fmt.Errorf("stop Locate Worker before releasing its lease: %w", err)
		return executionFailure(localexecution.FailureProcessCrash, host.poisoned)
	}
	host.identity, host.token, host.endpoint = "", "", ""
	return nil
}

func (host *VisionExecutionHost) fail(ctx context.Context, cause error) error {
	if err := host.stop(); err != nil {
		return err
	}
	if ctx.Err() != nil {
		return executionFailure(localexecution.FailureCanceled, ctx.Err())
	}
	return executionFailure(localexecution.FailureInference, cause)
}

func decodeVisionLocateResponse(payload []byte, plan *capabilitydriver.VisionLocateInvocationPlan) (*runtimev1.VisionLocateResult, error) {
	var wire struct {
		ImageArtifactID string `json:"image_artifact_id"`
		Width           uint32 `json:"width"`
		Height          uint32 `json:"height"`
		Locations       *[]struct {
			Label *string   `json:"label"`
			Box   []float64 `json:"box"`
			Point []float64 `json:"point"`
		} `json:"locations"`
	}
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&wire); err != nil {
		return nil, err
	}
	if wire.Locations == nil {
		return nil, fmt.Errorf("Locate Worker omitted its typed locations")
	}
	var trailing any
	if !errors.Is(decoder.Decode(&trailing), io.EOF) {
		return nil, fmt.Errorf("Locate Worker returned trailing output")
	}
	result := &runtimev1.VisionLocateResult{ImageArtifactId: wire.ImageArtifactID, Width: wire.Width, Height: wire.Height, Locations: make([]*runtimev1.VisionLocation, 0, len(*wire.Locations))}
	for _, item := range *wire.Locations {
		location := &runtimev1.VisionLocation{Label: item.Label}
		if len(item.Box) == 4 && item.Point == nil {
			location.Geometry = &runtimev1.VisionLocation_Box{Box: &runtimev1.VisionLocateBox{X1: item.Box[0], Y1: item.Box[1], X2: item.Box[2], Y2: item.Box[3]}}
		} else if len(item.Point) == 2 && item.Box == nil {
			location.Geometry = &runtimev1.VisionLocation_Point{Point: &runtimev1.VisionLocatePoint{X: item.Point[0], Y: item.Point[1]}}
		} else {
			return nil, fmt.Errorf("Locate Worker returned an invalid geometry")
		}
		result.Locations = append(result.Locations, location)
	}
	if err := localexecution.ValidateVisionLocateResult(result, plan.Request, plan.Width, plan.Height); err != nil {
		return nil, err
	}
	return result, nil
}
