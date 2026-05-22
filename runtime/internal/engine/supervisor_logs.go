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
		if stream == "stderr" {
			s.recordStderrTail(line)
		}
		attrs := []any{
			"engine", s.cfg.Kind,
			"stream", stream,
			"line", line,
		}
		if phase := s.trackProcessLogPhase(stream, line); phase != "" {
			attrs = append(attrs, "phase", phase)
		}
		lineLevel := level
		if s.cfg.Kind == EngineLlama && stream == "stderr" {
			lineLevel = classifyLlamaStderrLevel(line)
		}
		s.logger.Log(context.Background(), lineLevel, "engine process output", attrs...)
	}
	if err := scanner.Err(); err != nil {
		s.logger.Warn("engine log stream closed with error",
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
	if s.cfg.Kind != engineManagedImageBackend {
		return ""
	}
	phase := detectMediaProcessLogPhase(stream, line)
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

// classifyLlamaStderrLevel returns the appropriate log level for a llama engine
// stderr line. llama.cpp writes all output to stderr, including informational
// model metadata, loading progress, and inference statistics. Without
// classification these flood the log as WARN and obscure genuinely important
// messages.
func classifyLlamaStderrLevel(line string) slog.Level {
	// Actual errors/warnings — keep at WARN.
	lower := strings.ToLower(line)
	for _, kw := range []string{"error", "failed", "warning", "fatal", "panic", "abort"} {
		if strings.Contains(lower, kw) {
			return slog.LevelWarn
		}
	}

	// Key lifecycle events — promote to INFO.
	for _, prefix := range []string{
		"main: model loaded",
		"main: server is listening",
		"main: starting the main loop",
	} {
		if strings.HasPrefix(line, prefix) {
			return slog.LevelInfo
		}
	}

	// Everything else from llama.cpp is informational chatter → DEBUG.
	return slog.LevelDebug
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
