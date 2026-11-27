package engine

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/nimiplatform/nimi/runtime/internal/aitelemetry"
	"io"
	"log/slog"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"github.com/nimiplatform/nimi/runtime/internal/modelassetintegrity"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
)

const maxLlamaInvocationErrorBody = 64 << 10

type llamaInvocationSubstrate interface {
	Ensure(context.Context, string, []string, func(context.Context) error, localexecution.TextProgressFunc) (string, bool, error)
	Healthy() bool
	// AccessKey is the current worker's private key; empty when none runs.
	AccessKey() string
}

type llamaInvocationEnsureRequest struct {
	processKey                string
	processArgs               []string
	modelFiles                []capabilitydriver.InvocationExactBinding
	allowWarmModelContentSkip bool
	validateDependencies      func() error
	validateModelContent      func(context.Context) error
}

type llamaLoadBoundarySubstrate interface {
	EnsureInvocation(context.Context, llamaInvocationEnsureRequest, localexecution.TextProgressFunc) (string, bool, error)
}

// authorizeLlamaRequest presents the running worker's private key; without it
// llama-server refuses every inference request (only its health and model
// listing stay open).
func authorizeLlamaRequest(request *http.Request, substrate llamaInvocationSubstrate) {
	if key := substrate.AccessKey(); key != "" {
		request.Header.Set("Authorization", "Bearer "+key)
	}
}

// ExecutionHost owns llama-server process and HTTP substrate execution. It
// never resolves a model, companion, portable option, request route, or
// selection: those semantics arrive flattened in the captured Driver plan.
type ExecutionHost struct {
	residentModelAssets
	logger    *slog.Logger
	substrate llamaInvocationSubstrate
	client    *http.Client

	// One llama worker can load one captured process plan at a time. Holding the
	// lease through inference prevents a later job from swapping the process
	// underneath an earlier captured job. The channel makes queued acquisition
	// cancelable without stopping the reusable resident worker.
	lease chan struct{}
	// idle releases the worker after its last request; Runtime-private.
	idle residentIdleRelease
	// modelContentValidator optionally wraps validateInvocationModelContentContext
	// in package tests without global mutable state.
	modelContentValidator func(context.Context, []capabilitydriver.InvocationExactBinding) error
}

func newExecutionLease() chan struct{} {
	lease := make(chan struct{}, 1)
	lease <- struct{}{}
	return lease
}

func NewExecutionHost(manager *Manager, logger *slog.Logger) *ExecutionHost {
	if logger == nil {
		logger = slog.Default()
	}
	return &ExecutionHost{
		logger:    logger,
		substrate: newManagerLlamaInvocationSubstrate(manager),
		client:    &http.Client{},
		lease:     newExecutionLease(),
	}
}

// NewExecutionHostWithLlamaConfig constructs a Host with explicit supervised
// llama process settings. Driver-owned command arguments still replace
// CommandArgs for every captured plan; this constructor only configures Host
// facts such as managed package version, loopback port, and lifecycle timeouts.
func NewExecutionHostWithLlamaConfig(manager *Manager, logger *slog.Logger, config EngineConfig) (*ExecutionHost, error) {
	if manager == nil {
		return nil, fmt.Errorf("llama execution host manager is required")
	}
	if config.Kind != EngineLlama {
		return nil, fmt.Errorf("llama execution host config kind must be %q", EngineLlama)
	}
	if config.Port <= 0 || config.Port > 65535 {
		return nil, fmt.Errorf("llama execution host port must be between 1 and 65535")
	}
	if strings.TrimSpace(config.Version) == "" {
		return nil, fmt.Errorf("llama execution host version is required")
	}
	config.Version = strings.TrimSpace(config.Version)
	if logger == nil {
		logger = slog.Default()
	}
	return &ExecutionHost{
		logger:    logger,
		substrate: newManagerLlamaInvocationSubstrateWithConfig(manager, config),
		client:    &http.Client{},
		lease:     newExecutionLease(),
	}, nil
}

func newExecutionHostWithSubstrate(substrate llamaInvocationSubstrate, client *http.Client) *ExecutionHost {
	if client == nil {
		client = &http.Client{}
	}
	return &ExecutionHost{logger: slog.Default(), substrate: substrate, client: client, lease: newExecutionLease()}
}

func (h *ExecutionHost) ExecuteText(
	ctx context.Context,
	plan *capabilitydriver.TextInvocationPlan,
	progress localexecution.TextProgressFunc,
) (localexecution.TextResult, error) {
	if plan == nil || plan.Stream() {
		return localexecution.TextResult{}, executionFailure(localexecution.FailureInference, fmt.Errorf("invalid non-stream llama invocation plan"))
	}
	return h.execute(ctx, plan, nil, progress)
}

func (h *ExecutionHost) StreamText(
	ctx context.Context,
	plan *capabilitydriver.TextInvocationPlan,
	onDelta func(localexecution.TextDelta) error,
	progress localexecution.TextProgressFunc,
) (localexecution.TextResult, error) {
	if plan == nil || !plan.Stream() || onDelta == nil {
		return localexecution.TextResult{}, executionFailure(localexecution.FailureInference, fmt.Errorf("invalid streaming llama invocation plan"))
	}
	return h.execute(ctx, plan, onDelta, progress)
}

