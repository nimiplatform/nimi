//go:build darwin && cgo && nimi_macos_source_local_development

package entrypoint

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestSourceRuntimeLoggerWritesProgressAndSubsequentLogsToTerminal(t *testing.T) {
	terminal, err := os.Create(filepath.Join(t.TempDir(), "terminal.log"))
	if err != nil {
		t.Fatal(err)
	}
	originalStdout := os.Stdout
	os.Stdout = terminal
	t.Cleanup(func() {
		os.Stdout = originalStdout
		_ = terminal.Close()
	})
	logger := newMacOSRuntimeLogger()
	logger.Info("waiting for Desktop connection", "status", "waiting-for-desktop")
	logger.Info("runtime ready", "status", "ready")
	logger.Warn("subsequent Runtime diagnostic", "reason", "test")
	if _, err := terminal.Seek(0, 0); err != nil {
		t.Fatal(err)
	}
	decoder := json.NewDecoder(terminal)
	for _, expected := range []struct{ message, level, status string }{
		{"waiting for Desktop connection", "INFO", "waiting-for-desktop"},
		{"runtime ready", "INFO", "ready"},
		{"subsequent Runtime diagnostic", "WARN", ""},
	} {
		var record struct {
			Message string `json:"msg"`
			Level   string `json:"level"`
			Status  string `json:"status"`
		}
		if err := decoder.Decode(&record); err != nil {
			t.Fatalf("read terminal log: %v", err)
		}
		if record.Message != expected.message || record.Level != expected.level || record.Status != expected.status {
			t.Fatalf("terminal log = %+v, want %+v", record, expected)
		}
	}
}
