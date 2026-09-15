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
	"net"
	"net/http"
	"path/filepath"
	"runtime"
	"strconv"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"google.golang.org/protobuf/encoding/protojson"
)

const engineTextAnnotationHost EngineKind = "text-annotation-host"

// @nimi-authority: rule.nimi.runtime.ai-provider.spacy-local-annotation
type TextAnnotationExecutionHost struct {
	manager  *Manager
	lease    speechExecutionLease
	identity string
	endpoint string
	token    string
	poisoned error
}

func NewTextAnnotationExecutionHost(manager *Manager) *TextAnnotationExecutionHost {
	if manager == nil {
		return nil
	}
	return &TextAnnotationExecutionHost{manager: manager}
}

func (host *TextAnnotationExecutionHost) ExecuteTextAnnotation(ctx context.Context, plan *capabilitydriver.TextAnnotationInvocationPlan, onStart func() error) (*runtimev1.TextAnnotationResult, error) {
	if host == nil || plan == nil || plan.Request == nil {
		return nil, executionFailure(localexecution.FailureLoad, fmt.Errorf("annotation Host or captured plan is unavailable"))
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
	if err := localexecution.ValidateTextAnnotationSpec(plan.Request); err != nil {
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
	body, err := json.Marshal(map[string]any{
		"language": plan.Request.Language, "texts": plan.Request.Texts,
		"model_dir": plan.Binding.BundleDir, "model_content_id": plan.Binding.VerifiedContentID,
	})
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, host.endpoint+"/v1/text/annotate", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-nimi-nlp-token", host.token)
	response, err := (&http.Client{}).Do(req)
	if err != nil {
		return nil, host.fail(ctx, err)
	}
	defer response.Body.Close()
	payload, err := io.ReadAll(io.LimitReader(response.Body, localexecution.MaxTextAnnotationResultBytes+1))
	if err != nil || len(payload) > localexecution.MaxTextAnnotationResultBytes {
		return nil, host.fail(ctx, fmt.Errorf("annotation Worker response is unreadable or oversized"))
	}
	if response.StatusCode != http.StatusOK {
		var failure struct {
			ReasonCode string `json:"reason_code"`
			Detail     string `json:"detail"`
		}
		if json.Unmarshal(payload, &failure) != nil {
			return nil, host.fail(ctx, fmt.Errorf("annotation Worker returned an invalid failure"))
		}
		return nil, host.fail(ctx, fmt.Errorf("annotation Worker: %s: %s", failure.ReasonCode, failure.Detail))
	}
	result := &runtimev1.TextAnnotationResult{}
	if err := (protojson.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(payload, result); err != nil {
		return nil, host.fail(ctx, err)
	}
	if err := localexecution.ValidateTextAnnotationResult(result, plan.Request); err != nil {
		return nil, host.fail(ctx, err)
	}
	if err := ctx.Err(); err != nil {
		return nil, host.fail(ctx, err)
	}
	return result, nil
}

func (host *TextAnnotationExecutionHost) start(ctx context.Context, plan *capabilitydriver.TextAnnotationInvocationPlan) error {
	manifest, err := ReadPythonDependencyProfileManifest(plan.ProfileRoot)
	if err != nil {
		return executionFailure(localexecution.FailureLoad, err)
	}
	profile := manifest.Identity
	if profile.PlatformTuple != runtime.GOOS+"/"+runtime.GOARCH || profile.AcceleratorPlane != "cpu" || manifest.ValidationConsumer != TextAnnotationConsumerID ||
		profile.ProfileDigest != plan.ProfileDigest || profile.DriverBundleDigest != plan.DriverBundleDigest || profile.DriverProtocol != plan.DriverProtocol {
		return executionFailure(localexecution.FailureLoad, fmt.Errorf("captured annotation profile does not match the Worker"))
	}
	if err := VerifyPythonDependencyProfileStaticContent(plan.ProfileRoot, TextAnnotationConsumerID, profile); err != nil {
		return err
	}
	identity := plan.ProfileRoot + "\n" + plan.ProfileDigest + "\n" + plan.DriverBundleDigest + "\n" + plan.DriverProtocol + "\n" + plan.Binding.BundleDir + "\n" + plan.Binding.VerifiedContentID
	info, statusErr := host.manager.EngineStatus(engineTextAnnotationHost)
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
	env["NIMI_RUNTIME_NLP_ADMISSION_TOKEN"] = token
	cfg := EngineConfig{
		Kind: engineTextAnnotationHost, Port: port, BinaryPath: managedPythonPath(plan.ProfileRoot),
		CommandArgs: []string{filepath.Join(plan.ProfileRoot, "text_annotation_server.py"), "--port", strconv.Itoa(port)},
		CommandEnv:  env, WorkingDir: plan.ProfileRoot, ExecutionHostIdentity: identity,
		HealthMode: HealthModeHTTP, HealthPath: "/health", HealthResponse: capabilitydriver.SpacyProtocol,
		StartupTimeout: 60 * time.Second, HealthInterval: 30 * time.Second, ShutdownTimeout: 3 * time.Second, MaxRestarts: 0,
	}
	if err := host.manager.StartEngine(ctx, cfg); err != nil {
		return err
	}
	host.identity, host.token, host.endpoint = identity, token, cfg.Endpoint()
	return nil
}

func (host *TextAnnotationExecutionHost) stop() error {
	err := host.manager.StopEngine(engineTextAnnotationHost)
	if err != nil && !errors.Is(err, ErrEngineNotRunning) {
		host.poisoned = fmt.Errorf("stop annotation Worker before releasing its lease: %w", err)
		return executionFailure(localexecution.FailureProcessCrash, host.poisoned)
	}
	host.identity, host.token, host.endpoint = "", "", ""
	return nil
}

func (host *TextAnnotationExecutionHost) fail(ctx context.Context, cause error) error {
	if err := host.stop(); err != nil {
		return err
	}
	if ctx.Err() != nil {
		return executionFailure(localexecution.FailureCanceled, ctx.Err())
	}
	return executionFailure(localexecution.FailureInference, cause)
}
