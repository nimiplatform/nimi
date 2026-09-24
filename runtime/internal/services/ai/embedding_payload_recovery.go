package ai

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
)

// Called with the Job store lock. Scratch files are never replay inputs; an
// interrupted atomic write has no recovery use after its writer has stopped.
func (s *Service) scrubEmbeddingRecoveryCopiesLocked(scope embeddingDisposalScope) error {
	store := s.scenarioJobs
	if store.durablePath == "" {
		return nil
	}
	root := filepath.Dir(store.durablePath)
	quarantine := filepath.Join(root, scenarioJobIsolationQuarantineDirName)
	for _, directory := range []string{root, quarantine} {
		temporary, err := filepath.Glob(filepath.Join(directory, ".scenario-jobs-*.tmp"))
		if err != nil {
			return err
		}
		for _, path := range temporary {
			if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
				return err
			}
		}
	}
	paths, err := filepath.Glob(filepath.Join(quarantine, "scenario-jobs.json.*.json"))
	if err != nil {
		return err
	}
	released := make(map[string]struct{})
	for _, path := range paths {
		raw, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		document, err := parseScenarioJobDurableDocument(raw)
		if err != nil {
			return fmt.Errorf("embedding cleanup: uninspectable recovery copy: %w", err)
		}
		// A torn final append cannot be attributed; it was never acknowledged,
		// so the rewritten copy drops it.
		changed := document.tornBytes > 0
		filtered := make([]json.RawMessage, 0, len(document.base.Records))
		for _, rawRecord := range document.base.Records {
			matched, err := s.disposeEmbeddingRecoveryRow(scope, rawRecord, released)
			if err != nil {
				return err
			}
			if matched {
				changed = true
				continue
			}
			filtered = append(filtered, rawRecord)
		}
		document.base.Records = filtered
		entries := make([]scenarioJobJournalEntry, 0, len(document.entries))
		for _, entry := range document.entries {
			rows := make([]scenarioJobJournalRecord, 0, len(entry.Records))
			for _, row := range entry.Records {
				matched, err := s.disposeEmbeddingRecoveryRow(scope, row.Record, released)
				if err != nil {
					return err
				}
				if matched {
					changed = true
					continue
				}
				rows = append(rows, row)
			}
			entry.Records = rows
			if !entry.empty() {
				entries = append(entries, entry)
			}
		}
		document.entries = entries
		if !changed {
			continue
		}
		clean, err := document.encode()
		if err != nil {
			return err
		}
		if err := writeScenarioJobDocument(path, clean); err != nil {
			return err
		}
	}
	return nil
}

// disposeEmbeddingRecoveryRow reports whether one recovery-copy row belongs to
// the disposal scope and releases the credential custody that row still
// names, once per reference.
func (s *Service) disposeEmbeddingRecoveryRow(scope embeddingDisposalScope, rawRecord json.RawMessage, released map[string]struct{}) (bool, error) {
	// A quarantined execution may be invalid. Read only custody attribution;
	// never turn a partially decoded record into an executable Job.
	var record struct {
		Job     json.RawMessage   `json:"job"`
		Payload *embeddingPayload `json:"embedding_payload"`
		Cloud   json.RawMessage   `json:"cloud_resolved_assembly"`
	}
	if err := json.Unmarshal(rawRecord, &record); err != nil {
		return false, fmt.Errorf("embedding cleanup: uninspectable custody: %w", err)
	}
	var identity struct {
		JobID   string `json:"job_id"`
		CamelID string `json:"jobId"`
		Head    struct {
			Account      string `json:"subject_user_id"`
			CamelAccount string `json:"subjectUserId"`
		} `json:"head"`
	}
	if err := json.Unmarshal(record.Job, &identity); err != nil {
		return false, err
	}
	id, account := identity.JobID, identity.Head.Account
	if id == "" {
		id = identity.CamelID
	}
	if account == "" {
		account = identity.Head.CamelAccount
	}
	matched, err := scope.matches(id, account, record.Payload)
	if err != nil || !matched {
		return false, err
	}
	if strings.TrimSpace(id) == "" {
		return false, fmt.Errorf("embedding recovery custody has no Job identity")
	}
	if len(record.Cloud) > 0 {
		var cloud struct {
			Ref string `json:"credential_custody_ref"`
		}
		if err := json.Unmarshal(record.Cloud, &cloud); err != nil {
			return false, err
		}
		if cloud.Ref != "" {
			if _, done := released[cloud.Ref]; !done {
				if err := connector.ValidateCredentialCustodyRefForJob(cloud.Ref, id); err != nil {
					return false, err
				}
				if err := s.releaseCloudCredentialCustody(cloud.Ref); err != nil {
					return false, err
				}
				released[cloud.Ref] = struct{}{}
			}
		}
	}
	return true, nil
}
