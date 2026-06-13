package engine

import (
	"bufio"
	"context"
	"io"
	"log/slog"
	"regexp"
	"strconv"
	"strings"
)

var processProgressCounterPattern = regexp.MustCompile(`(\d+)/(\d+)`)
var processLogPrefixPattern = regexp.MustCompile(`^\[(\d+)\]\s*(.*)$`)
var llamaLoadingModelPattern = regexp.MustCompile(`srv\s+load_model:\s+loading model '([^']+)'`)
var llamaOffloadedLayersPattern = regexp.MustCompile(`offloaded\s+(\d+)/(\d+)\s+layers`)
var llamaSlotsPattern = regexp.MustCompile(`n_slots\s*=\s*(\d+)`)
var endpointPattern = regexp.MustCompile(`https?://[^\s]+|[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+:[0-9]+`)

type processLogRecord struct {
	level               slog.Level
	message             string
	event               string
	phase               string
	component           string
	line                string
	attrs               []any
	includeInStderrTail bool
}

func (s *Supervisor) streamProcessLogs(reader io.ReadCloser, stream string, level slog.Level) {
	if reader == nil {
		return
	}
	defer func() { _ = reader.Close() }()
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	scanner.Split(splitProcessLogToken)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		record := classifyEngineProcessLog(s.cfg.Kind, stream, line, level)
		if phase := s.trackProcessLogPhase(stream, record.line); phase != "" && record.phase == "" {
			record.phase = phase
		}
		if stream == "stderr" && record.includeInStderrTail {
			s.recordStderrTail(record.line)
		}
		attrs := []any{
			"event", record.event,
			"engine", s.cfg.Kind,
			"stream", stream,
		}
		if record.phase != "" {
			attrs = append(attrs, "phase", record.phase)
		}
		if record.component != "" {
			attrs = append(attrs, "component", record.component)
		}
		attrs = append(attrs, record.attrs...)
		attrs = append(attrs, "line", record.line)
		s.logger.Log(context.Background(), record.level, record.message, attrs...)
	}
	if err := scanner.Err(); err != nil {
		s.logger.Warn("engine log stream closed with error",
			"event", "engine.process.log_stream_error",
			"engine", s.cfg.Kind,
			"stream", stream,
			"error", err,
		)
	}
}

func splitProcessLogToken(data []byte, atEOF bool) (advance int, token []byte, err error) {
	for i := 0; i < len(data); i++ {
		switch data[i] {
		case '\n':
			return i + 1, data[:i], nil
		case '\r':
			if i+1 < len(data) && data[i+1] == '\n' {
				return i + 2, data[:i], nil
			}
			return i + 1, data[:i], nil
		}
	}
	if atEOF && len(data) > 0 {
		return len(data), data, nil
	}
	return 0, nil, nil
}

