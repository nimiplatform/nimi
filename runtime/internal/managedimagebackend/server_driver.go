package managedimagebackend

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

func newBackendDriver(cfg ServerConfig) (backendDriver, error) {
	switch strings.ToLower(strings.TrimSpace(cfg.Driver)) {
	case "stable-diffusion.cpp":
		return newStableDiffusionCPPDriver(cfg.BackendExecutable, cfg.WorkingDir)
	default:
		return nil, fmt.Errorf("unsupported managed image backend driver %q", cfg.Driver)
	}
}

type stableDiffusionCPPDriver struct {
	executablePath       string
	serverExecutablePath string
	workingDir           string
	httpClient           *http.Client
	commandFactory       managedImageCommandFactory
	readinessProbe       managedImageReadinessProbe
	generateRequester    managedImageGenerateRequester

	mu         sync.Mutex
	generateMu sync.Mutex
	resident   *stableDiffusionCPPResident
}

func newStableDiffusionCPPDriver(executablePath string, workingDir string) (backendDriver, error) {
	trimmedExecutable := strings.TrimSpace(executablePath)
	if trimmedExecutable == "" {
		return nil, fmt.Errorf("managed image backend executable is required")
	}
	if _, err := os.Stat(trimmedExecutable); err != nil {
		return nil, fmt.Errorf("managed image backend executable unavailable: %w", err)
	}
	resolvedWorkingDir := strings.TrimSpace(workingDir)
	if resolvedWorkingDir == "" {
		resolvedWorkingDir = filepath.Dir(trimmedExecutable)
	}
	serverExecutablePath, err := resolveStableDiffusionCPPServerExecutable(trimmedExecutable)
	if err != nil {
		return nil, err
	}
	return &stableDiffusionCPPDriver{
		executablePath:       trimmedExecutable,
		serverExecutablePath: serverExecutablePath,
		workingDir:           resolvedWorkingDir,
		httpClient:           &http.Client{},
		commandFactory:       defaultManagedImageCommandFactory,
		readinessProbe:       defaultStableDiffusionCPPReadinessProbe,
		generateRequester:    defaultStableDiffusionCPPGenerateRequester,
	}, nil
}

func (d *stableDiffusionCPPDriver) LoadModel(state loadModelState) (*LoadModelDiagnostics, error) {
	if d == nil {
		return nil, fmt.Errorf("managed image backend driver unavailable")
	}
	if err := validateManagedImageLoadState(state); err != nil {
		return nil, err
	}
	config := stableDiffusionCPPResidentConfigFromLoad(state)
	fingerprint, err := stableDiffusionCPPResidentFingerprint(config)
	if err != nil {
		return nil, err
	}

	d.mu.Lock()
	defer d.mu.Unlock()

	if d.resident != nil && d.resident.fingerprint == fingerprint && !d.resident.hasExited() {
		log.Printf("managed image resident cache hit fingerprint=%s endpoint=%s startup_flags=%s",
			fingerprint,
			d.resident.endpoint,
			d.resident.startupSummary,
		)
		return &LoadModelDiagnostics{
			CacheHit:       true,
			ResidentReused: true,
		}, nil
	}
	restartedResident := false
	if d.resident != nil {
		log.Printf("managed image resident restart reason=config_changed old_fingerprint=%s new_fingerprint=%s",
			d.resident.fingerprint,
			fingerprint,
		)
		if err := d.stopResidentLocked("config_changed"); err != nil {
			return nil, err
		}
		restartedResident = true
	}

	resident, err := d.startResidentLocked(config, fingerprint)
	if err != nil {
		return nil, err
	}
	d.resident = resident
	return &LoadModelDiagnostics{
		ResidentRestarted: restartedResident,
	}, nil
}

