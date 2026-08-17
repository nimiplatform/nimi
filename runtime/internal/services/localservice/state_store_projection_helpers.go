package localservice

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func parseProjectionReasonCode(raw string) runtimev1.ReasonCode {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED
	}
	value, ok := runtimev1.ReasonCode_value[trimmed]
	if !ok {
		return runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED
	}
	return runtimev1.ReasonCode(value)
}

func formatProjectionReasonCode(reason runtimev1.ReasonCode) string {
	if reason == runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
		return ""
	}
	return reason.String()
}

func loadLocalStateSnapshot(path string) (localStateSnapshot, error) {
	snapshot, _, _, err := loadLocalStateSnapshotIsolated(path)
	return snapshot, err
}

func saveLocalStateSnapshot(path string, snapshot localStateSnapshot) error {
	if strings.TrimSpace(path) == "" {
		return nil
	}
	payload, err := marshalStateSnapshotWithRetainedRecords(snapshot, snapshot.retainedRecords)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmpPath := path + ".tmp." + strconv.FormatInt(time.Now().UTC().UnixNano(), 10)
	if err := os.WriteFile(tmpPath, payload, 0o600); err != nil {
		return err
	}
	return os.Rename(tmpPath, path)
}