func (s *Supervisor) trackProcessLogPhase(stream, line string) string {
	phase := ""
	switch s.cfg.Kind {
	case EngineLlama:
		phase = detectLlamaProcessLogPhase(line)
	case engineManagedImageBackend:
		phase = detectMediaProcessLogPhase(stream, line)
	default:
		return ""
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if phase != "" {
		s.processLogPhase = phase
	}
	return s.processLogPhase
}

func detectMediaProcessLogPhase(stream, line string) string {
	trimmed := strings.TrimSpace(line)
	if trimmed == "" {
		return ""
	}
	if stream == "stdout" {
		if phase, ok := classifyMediaProgressLine(trimmed); ok {
			return phase
		}
	}
	switch {
	case strings.Contains(trimmed, "loading tensors from"),
		strings.Contains(trimmed, "loading tensors completed"):
		return "load_tensors"
	case strings.Contains(trimmed, "sampling using"),
		strings.Contains(trimmed, "TXT2IMG"),
		strings.Contains(trimmed, "get_learned_condition completed"),
		strings.Contains(trimmed, "generating image:"),
		strings.Contains(trimmed, "generate_image "):
		return "sampling"
	case strings.Contains(trimmed, "decoding 1 latents"),
		strings.Contains(trimmed, "decode_first_stage completed"),
		strings.Contains(trimmed, "latent 1 decoded"):
		return "decode"
	case strings.Contains(trimmed, "Writing PNG"),
		strings.Contains(trimmed, "Saved resulting image"),
		strings.Contains(trimmed, "gen_image is done"):
		return "write_artifact"
	default:
		return ""
	}
}

func classifyMediaProgressLine(line string) (string, bool) {
	matches := processProgressCounterPattern.FindStringSubmatch(line)
	if len(matches) != 3 {
		return "", false
	}
	total, err := strconv.Atoi(matches[2])
	if err != nil {
		return "", false
	}
	if total > 100 {
		return "load_tensors", true
	}
	if strings.Contains(line, "s/it") || strings.Contains(line, "it/s") {
		return "sampling", true
	}
	return "", false
}

func classifyEngineProcessLog(kind EngineKind, stream, rawLine string, defaultLevel slog.Level) processLogRecord {
	line, prefixAttrs := normalizeProcessLogLine(rawLine)
	component := processLogComponent(line)
	record := processLogRecord{
		level:               defaultLevel,
		message:             "engine process output",
		event:               "engine.process.output",
		component:           component,
		line:                line,
		attrs:               prefixAttrs,
		includeInStderrTail: stream == "stderr",
	}
	if isProcessErrorLine(line) {
		record.level = slog.LevelWarn
		record.message = "engine process warning"
		record.event = "engine.process.warning"
		return record
	}
	switch kind {
	case EngineLlama:
		return classifyLlamaProcessLog(record)
	case engineManagedImageBackend:
		return classifyManagedImageBackendProcessLog(record, stream)
	default:
		if stream == "stderr" && isShellTraceLine(line) {
			record.level = slog.LevelDebug
			record.event = "engine.process.shell_trace"
			record.includeInStderrTail = false
		}
		return record
	}
}

func normalizeProcessLogLine(rawLine string) (string, []any) {
	line := strings.TrimSpace(rawLine)
	matches := processLogPrefixPattern.FindStringSubmatch(line)
	if len(matches) != 3 {
		return line, nil
	}
	return strings.TrimSpace(matches[2]), []any{"process_log_prefix", matches[1]}
}

func processLogComponent(line string) string {
	if idx := strings.Index(line, ":"); idx > 0 {
		component := strings.TrimSpace(line[:idx])
		if component != "" && len(component) <= 48 {
			return strings.Join(strings.Fields(component), " ")
		}
	}
	return ""
}

func isProcessErrorLine(line string) bool {
	lower := strings.ToLower(line)
	for _, kw := range []string{"error", "failed", "warning", "fatal", "panic", "abort"} {
		if strings.Contains(lower, kw) {
			return true
		}
	}
	return false
}

func isShellTraceLine(line string) bool {
	trimmed := strings.TrimSpace(line)
	return strings.HasPrefix(trimmed, "+ ")
}

func classifyLlamaProcessLog(record processLogRecord) processLogRecord {
	line := record.line
	record.level = slog.LevelDebug
	record.message = "llama process detail"
	record.event = "engine.llama.detail"
	record.includeInStderrTail = false
	if record.phase = detectLlamaProcessLogPhase(line); record.phase != "" {
		record.attrs = append(record.attrs, "phase_source", "line")
	}
	switch {
	case strings.HasPrefix(line, "main: loading model"):
		return record.asInfo("engine model loading", "engine.llama.model_loading", "load_model")
	case strings.Contains(line, "load_model: loading model"):
		record = record.asInfo("engine model loading", "engine.llama.model_loading", "load_model")
		if matches := llamaLoadingModelPattern.FindStringSubmatch(line); len(matches) == 2 {
			record.attrs = append(record.attrs, "model_path", matches[1])
		}
		return record
	case strings.Contains(line, "loaded meta data with"):
		return record.asInfo("engine model metadata loaded", "engine.llama.model_metadata_loaded", "load_model")
	case strings.Contains(line, "load_tensors: loading model tensors"):
		return record.asInfo("engine model tensors loading", "engine.llama.tensors_loading", "load_tensors")
	case strings.Contains(line, "load_tensors: offloaded"):
		record = record.asInfo("engine model layers offloaded", "engine.llama.layers_offloaded", "load_tensors")
		if matches := llamaOffloadedLayersPattern.FindStringSubmatch(line); len(matches) == 3 {
			record.attrs = append(record.attrs, "offloaded_layers", matches[1], "total_layers", matches[2])
		}
		return record
	case strings.Contains(line, "llama_kv_cache: size ="):
		return record.asInfo("engine kv cache allocated", "engine.llama.kv_cache_allocated", "allocate_context")
	case strings.Contains(line, "warming up the model"):
		return record.asInfo("engine model warmup started", "engine.llama.warmup_started", "warmup")
	case strings.Contains(line, "initializing slots"):
		record = record.asInfo("engine slots initializing", "engine.llama.slots_initializing", "init_slots")
		if matches := llamaSlotsPattern.FindStringSubmatch(line); len(matches) == 2 {
			record.attrs = append(record.attrs, "slots", matches[1])
		}
		return record
	case strings.HasPrefix(line, "main: model loaded"):
		return record.asInfo("engine model loaded", "engine.llama.model_loaded", "ready")
	case strings.Contains(line, "server is listening"):
		record = record.asInfo("engine endpoint listening", "engine.llama.endpoint_listening", "ready")
		if endpoint := firstEndpoint(line); endpoint != "" {
			record.attrs = append(record.attrs, "endpoint", endpoint)
		}
		return record
	case line == "cmd_child_to_router:ready":
		return record.asInfo("engine router ready", "engine.llama.router_ready", "ready")
	case strings.Contains(line, "cleaning up before exit"),
		strings.Contains(line, "exit command received"),
		strings.Contains(line, "memory breakdown"),
		strings.Contains(line, "deallocating"):
		return record.asInfo("engine shutdown detail", "engine.llama.shutdown_detail", "shutdown")
	default:
		return record
	}
}

func classifyManagedImageBackendProcessLog(record processLogRecord, stream string) processLogRecord {
	line := record.line
	if isShellTraceLine(line) {
		record.level = slog.LevelDebug
		record.message = "managed image backend shell trace"
		record.event = "engine.managed_image.shell_trace"
		record.phase = "bootstrap"
		record.includeInStderrTail = false
		return record
	}
	if record.phase == "" {
		record.phase = detectMediaProcessLogPhase(stream, line)
	}
	switch {
	case strings.Contains(line, "CPU info:"),
		strings.Contains(line, "Using library:"):
		record.level = slog.LevelInfo
		record.message = "managed image backend environment"
		record.event = "engine.managed_image.environment"
		record.phase = "bootstrap"
		record.includeInStderrTail = false
	case strings.Contains(line, "pinned Metal source compilation"):
		record.level = slog.LevelInfo
		record.message = "managed image backend metal runtime patched"
		record.event = "engine.managed_image.metal_runtime_patched"
		record.phase = "bootstrap"
		record.includeInStderrTail = false
	case strings.Contains(line, "gRPC Server listening"):
		record.level = slog.LevelInfo
		record.message = "engine endpoint listening"
		record.event = "engine.managed_image.endpoint_listening"
		record.phase = "ready"
		record.includeInStderrTail = false
		if endpoint := firstEndpoint(line); endpoint != "" {
			record.attrs = append(record.attrs, "endpoint", endpoint)
		}
	case record.phase != "":
		record.level = slog.LevelDebug
		record.message = "managed image backend progress"
		record.event = "engine.managed_image.progress"
	default:
		if stream == "stderr" {
			record.level = slog.LevelDebug
			record.includeInStderrTail = false
		}
	}
	return record
}

func detectLlamaProcessLogPhase(line string) string {
	switch {
	case strings.Contains(line, "loading model"):
		return "load_model"
	case strings.Contains(line, "load_tensors"):
		return "load_tensors"
	case strings.Contains(line, "llama_context"),
		strings.Contains(line, "llama_kv_cache"),
		strings.Contains(line, "sched_reserve"):
		return "allocate_context"
	case strings.Contains(line, "warming up the model"):
		return "warmup"
	case strings.Contains(line, "initializing slots"),
		strings.Contains(line, "new slot"):
		return "init_slots"
	case strings.Contains(line, "model loaded"),
		strings.Contains(line, "server is listening"),
		line == "cmd_child_to_router:ready":
		return "ready"
	case strings.Contains(line, "cleaning up before exit"),
		strings.Contains(line, "exit command received"),
		strings.Contains(line, "memory breakdown"),
		strings.Contains(line, "deallocating"):
		return "shutdown"
	default:
		return ""
	}
}

func (record processLogRecord) asInfo(message, event, phase string) processLogRecord {
	record.level = slog.LevelInfo
	record.message = message
	record.event = event
	record.phase = phase
	record.includeInStderrTail = false
	return record
}

func firstEndpoint(line string) string {
	return endpointPattern.FindString(line)
}

func (s *Supervisor) isRunEpochActive(epoch uint64) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.runEpoch == epoch
}

func (s *Supervisor) recordStderrTail(line string) {
	trimmed := strings.TrimSpace(line)
	if trimmed == "" {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.stderrTail = append(s.stderrTail, trimmed)
	if len(s.stderrTail) > supervisorStderrTailLines {
		s.stderrTail = append([]string(nil), s.stderrTail[len(s.stderrTail)-supervisorStderrTailLines:]...)
	}
}
