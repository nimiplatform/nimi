package localservice

import (
	"bytes"
	"log/slog"
	"strings"
	"testing"
)

func TestRecordStartupStateIsolationDiagnosticsLogsTypedFields(t *testing.T) {
	var output bytes.Buffer
	svc := &Service{logger: slog.New(slog.NewTextHandler(&output, nil))}
	diagnostic := stateIsolationDiagnostic{
		Store:          "model-assets",
		Level:          stateIsolationLevelRecord,
		ReasonCode:     localStateRecordQuarantinedReason,
		QuarantinePath: `C:\runtime\quarantine\record.json`,
		Section:        "assets",
		RecordIndex:    3,
	}

	svc.recordStartupStateIsolationDiagnostics([]stateIsolationDiagnostic{diagnostic})

	logLine := output.String()
	for _, field := range []string{
		"store=model-assets",
		"level=record",
		"reason=" + localStateRecordQuarantinedReason,
		"quarantine=",
		"section=assets",
		"index=3",
	} {
		if !strings.Contains(logLine, field) {
			t.Fatalf("startup isolation log missing %q: %s", field, logLine)
		}
	}
}
