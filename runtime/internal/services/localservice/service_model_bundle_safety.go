package localservice

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/oklog/ulid/v2"
)

func runtimeManagedModelQuarantineRoot(modelsRoot string) string {
	return filepath.Join(modelsRoot, "quarantine", "models")
}

func managedModelBundleWorkDir(destDir string, suffix string) string {
	return fmt.Sprintf("%s-%s-%s", destDir, suffix, strings.ToLower(ulid.Make().String()))
}

func prepareManagedModelBundleStageDir(destDir string, purpose string) (string, error) {
	stageDir := managedModelBundleWorkDir(destDir, purpose)
	if err := os.MkdirAll(stageDir, 0o755); err != nil {
		return "", fmt.Errorf("create managed model stage dir: %w", err)
	}
	return stageDir, nil
}

func dirExists(path string) (bool, error) {
	info, err := os.Stat(path)
	if err == nil {
		return info.IsDir(), nil
	}
	if os.IsNotExist(err) {
		return false, nil
	}
	return false, err
}

func moveDirOrCopy(sourceDir string, destDir string) error {
	if err := os.Rename(sourceDir, destDir); err == nil {
		return nil
	}
	if err := copyDirRecursive(sourceDir, destDir); err != nil {
		return err
	}
	if err := os.RemoveAll(sourceDir); err != nil {
		return err
	}
	return nil
}

func bundleFailureSlug(reason string) string {
	slugged := slugifyLocalModelID(reason)
	if slugged == "local-model" {
		return "failure"
	}
	return slugged
}

func joinManagedModelSafetyErrors(errs ...error) error {
	parts := make([]string, 0, len(errs))
	for _, err := range errs {
		if err == nil {
			continue
		}
		parts = append(parts, err.Error())
	}
	if len(parts) == 0 {
		return nil
	}
	return fmt.Errorf("%s", strings.Join(parts, "; "))
}

type managedModelBundleActivation struct {
	destDir   string
	backupDir string
}

func activateManagedModelBundle(destDir string, stageDir string) (*managedModelBundleActivation, error) {
	activation := &managedModelBundleActivation{destDir: destDir}
	destExists, err := dirExists(destDir)
	if err != nil {
		return nil, fmt.Errorf("stat current managed bundle: %w", err)
	}
	if destExists {
		activation.backupDir = managedModelBundleWorkDir(destDir, "backup")
		if err := moveDirOrCopy(destDir, activation.backupDir); err != nil {
			return nil, fmt.Errorf("backup current managed bundle: %w", err)
		}
	}
	if err := moveDirOrCopy(stageDir, destDir); err != nil {
		restoreErr := error(nil)
		if activation.backupDir != "" {
			restoreErr = moveDirOrCopy(activation.backupDir, destDir)
		}
		if restoreErr != nil {
			return nil, fmt.Errorf("activate managed model bundle: %v; restore_backup=%v", err, restoreErr)
		}
		return nil, fmt.Errorf("activate managed model bundle: %w", err)
	}
	return activation, nil
}

func (activation *managedModelBundleActivation) Commit() error {
	if activation == nil || strings.TrimSpace(activation.backupDir) == "" {
		return nil
	}
	if err := os.RemoveAll(activation.backupDir); err != nil {
		return fmt.Errorf("cleanup managed bundle backup: %w", err)
	}
	activation.backupDir = ""
	return nil
}

func (activation *managedModelBundleActivation) Rollback(
	s *Service,
	modelsRoot string,
	logicalModelID string,
	operation string,
	reason string,
	modelID string,
	localModelID string,
) (string, error) {
	if activation == nil {
		return "", nil
	}

	var errs []error
	quarantinePath := ""
	if exists, err := dirExists(activation.destDir); err != nil {
		errs = append(errs, fmt.Errorf("stat activated bundle: %w", err))
	} else if exists {
		path, quarantineErr := s.quarantineManagedModelBundle(
			modelsRoot,
			logicalModelID,
			activation.destDir,
			operation,
			reason,
			modelID,
			localModelID,
		)
		quarantinePath = path
		if quarantineErr != nil {
			errs = append(errs, quarantineErr)
		}
	}
	if strings.TrimSpace(activation.backupDir) != "" {
		if exists, err := dirExists(activation.backupDir); err != nil {
			errs = append(errs, fmt.Errorf("stat bundle backup: %w", err))
		} else if exists {
			if err := moveDirOrCopy(activation.backupDir, activation.destDir); err != nil {
				errs = append(errs, fmt.Errorf("restore managed bundle backup: %w", err))
			}
		}
		activation.backupDir = ""
	}
	return quarantinePath, joinManagedModelSafetyErrors(errs...)
}

