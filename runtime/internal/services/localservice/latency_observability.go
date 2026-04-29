package localservice

import "time"

func (s *Service) observeLatency(stage string, startedAt time.Time, attrs ...any) {
	if s == nil || s.logger == nil || startedAt.IsZero() {
		return
	}
	fields := []any{
		"stage", stage,
		"duration_ms", time.Since(startedAt).Milliseconds(),
	}
	fields = append(fields, attrs...)
	s.logger.Debug("runtime latency observation", fields...)
}

func (s *Service) observeCounter(counter string, value int64, attrs ...any) {
	if s == nil || s.logger == nil {
		return
	}
	fields := []any{
		"counter", counter,
		"value", value,
	}
	fields = append(fields, attrs...)
	s.logger.Debug("runtime counter observation", fields...)
}
