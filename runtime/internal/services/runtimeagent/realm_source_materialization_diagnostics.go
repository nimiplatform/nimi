package runtimeagent

import (
	"encoding/json"
	"os"
	"path/filepath"
	"time"
)

const (
	realmSourceMaterializationFailureDiagnosticSchemaV1 = "nimi.runtime.realm-source-materialization-failure/v1"
	realmSourceMaterializationFailureDiagnosticFileV1   = "last-realm-source-materialization-failure.json"
	realmSourceMaterializationFailureDiagnosticErrLimit = 4096
	realmSourceMaterializationFailureDiagnosticDirName  = "Diagnostics"
)

type realmSourceMaterializationFailureDiagnosticV1 struct {
	SchemaVersion string `json:"schemaVersion"`
	Stage         string `json:"stage"`
	FailureCode   string `json:"failureCode"`
	RequestID     string `json:"requestId"`
	Error         string `json:"error,omitempty"`
	OccurredAt    string `json:"occurredAt"`
}

// reportRealmSourceMaterializationFailureV3 emits one bounded local diagnostic
// distinguishing which materialization stage failed and why. The record carries
// no packet, proof, challenge, credential or account bytes; the request id is
// the caller-generated idempotency key. Best-effort: diagnostics never alter
// the fail-closed product response.
func reportRealmSourceMaterializationFailureV3(stage string, code sourceMaterializationFailureCodeV3, requestID string, cause error) {
	message := ""
	if cause != nil {
		message = cause.Error()
		if len(message) > realmSourceMaterializationFailureDiagnosticErrLimit {
			message = message[:realmSourceMaterializationFailureDiagnosticErrLimit]
		}
	}
	encoded, err := json.Marshal(realmSourceMaterializationFailureDiagnosticV1{
		SchemaVersion: realmSourceMaterializationFailureDiagnosticSchemaV1,
		Stage:         stage,
		FailureCode:   string(code),
		RequestID:     requestID,
		Error:         message,
		OccurredAt:    time.Now().UTC().Format(time.RFC3339Nano),
	})
	if err != nil {
		return
	}
	programData := os.Getenv("ProgramData")
	if programData == "" {
		return
	}
	directory := filepath.Join(programData, "Nimi", "Runtime", realmSourceMaterializationFailureDiagnosticDirName)
	if os.MkdirAll(directory, 0o750) != nil {
		return
	}
	temporary, temporaryErr := os.CreateTemp(directory, ".realm-source-materialization-failure-*.json")
	if temporaryErr != nil {
		return
	}
	temporaryPath := temporary.Name()
	keep := false
	defer func() {
		_ = temporary.Close()
		if !keep {
			_ = os.Remove(temporaryPath)
		}
	}()
	if _, writeErr := temporary.Write(encoded); writeErr != nil || temporary.Sync() != nil || temporary.Close() != nil {
		return
	}
	destination := filepath.Join(directory, realmSourceMaterializationFailureDiagnosticFileV1)
	_ = os.Remove(destination)
	if os.Rename(temporaryPath, destination) == nil {
		keep = true
	}
}
