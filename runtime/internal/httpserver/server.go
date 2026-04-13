package httpserver

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/health"
	"github.com/nimiplatform/nimi/runtime/internal/providerhealth"
	"google.golang.org/grpc/codes"
	grpcstatus "google.golang.org/grpc/status"
	"google.golang.org/protobuf/encoding/protojson"
)

// Server exposes runtime diagnostics/readiness over HTTP.
type Server struct {
	addr                string
	state               *health.State
	logger              *slog.Logger
	http                *http.Server
	aiHealth            *providerhealth.Tracker
	bindCanonicalMemory func(context.Context, string) (CanonicalBindResult, error)
}

type CanonicalBindResult struct {
	AlreadyBound bool
	Bank         *runtimev1.MemoryBank
}

func New(
	addr string,
	state *health.State,
	logger *slog.Logger,
	aiHealth *providerhealth.Tracker,
	bindCanonicalMemory func(context.Context, string) (CanonicalBindResult, error),
) *Server {
	s := &Server{
		addr:                addr,
		state:               state,
		logger:              logger,
		aiHealth:            aiHealth,
		bindCanonicalMemory: bindCanonicalMemory,
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/livez", s.handleLive)
	mux.HandleFunc("/readyz", s.handleReady)
	mux.HandleFunc("/healthz", s.handleReady)
	mux.HandleFunc("/v1/runtime/health", s.handleRuntimeHealth)
	mux.HandleFunc("/v1/runtime/private/memory/canonical-bind", s.handleCanonicalBind)

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
	providers := providerSnapshotsPayload(s.aiHealth)
	s.writeJSON(w, runtimeHealthStatusCode(snapshot.Status), map[string]any{
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

func (s *Server) handleCanonicalBind(w http.ResponseWriter, req *http.Request) {
	if req == nil {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if req.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if s.bindCanonicalMemory == nil {
		s.writeErrorJSON(w, http.StatusServiceUnavailable, "canonical bind is unavailable")
		return
	}
	if !requestFromLoopback(req) {
		s.writeErrorJSON(w, http.StatusForbidden, "canonical bind requires loopback request")
		return
	}
	if snapshot := s.state.Snapshot(); !snapshot.Status.Ready() {
		s.writeErrorJSON(w, http.StatusServiceUnavailable, "runtime is not ready")
		return
	}

	var payload struct {
		AgentID string `json:"agentId"`
	}
	if err := json.NewDecoder(req.Body).Decode(&payload); err != nil {
		s.writeErrorJSON(w, http.StatusBadRequest, fmt.Sprintf("invalid canonical bind payload: %v", err))
		return
	}
	payload.AgentID = strings.TrimSpace(payload.AgentID)
	if payload.AgentID == "" {
		s.writeErrorJSON(w, http.StatusBadRequest, "agentId is required")
		return
	}

	result, err := s.bindCanonicalMemory(req.Context(), payload.AgentID)
	if err != nil {
		s.writeErrorJSON(w, mapCanonicalBindErrorStatus(err), err.Error())
		return
	}

	bankPayload := map[string]any{}
	if result.Bank != nil {
		raw, err := protojson.Marshal(result.Bank)
		if err != nil {
			s.writeErrorJSON(w, http.StatusInternalServerError, fmt.Sprintf("marshal canonical bind bank: %v", err))
			return
		}
		if err := json.Unmarshal(raw, &bankPayload); err != nil {
			s.writeErrorJSON(w, http.StatusInternalServerError, fmt.Sprintf("decode canonical bind bank: %v", err))
			return
		}
	}

	s.writeJSON(w, http.StatusOK, map[string]any{
		"alreadyBound": result.AlreadyBound,
		"bank":         bankPayload,
	})
}

func providerSnapshotsPayload(tracker *providerhealth.Tracker) []map[string]any {
	if tracker == nil {
		return []map[string]any{}
	}
	snapshots := tracker.List()
	// Reserve room for every provider plus one possible aggregated cloud entry.
	out := make([]map[string]any, 0, len(snapshots)+1)
	cloudSubHealth := make([]map[string]any, 0, min(len(snapshots), 4))
	cloudState := string(providerhealth.StateHealthy)
	cloudReason := ""
	cloudConsecutiveFailures := 0
	var cloudLastChangedAt time.Time
	var cloudLastCheckedAt time.Time
	for _, item := range snapshots {
		entry := map[string]any{
			"name":                 strings.TrimSpace(item.Name),
			"state":                string(item.State),
			"reason":               item.LastReason,
			"consecutive_failures": item.ConsecutiveFailures,
			"last_changed_at":      formatTimestamp(item.LastChangedAt),
			"last_checked_at":      formatTimestamp(item.LastCheckedAt),
		}
		if strings.HasPrefix(strings.TrimSpace(strings.ToLower(item.Name)), "cloud-") {
			cloudSubHealth = append(cloudSubHealth, entry)
			if item.State == providerhealth.StateUnhealthy {
				cloudState = string(providerhealth.StateUnhealthy)
				if cloudReason == "" {
					cloudReason = strings.TrimSpace(item.LastReason)
				}
			}
			if item.ConsecutiveFailures > cloudConsecutiveFailures {
				cloudConsecutiveFailures = item.ConsecutiveFailures
			}
			if item.LastChangedAt.After(cloudLastChangedAt) {
				cloudLastChangedAt = item.LastChangedAt
			}
			if item.LastCheckedAt.After(cloudLastCheckedAt) {
				cloudLastCheckedAt = item.LastCheckedAt
			}
			continue
		}
		out = append(out, entry)
	}

	if len(cloudSubHealth) > 0 {
		if cloudReason == "" {
			for _, item := range cloudSubHealth {
				reason := strings.TrimSpace(stringFromAny(item["reason"]))
				if reason != "" {
					cloudReason = reason
					break
				}
			}
		}
		out = append(out, map[string]any{
			"name":                 "cloud-nimillm",
			"state":                cloudState,
			"reason":               cloudReason,
			"consecutive_failures": cloudConsecutiveFailures,
			"last_changed_at":      formatTimestamp(cloudLastChangedAt),
			"last_checked_at":      formatTimestamp(cloudLastCheckedAt),
			"sub_health":           cloudSubHealth,
		})
	}
	return out
}

func stringFromAny(value any) string {
	return fmt.Sprint(value)
}

func formatTimestamp(value time.Time) string {
	if value.IsZero() {
		return ""
	}
	return value.UTC().Format(time.RFC3339Nano)
}

func (s *Server) writeJSON(w http.ResponseWriter, statusCode int, body map[string]any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(statusCode)
	if err := json.NewEncoder(w).Encode(body); err != nil {
		s.logger.Error("encode http response", "status", statusCode, "error", err)
	}
}

func (s *Server) writeErrorJSON(w http.ResponseWriter, statusCode int, message string) {
	s.writeJSON(w, statusCode, map[string]any{
		"error": strings.TrimSpace(message),
	})
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

func requestFromLoopback(req *http.Request) bool {
	if req == nil {
		return false
	}
	host := strings.TrimSpace(req.RemoteAddr)
	if host == "" {
		return false
	}
	if parsedHost, _, err := net.SplitHostPort(host); err == nil {
		host = parsedHost
	}
	host = strings.Trim(host, "[]")
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func mapCanonicalBindErrorStatus(err error) int {
	if err == nil {
		return http.StatusOK
	}
	switch grpcstatus.Code(err) {
	case codes.InvalidArgument:
		return http.StatusBadRequest
	case codes.NotFound:
		return http.StatusNotFound
	case codes.FailedPrecondition:
		return http.StatusPreconditionFailed
	case codes.Unavailable:
		return http.StatusServiceUnavailable
	default:
		return http.StatusInternalServerError
	}
}

func runtimeHealthStatusCode(status health.Status) int {
	if status.Ready() {
		return http.StatusOK
	}
	return http.StatusServiceUnavailable
}
