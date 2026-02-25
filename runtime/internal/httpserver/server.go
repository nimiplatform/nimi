package httpserver

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/health"
	"github.com/nimiplatform/nimi/runtime/internal/providerhealth"
)

// Server exposes runtime diagnostics/readiness over HTTP.
type Server struct {
	addr     string
	state    *health.State
	logger   *slog.Logger
	http     *http.Server
	aiHealth *providerhealth.Tracker
}

func New(addr string, state *health.State, logger *slog.Logger) *Server {
	s := &Server{
		addr:     addr,
		state:    state,
		logger:   logger,
		aiHealth: nil,
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/livez", s.handleLive)
	mux.HandleFunc("/readyz", s.handleReady)
	mux.HandleFunc("/healthz", s.handleReady)
	mux.HandleFunc("/v1/runtime/health", s.handleRuntimeHealth)

	s.http = &http.Server{
		Addr:              addr,
		Handler:           mux,
		ReadHeaderTimeout: 3 * time.Second,
	}
	return s
}

func (s *Server) SetAIHealthTracker(tracker *providerhealth.Tracker) {
	s.aiHealth = tracker
}

func (s *Server) Serve() error {
	s.logger.Info("http server listening", "addr", s.addr)
	if err := s.http.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		return fmt.Errorf("serve http: %w", err)
	}
	return nil
}

func (s *Server) Shutdown(ctx context.Context) error {
	return s.http.Shutdown(ctx)
}

func (s *Server) handleLive(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"ok": true,
	})
}

func (s *Server) handleReady(w http.ResponseWriter, _ *http.Request) {
	snapshot := s.state.Snapshot()
	statusCode := http.StatusServiceUnavailable
	if snapshot.Status.Ready() {
		statusCode = http.StatusOK
	}

	writeJSON(w, statusCode, map[string]any{
		"ok":         snapshot.Status.Ready(),
		"status":     snapshot.Status.String(),
		"reason":     snapshot.Reason,
		"sampled_at": snapshot.SampledAt.Format(time.RFC3339Nano),
	})
}

func (s *Server) handleRuntimeHealth(w http.ResponseWriter, _ *http.Request) {
	snapshot := s.state.Snapshot()
	providers := providerSnapshotsPayload(s.aiHealth)
	writeJSON(w, http.StatusOK, map[string]any{
		"status":                snapshot.Status.String(),
		"status_code":           int32(snapshot.Status),
		"reason":                snapshot.Reason,
		"queue_depth":           snapshot.QueueDepth,
		"active_workflows":      snapshot.ActiveWorkflows,
		"active_inference_jobs": snapshot.ActiveInferenceJobs,
		"cpu_milli":             snapshot.CPUMilli,
		"memory_bytes":          snapshot.MemoryBytes,
		"vram_bytes":            snapshot.VRAMBytes,
		"sampled_at":            snapshot.SampledAt.Format(time.RFC3339Nano),
		"ai_providers":          providers,
	})
}

func providerSnapshotsPayload(tracker *providerhealth.Tracker) []map[string]any {
	if tracker == nil {
		return []map[string]any{}
	}
	snapshots := tracker.List()
	out := make([]map[string]any, 0, len(snapshots))
	for _, item := range snapshots {
		out = append(out, map[string]any{
			"name":                 strings.TrimSpace(item.Name),
			"state":                string(item.State),
			"reason":               item.LastReason,
			"consecutive_failures": item.ConsecutiveFailures,
			"last_changed_at":      formatTimestamp(item.LastChangedAt),
			"last_checked_at":      formatTimestamp(item.LastCheckedAt),
		})
	}
	return out
}

func formatTimestamp(value time.Time) string {
	if value.IsZero() {
		return ""
	}
	return value.UTC().Format(time.RFC3339Nano)
}

func writeJSON(w http.ResponseWriter, statusCode int, body map[string]any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	if err := json.NewEncoder(w).Encode(body); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}