func (h *ExecutionHost) ExecuteEmbed(
	ctx context.Context,
	plan *capabilitydriver.EmbedInvocationPlan,
	progress localexecution.TextProgressFunc,
) (result localexecution.EmbedResult, executionErr error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if h == nil || h.substrate == nil || h.client == nil {
		return localexecution.EmbedResult{}, executionFailure(localexecution.FailureLoad, fmt.Errorf("llama embedding execution host is unavailable"))
	}
	if plan == nil || plan.ProcessKey() == "" || len(plan.ProcessArgs()) == 0 ||
		plan.RequestPath() == "" || len(plan.RequestBody()) == 0 || plan.ExpectedCount() <= 0 {
		return localexecution.EmbedResult{}, executionFailure(localexecution.FailureInference, fmt.Errorf("llama embedding invocation plan is incomplete"))
	}

	queuedAt := time.Now()
	select {
	case <-ctx.Done():
		return localexecution.EmbedResult{}, executionFailure(localexecution.FailureCanceled, ctx.Err())
	case <-h.lease:
	}
	acquiredAt := time.Now()
	defer func() { h.lease <- struct{}{}; h.residentModelAssets.notifyIdle(); h.armIdleRelease() }()
	modelFiles := plan.ModelFiles()
	dependencySources := plan.DependencySources()
	h.residentModelAssets.capture(modelFiles)

	endpoint, resident, err := h.ensureSubstrateInvocation(ctx, llamaInvocationEnsureRequest{
		processKey:                plan.ProcessKey(),
		processArgs:               plan.ProcessArgs(),
		modelFiles:                modelFiles,
		allowWarmModelContentSkip: false,
		validateDependencies: func() error {
			return validateInvocationDependencySources(h.substrate, dependencySources)
		},
		validateModelContent: func(validationCtx context.Context) error {
			return h.validateInvocationModelContent(validationCtx, modelFiles)
		},
	}, progress)
	h.logger.Info("llama invocation preparation", "capability", "text.embed", "lease_wait_us", acquiredAt.Sub(queuedAt).Microseconds(), "prepare_ms", time.Since(acquiredAt).Milliseconds(), "resident", resident, "ready", err == nil)
	if err != nil {
		h.logger.Warn("llama invocation load failed",
			"event", "engine.llama.invocation_load_failed",
			"detail", boundedExecutionDiagnostic(err),
		)
		if ctx.Err() != nil {
			return localexecution.EmbedResult{}, executionFailure(localexecution.FailureCanceled, ctx.Err())
		}
		if localexecution.FailureKindOf(err) == localexecution.FailureContentMismatch {
			return localexecution.EmbedResult{}, err
		}
		return localexecution.EmbedResult{}, classifiedExecutionFailure(localexecution.FailureLoad, fmt.Errorf("load llama embedding process: %w", err), executionFailureDiagnostic(h.substrate))
	}
	requestURL := strings.TrimRight(strings.TrimSpace(endpoint), "/") + "/" + strings.TrimLeft(plan.RequestPath(), "/")
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, requestURL, bytes.NewReader(plan.RequestBody()))
	if err != nil {
		return localexecution.EmbedResult{}, executionFailure(localexecution.FailureInference, fmt.Errorf("create llama embedding request: %w", err))
	}
	request.Header.Set("Content-Type", "application/json")
	authorizeLlamaRequest(request, h.substrate)
	attempt := aitelemetry.Begin(ctx)
	defer func() {
		if result.InputTokens != 0 || result.ComputeMS != 0 {
			attempt.Finish(&runtimev1.UsageStats{InputTokens: result.InputTokens, ComputeMs: result.ComputeMS})
		} else {
			attempt.Finish(nil)
		}
	}()
	response, err := h.client.Do(request)
	if err != nil {
		return localexecution.EmbedResult{}, h.embedInferenceFailure(ctx, err)
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		body, _ := io.ReadAll(io.LimitReader(response.Body, maxLlamaInvocationErrorBody))
		return localexecution.EmbedResult{}, h.embedInferenceFailure(ctx, fmt.Errorf("llama embedding HTTP %d: %s", response.StatusCode, strings.TrimSpace(string(body))))
	}
	var payload struct {
		Data []struct {
			Index     int       `json:"index"`
			Embedding []float64 `json:"embedding"`
		} `json:"data"`
		Usage struct {
			PromptTokens int64 `json:"prompt_tokens"`
		} `json:"usage"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return localexecution.EmbedResult{}, h.embedInferenceFailure(ctx, fmt.Errorf("decode llama embedding response: %w", err))
	}
	if len(payload.Data) != plan.ExpectedCount() {
		return localexecution.EmbedResult{}, h.embedInferenceFailure(ctx, fmt.Errorf("llama embedding response count %d does not match request %d", len(payload.Data), plan.ExpectedCount()))
	}
	vectors := make([]*runtimev1.EmbeddingVector, plan.ExpectedCount())
	dimension := 0
	for _, item := range payload.Data {
		if item.Index < 0 || item.Index >= len(vectors) || vectors[item.Index] != nil || len(item.Embedding) == 0 {
			return localexecution.EmbedResult{}, h.embedInferenceFailure(ctx, fmt.Errorf("llama embedding response index or vector is invalid"))
		}
		if dimension == 0 {
			dimension = len(item.Embedding)
		} else if len(item.Embedding) != dimension {
			return localexecution.EmbedResult{}, h.embedInferenceFailure(ctx, fmt.Errorf("llama embedding response dimensions are inconsistent"))
		}
		values := append([]float64(nil), item.Embedding...)
		for _, value := range values {
			if math.IsNaN(value) || math.IsInf(value, 0) {
				return localexecution.EmbedResult{}, h.embedInferenceFailure(ctx, fmt.Errorf("llama embedding response contains a non-finite value"))
			}
		}
		vectors[item.Index] = &runtimev1.EmbeddingVector{Values: values}
	}
	return localexecution.EmbedResult{Vectors: vectors, InputTokens: payload.Usage.PromptTokens}, nil
}

func (h *ExecutionHost) embedInferenceFailure(ctx context.Context, err error) error {
	if ctx != nil && ctx.Err() != nil {
		return executionFailure(localexecution.FailureCanceled, ctx.Err())
	}
	return classifiedExecutionFailure(localexecution.FailureInference, err, executionFailureDiagnostic(h.substrate))
}

func (h *ExecutionHost) execute(
	ctx context.Context,
	plan *capabilitydriver.TextInvocationPlan,
	onDelta func(localexecution.TextDelta) error,
	progress localexecution.TextProgressFunc,
) (result localexecution.TextResult, executionErr error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if h == nil || h.substrate == nil || h.client == nil {
		return localexecution.TextResult{}, executionFailure(localexecution.FailureLoad, fmt.Errorf("llama execution host is unavailable"))
	}
	if plan.ProcessKey() == "" || len(plan.ProcessArgs()) == 0 || plan.RequestPath() == "" ||
		plan.RequestContentType() == "" || len(plan.RequestBody()) == 0 {
		return localexecution.TextResult{}, executionFailure(localexecution.FailureInference, fmt.Errorf("llama invocation plan is incomplete"))
	}

	queuedAt := time.Now()
	select {
	case <-ctx.Done():
		return localexecution.TextResult{}, executionFailure(localexecution.FailureCanceled, ctx.Err())
	case <-h.lease:
	}
	acquiredAt := time.Now()
	defer func() { h.lease <- struct{}{}; h.residentModelAssets.notifyIdle(); h.armIdleRelease() }()
	modelFiles := plan.ModelFiles()
	dependencySources := plan.DependencySources()
	h.residentModelAssets.capture(modelFiles)

	endpoint, resident, err := h.ensureSubstrateInvocation(ctx, llamaInvocationEnsureRequest{
		processKey:                plan.ProcessKey(),
		processArgs:               plan.ProcessArgs(),
		modelFiles:                modelFiles,
		allowWarmModelContentSkip: true,
		validateDependencies: func() error {
			return validateInvocationDependencySources(h.substrate, dependencySources)
		},
		validateModelContent: func(validationCtx context.Context) error {
			return h.validateInvocationModelContent(validationCtx, modelFiles)
		},
	}, progress)
	h.logger.Info("llama invocation preparation", "capability", "text.generate", "lease_wait_us", acquiredAt.Sub(queuedAt).Microseconds(), "prepare_ms", time.Since(acquiredAt).Milliseconds(), "resident", resident, "ready", err == nil)
	if err != nil {
		if ctx.Err() != nil {
			return localexecution.TextResult{}, executionFailure(localexecution.FailureCanceled, ctx.Err())
		}
		if localexecution.FailureKindOf(err) == localexecution.FailureContentMismatch {
			return localexecution.TextResult{}, err
		}
		return localexecution.TextResult{}, classifiedExecutionFailure(localexecution.FailureLoad, fmt.Errorf("load llama invocation process: %w", err), executionFailureDiagnostic(h.substrate))
	}
	requestURL := strings.TrimRight(strings.TrimSpace(endpoint), "/") + "/" + strings.TrimLeft(plan.RequestPath(), "/")
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, requestURL, bytes.NewReader(plan.RequestBody()))
	if err != nil {
		return localexecution.TextResult{}, executionFailure(localexecution.FailureInference, fmt.Errorf("create llama inference request: %w", err))
	}
	request.Header.Set("Content-Type", plan.RequestContentType())
	authorizeLlamaRequest(request, h.substrate)
	if plan.Stream() {
		request.Header.Set("Accept", "text/event-stream")
	}
	attempt := aitelemetry.Begin(ctx)
	defer func() { attempt.Finish(result.MeasuredUsage()) }()
	response, err := h.client.Do(request)
	if err != nil {
		return localexecution.TextResult{}, h.inferenceFailure(ctx, err)
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		body, _ := io.ReadAll(io.LimitReader(response.Body, maxLlamaInvocationErrorBody))
		if limit := llamaContextLimitFailure(response.StatusCode, body); limit != nil {
			return localexecution.TextResult{}, limit
		}
		return localexecution.TextResult{}, h.inferenceFailure(ctx, fmt.Errorf("llama inference HTTP %d: %s", response.StatusCode, strings.TrimSpace(string(body))))
	}
	if plan.BehaviorAdapterCapture() != nil {
		if plan.Stream() {
			return h.consumeTextBehaviorStream(ctx, plan, response.Body, onDelta)
		}
		return h.consumeTextBehaviorResponse(ctx, plan, response.Body)
	}
	if plan.Stream() {
		return h.consumeStream(ctx, response.Body, onDelta)
	}
	return h.consumeResponse(ctx, response.Body)
}

func (h *ExecutionHost) ensureSubstrateInvocation(
	ctx context.Context,
	req llamaInvocationEnsureRequest,
	progress localexecution.TextProgressFunc,
) (string, bool, error) {
	if loadBoundary, ok := h.substrate.(llamaLoadBoundarySubstrate); ok {
		return loadBoundary.EnsureInvocation(ctx, req, progress)
	}
	return h.substrate.Ensure(ctx, req.processKey, req.processArgs, func(validationCtx context.Context) error {
		if req.validateDependencies != nil {
			if err := req.validateDependencies(); err != nil {
				return err
			}
		}
		if req.validateModelContent != nil {
			return req.validateModelContent(validationCtx)
		}
		return nil
	}, progress)
}

func (h *ExecutionHost) validateInvocationModelContent(ctx context.Context, files []capabilitydriver.InvocationExactBinding) error {
	if h != nil && h.modelContentValidator != nil {
		return h.modelContentValidator(ctx, files)
	}
	return validateInvocationModelContentContext(ctx, files)
}

func validateInvocationModelContentContext(ctx context.Context, files []capabilitydriver.InvocationExactBinding) error {
	_, err := sealInvocationModelContentContext(ctx, files)
	return err
}

type invocationModelContentSeal struct {
	declaredFileSHA256 map[string]string
}

// sealInvocationModelContentContext re-hashes the complete captured
// ModelAsset distribution immediately before an ExecutionHost may consume its
// paths. EntrySHA256 protects the selected entry while VerifiedContentID seals
// every declared file in manifest order.
func sealInvocationModelContentContext(ctx context.Context, bindings []capabilitydriver.InvocationExactBinding) ([]invocationModelContentSeal, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if len(bindings) == 0 {
		return nil, modelContentMismatchFailure(fmt.Errorf("captured local invocation has no model files"))
	}
	seals := make([]invocationModelContentSeal, 0, len(bindings))
	for _, binding := range bindings {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		seal, err := sealInvocationModelBindingContext(ctx, binding)
		if err != nil {
			return nil, err
		}
		seals = append(seals, seal)
	}
	return seals, nil
}

func sealInvocationModelBindingContext(ctx context.Context, binding capabilitydriver.InvocationExactBinding) (invocationModelContentSeal, error) {
	bundleDir := strings.TrimSpace(binding.BundleDir)
	declared := binding.DeclaredFiles
	if bundleDir == "" && len(declared) == 0 {
		digest, err := hashInvocationContentFileContext(ctx, binding.AbsolutePath)
		if err != nil {
			return invocationModelContentSeal{}, err
		}
		if !strings.EqualFold(digest, strings.TrimSpace(binding.EntrySHA256)) ||
			!strings.EqualFold("sha256:"+digest, strings.TrimSpace(binding.VerifiedContentID)) {
			return invocationModelContentSeal{}, modelContentMismatchFailure(fmt.Errorf("captured model content identity changed"))
		}
		return invocationModelContentSeal{declaredFileSHA256: map[string]string{filepath.Base(binding.AbsolutePath): digest}}, nil
	}
	if bundleDir == "" || len(declared) == 0 || !filepath.IsAbs(bundleDir) || filepath.Clean(bundleDir) != bundleDir {
		return invocationModelContentSeal{}, modelContentMismatchFailure(fmt.Errorf("captured model bundle identity is incomplete"))
	}
	bundleInfo, err := os.Lstat(bundleDir)
	if err != nil || !bundleInfo.IsDir() || bundleInfo.Mode()&os.ModeSymlink != 0 {
		if err == nil {
			err = fmt.Errorf("bundle path is not a direct directory")
		}
		return invocationModelContentSeal{}, modelContentMismatchFailure(fmt.Errorf("open captured model bundle: %w", err))
	}
	entryRelative, err := filepath.Rel(bundleDir, strings.TrimSpace(binding.AbsolutePath))
	if err != nil || entryRelative == "." || filepath.IsAbs(entryRelative) || entryRelative == ".." || strings.HasPrefix(entryRelative, ".."+string(filepath.Separator)) {
		return invocationModelContentSeal{}, modelContentMismatchFailure(fmt.Errorf("captured model entry is outside its bundle"))
	}
	entryRelative = filepath.ToSlash(entryRelative)
	contentHasher := sha256.New()
	fileHashes := make(map[string]string, len(declared))
	entryObserved := false
	for _, relative := range declared {
		if err := ctx.Err(); err != nil {
			return invocationModelContentSeal{}, err
		}
		clean := filepath.Clean(filepath.FromSlash(relative))
		if relative == "" || filepath.IsAbs(clean) || clean == "." || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) || filepath.ToSlash(clean) != relative {
			return invocationModelContentSeal{}, modelContentMismatchFailure(fmt.Errorf("captured model bundle has an invalid declared file"))
		}
		if _, exists := fileHashes[relative]; exists {
			return invocationModelContentSeal{}, modelContentMismatchFailure(fmt.Errorf("captured model bundle has duplicate declared files"))
		}
		digest, err := hashInvocationContentFileContext(ctx, filepath.Join(bundleDir, clean))
		if err != nil {
			return invocationModelContentSeal{}, err
		}
		fileHashes[relative] = digest
		decoded, _ := hex.DecodeString(digest)
		_, _ = contentHasher.Write(decoded)
		if relative == entryRelative {
			entryObserved = true
			if !strings.EqualFold(digest, strings.TrimSpace(binding.EntrySHA256)) {
				return invocationModelContentSeal{}, modelContentMismatchFailure(fmt.Errorf("captured model entry content changed"))
			}
		}
	}
	if !entryObserved {
		return invocationModelContentSeal{}, modelContentMismatchFailure(fmt.Errorf("captured model entry is not declared"))
	}
	contentDigest := fileHashes[declared[0]]
	if len(declared) > 1 {
		contentDigest = hex.EncodeToString(contentHasher.Sum(nil))
	}
	if !strings.EqualFold("sha256:"+contentDigest, strings.TrimSpace(binding.VerifiedContentID)) {
		return invocationModelContentSeal{}, modelContentMismatchFailure(fmt.Errorf("captured model bundle content identity changed"))
	}
	if err := modelassetintegrity.ValidateDeclaredPayloadSet(bundleDir, declared); err != nil {
		return invocationModelContentSeal{}, modelContentMismatchFailure(err)
	}
	return invocationModelContentSeal{declaredFileSHA256: fileHashes}, nil
}

func hashInvocationContentFileContext(ctx context.Context, path string) (string, error) {
	if !filepath.IsAbs(path) || filepath.Clean(path) != path {
		return "", modelContentMismatchFailure(fmt.Errorf("captured model path is not canonical and absolute"))
	}
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		if err == nil {
			err = fmt.Errorf("path is not a direct regular file")
		}
		return "", modelContentMismatchFailure(fmt.Errorf("open captured model content: %w", err))
	}
	opened, err := os.Open(path)
	if err != nil {
		return "", modelContentMismatchFailure(fmt.Errorf("open captured model content: %w", err))
	}
	hash := sha256.New()
	buffer := make([]byte, 4*1024*1024)
	for {
		if err := ctx.Err(); err != nil {
			_ = opened.Close()
			return "", err
		}
		read, readErr := opened.Read(buffer)
		if read > 0 {
			_, _ = hash.Write(buffer[:read])
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			_ = opened.Close()
			return "", modelContentMismatchFailure(fmt.Errorf("hash captured model content: %w", readErr))
		}
	}
	if closeErr := opened.Close(); closeErr != nil {
		return "", modelContentMismatchFailure(fmt.Errorf("close captured model content: %w", closeErr))
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func (h *ExecutionHost) consumeResponse(ctx context.Context, body io.Reader) (localexecution.TextResult, error) {
	var payload map[string]any
	decoder := json.NewDecoder(io.LimitReader(body, 16<<20))
	decoder.UseNumber()
	if err := decoder.Decode(&payload); err != nil {
		return localexecution.TextResult{}, h.inferenceFailure(ctx, fmt.Errorf("decode llama inference response: %w", err))
	}
	choices, _ := payload["choices"].([]any)
	if len(choices) == 0 {
		return localexecution.TextResult{}, h.inferenceFailure(ctx, fmt.Errorf("llama inference response has no choices"))
	}
	choice, _ := choices[0].(map[string]any)
	message, _ := choice["message"].(map[string]any)
	finishReason := mapLlamaFinishReason(stringValue(choice["finish_reason"]))
	text := textContent(message["content"])
	if strings.TrimSpace(text) == "" {
		return localexecution.TextResult{}, executionFailure(localexecution.FailureTextOutputIncomplete, fmt.Errorf("llama inference response has no public text"))
	}
	return localexecution.TextResult{
		Text:         text,
		TokenUsage:   capabilitydriver.LlamaTextTokenUsage(payload["usage"]),
		ComputeMS:    capabilitydriver.LlamaTextComputeMS(payload),
		FinishReason: finishReason,
	}, nil
}

func (h *ExecutionHost) consumeTextBehaviorResponse(
	ctx context.Context,
	plan *capabilitydriver.TextInvocationPlan,
	body io.Reader,
) (localexecution.TextResult, error) {
	payload, err := io.ReadAll(io.LimitReader(body, 16<<20))
	if err != nil {
		return localexecution.TextResult{}, h.inferenceFailure(ctx, fmt.Errorf("read llama text behavior response: %w", err))
	}
	normalized, err := plan.ParseTextBehaviorResponse(payload)
	if err != nil {
		return localexecution.TextResult{}, h.textBehaviorInferenceFailure(ctx, err)
	}
	return textBehaviorExecutionResult(normalized), nil
}

func (h *ExecutionHost) consumeTextBehaviorStream(
	ctx context.Context,
	plan *capabilitydriver.TextInvocationPlan,
	body io.Reader,
	onDelta func(localexecution.TextDelta) error,
) (localexecution.TextResult, error) {
	assembler, err := plan.NewTextBehaviorStreamAssembler()
	if err != nil {
		return localexecution.TextResult{}, h.textBehaviorInferenceFailure(ctx, err)
	}
	scanner := bufio.NewScanner(body)
	scanner.Buffer(make([]byte, 0, 64<<10), 1<<20)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, ":") || !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "" {
			continue
		}
		if data == "[DONE]" {
			break
		}
		deltas, appendErr := assembler.Append([]byte(data))
		if appendErr != nil {
			return localexecution.TextResult{}, h.textBehaviorInferenceFailure(ctx, appendErr)
		}
		activityObserver := textbehavior.ToolCallActivityObserverFromContext(ctx)
		for _, delta := range deltas {
			if !delta.HasPublicPayload() {
				if delta.HasToolCallActivity() && activityObserver != nil {
					if err := activityObserver(*delta.ToolCallActivity); err != nil {
						return localexecution.TextResult{}, h.inferenceFailure(ctx, err)
					}
				}
				continue
			}
			value := delta
			if err := onDelta(localexecution.TextDelta{Ordered: &value}); err != nil {
				return localexecution.TextResult{}, h.inferenceFailure(ctx, err)
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return localexecution.TextResult{}, h.inferenceFailure(ctx, fmt.Errorf("read llama text behavior stream: %w", err))
	}
	normalized, err := assembler.Finish()
	if err != nil {
		return localexecution.TextResult{}, h.textBehaviorInferenceFailure(ctx, err)
	}
	return textBehaviorExecutionResult(normalized), nil
}

func textBehaviorExecutionResult(normalized textbehavior.NormalizedResult) localexecution.TextResult {
	result := localexecution.TextResult{
		Items:        textbehavior.CloneOrderedItems(normalized.Items),
		TokenUsage:   normalized.Usage,
		ComputeMS:    normalized.ComputeMS,
		FinishReason: normalized.FinishReason,
	}
	var text strings.Builder
	for _, item := range normalized.Items {
		if item.Kind == textbehavior.OrderedItemText {
			text.WriteString(item.Text)
		}
	}
	result.Text = text.String()
	return result
}

func (h *ExecutionHost) consumeStream(
	ctx context.Context,
	body io.Reader,
	onDelta func(localexecution.TextDelta) error,
) (localexecution.TextResult, error) {
	result := localexecution.TextResult{FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP}
	var output strings.Builder
	scanner := bufio.NewScanner(body)
	scanner.Buffer(make([]byte, 0, 64<<10), 1<<20)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, ":") || !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "" {
			continue
		}
		if data == "[DONE]" {
			break
		}
		var chunk map[string]any
		decoder := json.NewDecoder(strings.NewReader(data))
		decoder.UseNumber()
		if err := decoder.Decode(&chunk); err != nil {
			return localexecution.TextResult{}, h.inferenceFailure(ctx, fmt.Errorf("decode llama stream event: %w", err))
		}
		if decoder.InputOffset() != int64(len(data)) {
			return localexecution.TextResult{}, h.inferenceFailure(ctx, fmt.Errorf("llama stream event has trailing JSON"))
		}
		if usage := capabilitydriver.LlamaTextTokenUsage(chunk["usage"]); usage != nil {
			result.TokenUsage = usage
		}
		if computeMS := capabilitydriver.LlamaTextComputeMS(chunk); computeMS > 0 {
			result.ComputeMS = computeMS
		}
		choices, _ := chunk["choices"].([]any)
		if len(choices) == 0 {
			continue
		}
		choice, _ := choices[0].(map[string]any)
		delta, _ := choice["delta"].(map[string]any)
		text := textContent(delta["content"])
		// Raw reasoning/reasoning_content is engine-private and never crosses the
		// base llama v1 execution seam. Only an exact adapter may publish a
		// normalized summary item.
		if text != "" {
			if err := onDelta(localexecution.TextDelta{Text: text}); err != nil {
				return localexecution.TextResult{}, h.inferenceFailure(ctx, err)
			}
			output.WriteString(text)
		}
		if finish := stringValue(choice["finish_reason"]); finish != "" {
			result.FinishReason = mapLlamaFinishReason(finish)
		}
	}
	if err := scanner.Err(); err != nil {
		return localexecution.TextResult{}, h.inferenceFailure(ctx, fmt.Errorf("read llama stream: %w", err))
	}
	result.Text = output.String()
	if strings.TrimSpace(result.Text) == "" {
		return localexecution.TextResult{}, executionFailure(localexecution.FailureTextOutputIncomplete, fmt.Errorf("llama stream completed without public text"))
	}
	return result, nil
}

func (h *ExecutionHost) inferenceFailure(ctx context.Context, err error) error {
	if ctx != nil && ctx.Err() != nil {
		return executionFailure(localexecution.FailureCanceled, ctx.Err())
	}
	diagnostic := executionFailureDiagnostic(h.substrate)
	if executionOutOfMemory(err, diagnostic) {
		return executionFailure(localexecution.FailureOutOfMemory, err)
	}
	if h != nil && h.substrate != nil && !h.substrate.Healthy() {
		return executionFailure(localexecution.FailureProcessCrash, err)
	}
	return executionFailure(localexecution.FailureInference, err)
}

func (h *ExecutionHost) textBehaviorInferenceFailure(ctx context.Context, err error) error {
	if ctx != nil && ctx.Err() != nil {
		return executionFailure(localexecution.FailureCanceled, ctx.Err())
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); ok {
		switch reason {
		case runtimev1.ReasonCode_AI_TEXT_OUTPUT_INCOMPLETE:
			return executionFailure(localexecution.FailureTextOutputIncomplete, err)
		case runtimev1.ReasonCode_AI_TOOL_CALL_INVALID:
			return executionFailure(localexecution.FailureToolCallInvalid, err)
		case runtimev1.ReasonCode_AI_OUTPUT_INVALID:
			return executionFailure(localexecution.FailureTextOutputInvalid, err)
		case runtimev1.ReasonCode_AI_REASONING_CONTINUITY_INVALID:
			return executionFailure(localexecution.FailureTextOutputInvalid, err)
		}
	}
	return h.inferenceFailure(ctx, err)
}

// llamaContextLimitFailure recognizes llama-server's refusal of a prompt larger
// than its loaded context. Context shift stays off, so the server refuses the
// request instead of truncating it; the refusal is the request's own limit, not
// an inference failure a retry could clear.
func llamaContextLimitFailure(status int, body []byte) error {
	if status != http.StatusBadRequest {
		return nil
	}
	var payload struct {
		Error struct {
			Type          string `json:"type"`
			PromptTokens  int64  `json:"n_prompt_tokens"`
			ContextTokens int64  `json:"n_ctx"`
		} `json:"error"`
	}
	if json.Unmarshal(body, &payload) != nil || payload.Error.Type != "exceed_context_size_error" ||
		payload.Error.PromptTokens <= 0 || payload.Error.ContextTokens <= 0 {
		return nil
	}
	return executionFailure(localexecution.FailureInputLimit, fmt.Errorf(
		"the request needs %d tokens; the loaded local model context holds %d",
		payload.Error.PromptTokens, payload.Error.ContextTokens,
	))
}

func executionFailure(kind localexecution.FailureKind, err error) error {
	return &localexecution.ExecutionError{Kind: kind, Err: err}
}

type executionFailureDiagnosticProvider interface {
	FailureDiagnostic() string
}

type invocationDependencySourceValidator interface {
	ValidateDependencySources([]capabilitydriver.InvocationExactDependencySource) error
}

func validateInvocationDependencySources(substrate any, sources []capabilitydriver.InvocationExactDependencySource) error {
	if len(sources) == 0 {
		return nil
	}
	validator, ok := substrate.(invocationDependencySourceValidator)
	if !ok || validator == nil {
		return fmt.Errorf("execution substrate cannot validate captured dependency sources")
	}
	return validator.ValidateDependencySources(sources)
}

func executionFailureDiagnostic(source any) string {
	provider, ok := source.(executionFailureDiagnosticProvider)
	if !ok || provider == nil {
		return ""
	}
	return provider.FailureDiagnostic()
}

func boundedExecutionDiagnostic(err error) string {
	if err == nil {
		return ""
	}
	const limit = 4096
	value := strings.TrimSpace(err.Error())
	if len(value) <= limit {
		return value
	}
	return strings.ToValidUTF8(value[:limit], "")
}

func executionOutOfMemory(err error, diagnostics ...string) bool {
	values := make([]string, 0, len(diagnostics)+1)
	if err != nil {
		values = append(values, err.Error())
	}
	values = append(values, diagnostics...)
	for _, value := range values {
		normalized := strings.ToLower(value)
		if strings.Contains(normalized, "out of memory") || strings.Contains(normalized, "cuda_error_out_of_memory") {
			return true
		}
	}
	return false
}

func classifiedExecutionFailure(defaultKind localexecution.FailureKind, err error, diagnostics ...string) error {
	if executionOutOfMemory(err, diagnostics...) {
		return executionFailure(localexecution.FailureOutOfMemory, err)
	}
	return executionFailure(defaultKind, err)
}

type llamaExecutionManager interface {
	EngineStatus(EngineKind) (SupervisorInfo, error)
	StopEngine(EngineKind) error
	StartEngine(context.Context, EngineConfig) error
	EngineEndpoint(EngineKind) (string, error)
	ValidateLlamaDependencySources(EngineConfig, []capabilitydriver.InvocationExactDependencySource) error
}

type managerLlamaInvocationSubstrate struct {
	manager  llamaExecutionManager
	lifetime context.Context
	config   EngineConfig
	// warmSkipPathEligible optionally overrides windowsLocalNTFSModelFilesEligible
	// in package tests without global mutable state.
	warmSkipPathEligible func([]capabilitydriver.InvocationExactBinding) bool

	mu                      sync.Mutex
	currentKey              string
	lastInstanceID          string
	lastSupervisorID        string
	verified                verifiedLlamaModelResidency
	invalidationGen         uint64
	pendingRetirementAssets map[string]uint64
	// accessKey is the running worker's private key, fresh for each start and
	// handed to it only through its environment (never argv or logs).
	accessKey string
	loading   *managerLlamaInvocationLoad
}

type managerLlamaInvocationLoad struct {
	processKey                string
	args                      []string
	modelFiles                []capabilitydriver.InvocationExactBinding
	allowWarmModelContentSkip bool
	validateDependencies      func() error
	validateModelContent      func(context.Context) error
	invalidationGen           uint64
	ctx                       context.Context
	cancel                    context.CancelFunc
	waiters                   int
	done                      chan struct{}
	endpoint                  string
	err                       error
}

func newManagerLlamaInvocationSubstrate(manager *Manager) *managerLlamaInvocationSubstrate {
	return newManagerLlamaInvocationSubstrateWithConfig(manager, DefaultLlamaConfig())
}

func newManagerLlamaInvocationSubstrateWithConfig(manager *Manager, config EngineConfig) *managerLlamaInvocationSubstrate {
	config.CommandArgs = append([]string(nil), config.CommandArgs...)
	if len(config.CommandEnv) > 0 {
		commandEnv := make(map[string]string, len(config.CommandEnv))
		for key, value := range config.CommandEnv {
			commandEnv[key] = value
		}
		config.CommandEnv = commandEnv
	}
	return &managerLlamaInvocationSubstrate{manager: manager, lifetime: context.Background(), config: config}
}

func (s *managerLlamaInvocationSubstrate) isWarmSkipPathEligible(bindings []capabilitydriver.InvocationExactBinding) bool {
	if s != nil && s.warmSkipPathEligible != nil {
		return s.warmSkipPathEligible(bindings)
	}
	return windowsLocalNTFSModelFilesEligible(bindings)
}

func (s *managerLlamaInvocationSubstrate) InvalidateModelAssetVerification(modelAssetID string) {
	if s == nil {
		return
	}
	trimmed := strings.TrimSpace(modelAssetID)
	s.mu.Lock()
	defer s.mu.Unlock()
	if trimmed == "" {
		s.invalidationGen++
		s.verified = verifiedLlamaModelResidency{}
		return
	}
	if s.pendingRetirementAssets == nil {
		s.pendingRetirementAssets = make(map[string]uint64)
	}
	s.invalidationGen++
	s.pendingRetirementAssets[trimmed] = s.invalidationGen
	if modelFilesReferenceAsset(s.verified.modelFiles, trimmed) {
		s.verified = verifiedLlamaModelResidency{}
	}
}

func (s *managerLlamaInvocationSubstrate) clearStalePendingRetirements(maxGen uint64) {
	s.mu.Lock()
	for id, gen := range s.pendingRetirementAssets {
		if gen <= maxGen {
			delete(s.pendingRetirementAssets, id)
		}
	}
	s.mu.Unlock()
}

func (s *managerLlamaInvocationSubstrate) hasPendingRetirementLocked(bindings []capabilitydriver.InvocationExactBinding) bool {
	if len(s.pendingRetirementAssets) == 0 {
		return false
	}
	for _, binding := range bindings {
		if _, pending := s.pendingRetirementAssets[strings.TrimSpace(binding.ModelAssetID)]; pending {
			return true
		}
	}
	return false
}

func (s *managerLlamaInvocationSubstrate) invalidateResidencyOnContentMismatch() {
	if s == nil {
		return
	}
	s.mu.Lock()
	s.invalidationGen++
	s.currentKey = ""
	s.lastInstanceID = ""
	s.lastSupervisorID = ""
	s.verified = verifiedLlamaModelResidency{}
	s.accessKey = ""
	s.mu.Unlock()
}

func (s *managerLlamaInvocationSubstrate) promoteVerifiedInstance(
	expectedInfo SupervisorInfo,
	processKey string,
	modelFiles []capabilitydriver.InvocationExactBinding,
	invalidationGenAtCheck uint64,
) {
	if s == nil || s.manager == nil || expectedInfo.ProcessInstanceID == "" {
		return
	}
	liveInfo, err := s.manager.EngineStatus(EngineLlama)
	if err != nil || liveInfo.Status != StatusHealthy ||
		liveInfo.ProcessInstanceID == "" ||
		liveInfo.ProcessInstanceID != expectedInfo.ProcessInstanceID ||
		!liveInfo.PreSpawnVerified {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.loading != nil ||
		s.currentKey != processKey ||
		s.invalidationGen != invalidationGenAtCheck ||
		s.hasPendingRetirementLocked(modelFiles) {
		return
	}
	if s.lastSupervisorID != "" && liveInfo.SupervisorInstanceID != s.lastSupervisorID {
		return
	}
	s.lastInstanceID = liveInfo.ProcessInstanceID
	if liveInfo.SupervisorInstanceID != "" {
		s.lastSupervisorID = liveInfo.SupervisorInstanceID
	}
	s.verified = verifiedLlamaModelResidency{
		processInstanceID:    liveInfo.ProcessInstanceID,
		supervisorInstanceID: liveInfo.SupervisorInstanceID,
		processKey:           processKey,
		modelFiles:           cloneInvocationExactBindings(modelFiles),
		invalidationGen:      invalidationGenAtCheck,
	}
}

func (s *managerLlamaInvocationSubstrate) Ensure(
	ctx context.Context,
	processKey string,
	processArgs []string,
	validateContent func(context.Context) error,
	progress localexecution.TextProgressFunc,
) (string, bool, error) {
	return s.EnsureInvocation(ctx, llamaInvocationEnsureRequest{
		processKey:                processKey,
		processArgs:               processArgs,
		allowWarmModelContentSkip: false,
		validateModelContent:      validateContent,
	}, progress)
}

func (s *managerLlamaInvocationSubstrate) EnsureInvocation(
	ctx context.Context,
	req llamaInvocationEnsureRequest,
	progress localexecution.TextProgressFunc,
) (string, bool, error) {
	if s == nil || s.manager == nil {
		return "", false, fmt.Errorf("engine manager is unavailable")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if err := ctx.Err(); err != nil {
		return "", false, err
	}
	processKey := req.processKey
	processArgs := req.processArgs
	modelFiles := cloneInvocationExactBindings(req.modelFiles)
	for {
		s.mu.Lock()
		if s.loading == nil && processKey == s.currentKey {
			endpoint, err := s.manager.EngineEndpoint(EngineLlama)
			if err == nil {
				info, statusErr := s.manager.EngineStatus(EngineLlama)
				sameTrackedInstance := statusErr == nil &&
					info.Status == StatusHealthy &&
					info.ProcessInstanceID != "" &&
					s.lastInstanceID != "" &&
					info.ProcessInstanceID == s.lastInstanceID
				verifiedOwnSupervisorRestart := statusErr == nil &&
					info.Status == StatusHealthy &&
					info.ProcessInstanceID != "" &&
					s.lastSupervisorID != "" &&
					info.SupervisorInstanceID == s.lastSupervisorID &&
					info.PreSpawnVerified
				if s.lastInstanceID != "" && !sameTrackedInstance && !verifiedOwnSupervisorRestart {
					// A different process instance (even with identical processKey,
					// port, or PID) or an unverified restart replaced the tracked
					// worker. Invalidate and perform a fresh verified load.
					s.currentKey = ""
					s.lastInstanceID = ""
					s.lastSupervisorID = ""
					s.verified = verifiedLlamaModelResidency{}
					s.accessKey = ""
				} else {
					invalidationGenAtCheck := s.invalidationGen
					canSkipModelContent := sameTrackedInstance &&
						req.allowWarmModelContentSkip &&
						s.verified.processInstanceID != "" &&
						s.verified.processInstanceID == info.ProcessInstanceID &&
						s.verified.processKey == processKey &&
						s.verified.invalidationGen == invalidationGenAtCheck &&
						!s.hasPendingRetirementLocked(modelFiles) &&
						llamaTextProcessArgsAllowWarmSkip(processArgs) &&
						equalInvocationModelFiles(modelFiles, s.verified.modelFiles)
					s.mu.Unlock()

					if err := ctx.Err(); err != nil {
						return "", false, err
					}
					// Independent dependency-source validation always runs, even on
					// warm same-instance hits.
					if req.validateDependencies != nil {
						if err := req.validateDependencies(); err != nil {
							return "", false, err
						}
					}
					if !canSkipModelContent {
						if req.validateModelContent != nil {
							if err := req.validateModelContent(ctx); err != nil {
								if localexecution.FailureKindOf(err) == localexecution.FailureContentMismatch {
									s.invalidateResidencyOnContentMismatch()
								}
								return "", false, err
							}
						}
						if req.allowWarmModelContentSkip &&
							(sameTrackedInstance || verifiedOwnSupervisorRestart) &&
							len(modelFiles) > 0 &&
							llamaTextProcessArgsAllowWarmSkip(processArgs) &&
							s.isWarmSkipPathEligible(modelFiles) {
							s.promoteVerifiedInstance(info, processKey, modelFiles, invalidationGenAtCheck)
						}
					}
					if err := ctx.Err(); err != nil {
						return "", false, err
					}
					if progress != nil {
						progress(localexecution.TextExecutionProgressReused)
					}
					return endpoint, true, nil
				}
			} else {
				s.currentKey = ""
				s.lastInstanceID = ""
				s.lastSupervisorID = ""
				s.verified = verifiedLlamaModelResidency{}
			}
		}
		load := s.loading
		if load != nil && load.ctx.Err() != nil {
			// The last prior waiter canceled this load. It still owns process
			// cleanup, but a new caller must not inherit its canceled result.
			s.mu.Unlock()
			if progress != nil {
				progress(localexecution.TextExecutionProgressLoading)
			}
			select {
			case <-ctx.Done():
				return "", false, ctx.Err()
			case <-load.done:
				continue
			}
		}
		if load == nil {
			loadCtx, cancelLoad := context.WithCancel(s.lifetime)
			load = &managerLlamaInvocationLoad{
				processKey:                processKey,
				args:                      append([]string(nil), processArgs...),
				modelFiles:                modelFiles,
				allowWarmModelContentSkip: req.allowWarmModelContentSkip,
				validateDependencies:      req.validateDependencies,
				validateModelContent:      req.validateModelContent,
				invalidationGen:           s.invalidationGen,
				ctx:                       loadCtx,
				cancel:                    cancelLoad,
				waiters:                   1,
				done:                      make(chan struct{}),
			}
			s.loading = load
			go s.runLoad(load)
		} else {
			load.waiters++
		}
		s.mu.Unlock()
		if progress != nil {
			progress(localexecution.TextExecutionProgressLoading)
		}
		canceled := false
		select {
		case <-ctx.Done():
			canceled = true
		case <-load.done:
		}
		s.releaseLoadWaiter(load, canceled)
		if canceled {
			return "", false, ctx.Err()
		}
		if ctx.Err() != nil {
			return "", false, ctx.Err()
		}
		if load.processKey != processKey {
			continue
		}
		if load.err != nil {
			return "", false, load.err
		}
		if progress != nil {
			progress(localexecution.TextExecutionProgressReady)
		}
		return load.endpoint, false, nil
	}
}

func (s *managerLlamaInvocationSubstrate) runLoad(load *managerLlamaInvocationLoad) {
	if err := load.ctx.Err(); err != nil {
		s.finishLoad(load, "", "", SupervisorInfo{}, false, err)
		return
	}
	if info, err := s.manager.EngineStatus(EngineLlama); err == nil && info.Status != StatusStopped {
		if err := s.manager.StopEngine(EngineLlama); err != nil {
			s.finishLoad(load, "", "", SupervisorInfo{}, false, fmt.Errorf("stop prior llama process: %w", err))
			return
		}
	}
	s.clearStalePendingRetirements(load.invalidationGen)
	if err := load.ctx.Err(); err != nil {
		s.finishLoad(load, "", "", SupervisorInfo{}, false, err)
		return
	}
	// Revalidate only after the prior worker has stopped and immediately before
	// StartEngine gives the captured paths to llama-server. Performing this
	// check earlier would leave process shutdown as a replacement window.
	if load.validateDependencies != nil {
		if err := load.validateDependencies(); err != nil {
			s.finishLoad(load, "", "", SupervisorInfo{}, false, err)
			return
		}
	}
	if load.validateModelContent != nil {
		if err := load.validateModelContent(load.ctx); err != nil {
			s.finishLoad(load, "", "", SupervisorInfo{}, false, err)
			return
		}
	}
	warmEligible := load.allowWarmModelContentSkip &&
		len(load.modelFiles) > 0 &&
		llamaTextProcessArgsAllowWarmSkip(load.args) &&
		s.isWarmSkipPathEligible(load.modelFiles)

	accessKey, err := newLlamaAccessKey()
	if err != nil {
		s.finishLoad(load, "", "", SupervisorInfo{}, false, err)
		return
	}
	cfg := s.config
	cfg.CommandArgs = append([]string(nil), load.args...)
	cfg.CommandEnv = make(map[string]string, len(s.config.CommandEnv)+1)
	for key, value := range s.config.CommandEnv {
		cfg.CommandEnv[key] = value
	}
	cfg.CommandEnv["LLAMA_API_KEY"] = accessKey
	cfg.PreSpawnValidated = true
	validateDeps := load.validateDependencies
	validateModel := load.validateModelContent
	if validateDeps != nil || validateModel != nil {
		cfg.PreRestartValidate = func(restartCtx context.Context) error {
			if validateDeps != nil {
				if err := validateDeps(); err != nil {
					return err
				}
			}
			if validateModel != nil {
				if err := validateModel(restartCtx); err != nil {
					return err
				}
			}
			return nil
		}
	}
	if err := s.manager.StartEngine(load.ctx, cfg); err != nil {
		s.finishLoad(load, "", "", SupervisorInfo{}, false, err)
		return
	}
	endpoint, err := s.manager.EngineEndpoint(EngineLlama)
	if err != nil {
		s.finishLoad(load, "", "", SupervisorInfo{}, false, err)
		return
	}
	info, statusErr := s.manager.EngineStatus(EngineLlama)
	if statusErr != nil {
		info = SupervisorInfo{}
	}
	s.finishLoad(load, endpoint, accessKey, info, warmEligible, nil)
}

func newLlamaAccessKey() (string, error) {
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		return "", fmt.Errorf("create llama access key: %w", err)
	}
	return hex.EncodeToString(secret), nil
}

func (s *managerLlamaInvocationSubstrate) AccessKey() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.accessKey
}

func (s *managerLlamaInvocationSubstrate) finishLoad(
	load *managerLlamaInvocationLoad,
	endpoint string,
	accessKey string,
	info SupervisorInfo,
	warmEligible bool,
	err error,
) {
	s.mu.Lock()
	defer s.mu.Unlock()
	load.endpoint = endpoint
	load.err = err
	if err != nil {
		s.currentKey = ""
		s.lastInstanceID = ""
		s.lastSupervisorID = ""
		s.verified = verifiedLlamaModelResidency{}
		s.accessKey = ""
	} else {
		s.currentKey = load.processKey
		s.accessKey = accessKey
		s.lastInstanceID = info.ProcessInstanceID
		s.lastSupervisorID = info.SupervisorInstanceID
		if warmEligible &&
			info.Status == StatusHealthy &&
			info.ProcessInstanceID != "" &&
			s.invalidationGen == load.invalidationGen &&
			!s.hasPendingRetirementLocked(load.modelFiles) {
			s.verified = verifiedLlamaModelResidency{
				processInstanceID:    info.ProcessInstanceID,
				supervisorInstanceID: info.SupervisorInstanceID,
				processKey:           load.processKey,
				modelFiles:           cloneInvocationExactBindings(load.modelFiles),
				invalidationGen:      load.invalidationGen,
			}
		} else {
			s.verified = verifiedLlamaModelResidency{}
		}
	}
	if s.loading == load {
		s.loading = nil
	}
	if load.cancel != nil {
		load.cancel()
		load.cancel = nil
	}
	close(load.done)
}

func (s *managerLlamaInvocationSubstrate) releaseLoadWaiter(load *managerLlamaInvocationLoad, canceled bool) {
	if load == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if load.waiters > 0 {
		load.waiters--
	}
	if canceled && load.waiters == 0 && s.loading == load && load.cancel != nil {
		load.cancel()
	}
}

func (s *managerLlamaInvocationSubstrate) Healthy() bool {
	if s == nil || s.manager == nil {
		return false
	}
	info, err := s.manager.EngineStatus(EngineLlama)
	return err == nil && info.Status == StatusHealthy && info.PID > 0 && supervisorProcessAlive(info.PID)
}

func (s *managerLlamaInvocationSubstrate) FailureDiagnostic() string {
	if s == nil || s.manager == nil {
		return ""
	}
	info, err := s.manager.EngineStatus(EngineLlama)
	if err != nil {
		return ""
	}
	return info.Detail
}

func (s *managerLlamaInvocationSubstrate) ValidateDependencySources(sources []capabilitydriver.InvocationExactDependencySource) error {
	if s == nil || s.manager == nil {
		return fmt.Errorf("llama execution manager is unavailable")
	}
	return s.manager.ValidateLlamaDependencySources(s.config, sources)
}

func (m *Manager) ValidateLlamaDependencySources(config EngineConfig, sources []capabilitydriver.InvocationExactDependencySource) error {
	if m == nil {
		return fmt.Errorf("llama execution manager is unavailable")
	}
	native, ok := exactInvocationDependencySource(sources, "native-engine-package.llama", "llama.cpp.package")
	if !ok || strings.TrimSpace(native.Version) != strings.TrimSpace(config.Version) {
		return fmt.Errorf("captured llama package source is missing or version-mismatched")
	}
	entry := m.registry.Get(EngineLlama, config.Version)
	if entry == nil || !sameCleanPath(native.CanonicalRoot, entry.BinaryPath) || strings.TrimSpace(native.Hashes["sha256"]) != strings.TrimSpace(entry.SHA256) {
		return fmt.Errorf("captured llama package source no longer matches the Runtime registry")
	}
	if strings.EqualFold(strings.TrimSpace(native.ConsumerScope), "llama.cpp.cuda") {
		cuda, ok := exactInvocationDependencySource(sources, "accelerator.cuda.runtime", NVIDIACUDAUserSpaceRuntimeDependencyID)
		if !ok {
			return fmt.Errorf("captured llama CUDA dependency source is missing")
		}
		status := m.ResolveSharedAcceleratorDependency(NVIDIACUDAUserSpaceRuntimeDependencyID, native.ConsumerScope)
		if status.State != SharedAcceleratorDependencyReadySystem && status.State != SharedAcceleratorDependencyReadyManaged ||
			!sameCleanPath(cuda.CanonicalRoot, status.CanonicalRoot) || strings.TrimSpace(cuda.Version) != strings.TrimSpace(status.Version) {
			return fmt.Errorf("captured llama CUDA dependency source no longer matches Runtime dependency state")
		}
	}
	for _, source := range sources {
		if source.DependencyFamily != "native-tool.media-codec" {
			continue
		}
		codec, ok := exactInvocationDependencySource(sources, "native-tool.media-codec", MediaCodecDependencyID)
		spec, err := mediaCodecSpecFor(currentGOOS(), currentGOARCH())
		if !ok || err != nil || codec.ConsumerScope != "media-codec" || codec.Version != spec.version || !sameCleanPath(codec.CanonicalRoot, filepath.Join(m.depsDir, "media-codec", spec.directory)) {
			return fmt.Errorf("captured llama media codec identity mismatch")
		}
		status, err := mediaCodecStatus(codec.CanonicalRoot, spec)
		if err != nil {
			return fmt.Errorf("verify captured llama media codec: %w", err)
		}
		for path, hash := range status.Hashes {
			if codec.Hashes[path] != hash {
				return fmt.Errorf("captured llama media codec hash mismatch")
			}
		}
		break
	}
	return nil
}

func exactInvocationDependencySource(sources []capabilitydriver.InvocationExactDependencySource, family, dependencyID string) (capabilitydriver.InvocationExactDependencySource, bool) {
	var match capabilitydriver.InvocationExactDependencySource
	found := false
	for _, source := range sources {
		if strings.TrimSpace(source.DependencyFamily) != family || strings.TrimSpace(source.DependencyID) != dependencyID {
			continue
		}
		if found {
			return capabilitydriver.InvocationExactDependencySource{}, false
		}
		match, found = source, true
	}
	return match, found
}

func sameCleanPath(left, right string) bool {
	return strings.EqualFold(filepath.Clean(strings.TrimSpace(left)), filepath.Clean(strings.TrimSpace(right)))
}

func stringValue(value any) string {
	text, _ := value.(string)
	return strings.TrimSpace(text)
}

func textContent(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case []any:
		var result strings.Builder
		for _, item := range typed {
			part, _ := item.(map[string]any)
			if text := stringValue(part["text"]); text != "" {
				result.WriteString(text)
			}
		}
		return result.String()
	default:
		return ""
	}
}

func mapLlamaFinishReason(value string) runtimev1.FinishReason {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "length", "max_tokens":
		return runtimev1.FinishReason_FINISH_REASON_LENGTH
	case "content_filter":
		return runtimev1.FinishReason_FINISH_REASON_CONTENT_FILTER
	case "tool_calls", "function_call":
		return runtimev1.FinishReason_FINISH_REASON_TOOL_CALL
	case "error":
		return runtimev1.FinishReason_FINISH_REASON_ERROR
	default:
		return runtimev1.FinishReason_FINISH_REASON_STOP
	}
}