func (s *Service) quarantineManagedModelBundle(
	modelsRoot string,
	logicalModelID string,
	sourceDir string,
	operation string,
	reason string,
	modelID string,
	localModelID string,
) (string, error) {
	exists, err := dirExists(sourceDir)
	if err != nil {
		return "", fmt.Errorf("stat managed bundle for quarantine: %w", err)
	}
	if !exists {
		return "", nil
	}

	quarantineDir := filepath.Join(
		runtimeManagedModelQuarantineRoot(modelsRoot),
		fmt.Sprintf(
			"%s-%s-%s",
			slugifyLocalModelID(logicalModelID),
			strings.ToLower(ulid.Make().String()),
			bundleFailureSlug(reason),
		),
	)
	if err := os.MkdirAll(filepath.Dir(quarantineDir), 0o755); err != nil {
		return "", fmt.Errorf("create model quarantine root: %w", err)
	}
	if err := moveDirOrCopy(sourceDir, quarantineDir); err != nil {
		return "", fmt.Errorf("move managed bundle into quarantine: %w", err)
	}

	metadataPath := filepath.Join(quarantineDir, "quarantine.manifest.json")
	metadata := map[string]any{
		"schemaVersion":    "1.0.0",
		"kind":             "managed_model_bundle_quarantine",
		"quarantined_at":   nowISO(),
		"logical_model_id": strings.TrimSpace(logicalModelID),
		"model_id":         strings.TrimSpace(modelID),
		"local_model_id":   strings.TrimSpace(localModelID),
		"original_path":    filepath.Clean(sourceDir),
		"quarantine_path":  filepath.Clean(quarantineDir),
		"operation":        strings.TrimSpace(operation),
		"reason":           strings.TrimSpace(reason),
	}
	raw, marshalErr := json.MarshalIndent(metadata, "", "  ")
	if marshalErr == nil {
		marshalErr = os.WriteFile(metadataPath, raw, 0o644)
	}

	s.mu.Lock()
	s.appendRuntimeAuditLocked(&runtimev1.LocalAuditEvent{
		Id:           "audit_" + ulid.Make().String(),
		EventType:    "runtime_model_bundle_quarantined",
		OccurredAt:   nowISO(),
		Source:       "local",
		ModelId:      strings.TrimSpace(modelID),
		LocalModelId: strings.TrimSpace(localModelID),
		Detail:       fmt.Sprintf("managed model bundle quarantined after %s failure", defaultString(strings.TrimSpace(operation), "runtime")),
		Payload: toStruct(map[string]any{
			"logicalModelId": strings.TrimSpace(logicalModelID),
			"originalPath":   filepath.Clean(sourceDir),
			"quarantinePath": filepath.Clean(quarantineDir),
			"operation":      strings.TrimSpace(operation),
			"reason":         strings.TrimSpace(reason),
			"metadataPath":   metadataPath,
		}),
	})
	s.mu.Unlock()

	if marshalErr != nil {
		return quarantineDir, fmt.Errorf("write quarantine manifest: %w", marshalErr)
	}
	return quarantineDir, nil
}

func (s *Service) rollbackManagedModelStageBeforeActivation(
	modelsRoot string,
	logicalModelID string,
	sourcePath string,
	stagedFilePath string,
	stageDir string,
	removeSource bool,
	operation string,
	reason string,
	modelID string,
) (string, error) {
	var errs []error
	if removeSource {
		if _, err := os.Stat(stagedFilePath); err == nil {
			if moveBackErr := maybeMoveOrCopyFile(stagedFilePath, sourcePath, false); moveBackErr != nil {
				errs = append(errs, fmt.Errorf("restore moved source: %w", moveBackErr))
			}
		} else if err != nil && !os.IsNotExist(err) {
			errs = append(errs, fmt.Errorf("stat staged model file: %w", err))
		}
	}
	quarantinePath, quarantineErr := s.quarantineManagedModelBundle(
		modelsRoot,
		logicalModelID,
		stageDir,
		operation,
		reason,
		modelID,
		"",
	)
	if quarantineErr != nil {
		errs = append(errs, quarantineErr)
	}
	return quarantinePath, joinManagedModelSafetyErrors(errs...)
}