func (d *stableDiffusionCPPDriver) GenerateImage(ctx context.Context, loaded loadModelState, req imageGenerateState, onProgress func(imageGenerateProgress) error) (*ImageGenerateDiagnostics, error) {
	if d == nil {
		return nil, fmt.Errorf("managed image backend driver unavailable")
	}
	if strings.TrimSpace(req.Dst) == "" {
		return nil, fmt.Errorf("managed image destination is required")
	}
	if err := os.MkdirAll(filepath.Dir(strings.TrimSpace(req.Dst)), 0o755); err != nil {
		return nil, fmt.Errorf("create managed image destination: %w", err)
	}
	queueStartedAt := time.Now()
	d.generateMu.Lock()
	defer d.generateMu.Unlock()
	queueWaitMs := time.Since(queueStartedAt).Milliseconds()

	d.mu.Lock()
	resident := d.resident
	d.mu.Unlock()
	if resident == nil || resident.hasExited() {
		return nil, fmt.Errorf("managed image resident server is not loaded")
	}

	startedAt := time.Now()
	log.Printf("managed image resident request start endpoint=%s model_path=%s width=%d height=%d step=%d cfg_scale=%g sampler=%s scheduler=%s reused_resident=%t",
		resident.endpoint,
		strings.TrimSpace(loaded.ModelPath),
		req.Width,
		req.Height,
		req.Step,
		loaded.CFGScale,
		strings.TrimSpace(loaded.Options.Sampler),
		strings.TrimSpace(loaded.Options.Scheduler),
		true,
	)
	if queueWaitMs > 0 {
		log.Printf("managed image resident request queued endpoint=%s model_path=%s queue_wait_ms=%d",
			resident.endpoint,
			strings.TrimSpace(loaded.ModelPath),
			queueWaitMs,
		)
	}

	progressCursor := 0
	if resident.logCapture != nil {
		progressCursor = resident.logCapture.SnapshotCursor()
	}
	type generateResult struct {
		payload []byte
		err     error
	}
	resultCh := make(chan generateResult, 1)
	go func() {
		payload, err := d.generateRequester(ctx, d.httpClient, resident.endpoint, loaded, req)
		resultCh <- generateResult{payload: payload, err: err}
	}()
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()
	var (
		payload      []byte
		err          error
		lastProgress imageGenerateProgress
		haveProgress bool
	)
	for {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-ticker.C:
			progressCursor, lastProgress, haveProgress, err = emitManagedImageProgressUpdates(resident.logCapture, progressCursor, onProgress, lastProgress, haveProgress)
			if err != nil {
				return nil, err
			}
		case result := <-resultCh:
			payload = result.payload
			err = result.err
			var emitErr error
			progressCursor, lastProgress, haveProgress, emitErr = emitManagedImageProgressUpdates(resident.logCapture, progressCursor, onProgress, lastProgress, haveProgress)
			if emitErr != nil {
				return nil, emitErr
			}
			_ = progressCursor
			goto completed
		}
	}

completed:
	durationMs := time.Since(startedAt).Milliseconds()
	diag := &ImageGenerateDiagnostics{
		QueueWaitMs:        queueWaitMs,
		GenerateDurationMs: durationMs,
		QueueSerialized:    queueWaitMs > 0,
		ResidentReused:     true,
	}
	if err != nil {
		log.Printf("managed image resident request failed endpoint=%s model_path=%s duration_ms=%d queue_wait_ms=%d error=%v",
			resident.endpoint,
			strings.TrimSpace(loaded.ModelPath),
			durationMs,
			queueWaitMs,
			err,
		)
		return diag, err
	}
	if len(payload) == 0 {
		return diag, fmt.Errorf("managed image destination is empty")
	}
	if err := os.WriteFile(strings.TrimSpace(req.Dst), payload, 0o600); err != nil {
		return diag, fmt.Errorf("write managed image destination: %w", err)
	}
	log.Printf("managed image resident request completed endpoint=%s model_path=%s duration_ms=%d queue_wait_ms=%d queue_serialized=%t dst=%s bytes=%d",
		resident.endpoint,
		strings.TrimSpace(loaded.ModelPath),
		durationMs,
		queueWaitMs,
		queueWaitMs > 0,
		strings.TrimSpace(req.Dst),
		len(payload),
	)
	return diag, nil
}

func (d *stableDiffusionCPPDriver) Free(_ loadModelState) error {
	if d == nil {
		return nil
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.stopResidentLocked("explicit_free")
}
