package httpserver

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/health"
)

// Server exposes runtime diagnostics/readiness over HTTP.
type Server struct {
	addr   string
	state  *health.State
	logger *slog.Logger
	http   *http.Server
}

func New(
	addr string,
	state *health.State,
	logger *slog.Logger,
) *Server {
	s := &Server{
		addr:   addr,
		state:  state,
		logger: logger,
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/livez", s.handleLive)
	mux.HandleFunc("/readyz", s.handleReady)
	mux.HandleFunc("/healthz", s.handleReady)
	mux.HandleFunc("/v1/runtime/health", s.handleRuntimeHealth)

	s.http = &http.Server{
		Addr:              addr,
		Handler:           mux,
		MaxHeaderBytes:    1 << 16,
		ReadHeaderTimeout: 3 * time.Second,
		ReadTimeout:       5 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	return s
}

func (s *Server) Serve() error {
	s.logger.Info("http server listening", "addr", s.addr)
	if err := s.http.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		return fmt.Errorf("serve http: %w", err)
	}
	return nil
}

func (s *Server) Shutdown(ctx context.Context) error {
	if err := s.http.Shutdown(ctx); err != nil {
		return fmt.Errorf("shutdown http: %w", err)
	}
	return nil
}

func (s *Server) handleLive(w http.ResponseWriter, req *http.Request) {
	if !allowReadMethod(w, req) {
		return
	}
	s.writeJSON(w, http.StatusOK, map[string]any{
		"ok": true,
	})
}

func (s *Server) handleReady(w http.ResponseWriter, req *http.Request) {
	if !allowReadMethod(w, req) {
		return
	}
	snapshot := s.state.Snapshot()
	statusCode := http.StatusServiceUnavailable
	if snapshot.Status.Ready() {
		statusCode = http.StatusOK
	}

	s.writeJSON(w, statusCode, map[string]any{
		"ok":         snapshot.Status.Ready(),
		"status":     snapshot.Status.String(),
		"reason":     snapshot.Reason,
		"sampled_at": snapshot.SampledAt.Format(time.RFC3339Nano),
	})
}

func (s *Server) handleRuntimeHealth(w http.ResponseWriter, req *http.Request) {
	if !allowReadMethod(w, req) {
		return
	}
	snapshot := s.state.Snapshot()
	s.writeJSON(w, runtimeHealthStatusCode(snapshot.Status), map[string]any{
		"status":                snapshot.Status.String(),
		"status_code":           int32(snapshot.Status),
		"reason":                snapshot.Reason,
		"queue_depth":           snapshot.QueueDepth,
		"active_inference_jobs": snapshot.ActiveInferenceJobs,
		"cpu_milli":             snapshot.CPUMilli,
		"memory_bytes":          snapshot.MemoryBytes,
		"vram_bytes":            snapshot.VRAMBytes,
		"sampled_at":            snapshot.SampledAt.Format(time.RFC3339Nano),
	})
}

func (s *Server) writeJSON(w http.ResponseWriter, statusCode int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(statusCode)
	if err := json.NewEncoder(w).Encode(body); err != nil {
		s.logger.Error("encode http response", "status", statusCode, "error", err)
	}
}

func allowReadMethod(w http.ResponseWriter, req *http.Request) bool {
	if req == nil {
		w.Header().Set("Allow", http.MethodGet+", "+http.MethodHead)
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return false
	}
	switch req.Method {
	case http.MethodGet, http.MethodHead:
		return true
	default:
		w.Header().Set("Allow", http.MethodGet+", "+http.MethodHead)
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return false
	}
}

func runtimeHealthStatusCode(status health.Status) int {
	if status.Ready() {
		return http.StatusOK
	}
	return http.StatusServiceUnavailable
}
