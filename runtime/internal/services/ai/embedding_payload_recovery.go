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
	for _, path := range paths {
		raw, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		var snapshot scenarioJobDiskRawSnapshot
		if err := decodeScenarioJobStrictJSON(raw, &snapshot); err != nil {
			return fmt.Errorf("embedding cleanup: uninspectable recovery copy: %w", err)
		}
		filtered := make([]json.RawMessage, 0, len(snapshot.Records))
		changed := false
		for _, rawRecord := range snapshot.Records {
			// A quarantined execution may be invalid. Read only custody attribution;
			// never turn a partially decoded record into an executable Job.
			var record struct {
				Job     json.RawMessage   `json:"job"`
				Payload *embeddingPayload `json:"embedding_payload"`
				Cloud   json.RawMessage   `json:"cloud_resolved_assembly"`
			}
			if err := json.Unmarshal(rawRecord, &record); err != nil {
				return fmt.Errorf("embedding cleanup: uninspectable custody: %w", err)
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
				return err
			}
			id, account := identity.JobID, identity.Head.Account
			if id == "" {
				id = identity.CamelID
			}
			if account == "" {
				account = identity.Head.CamelAccount
			}
			matched, err := scope.matches(id, account, record.Payload)
			if err != nil {
				return err
			}
			if !matched {
				filtered = append(filtered, rawRecord)
				continue
			}
			if strings.TrimSpace(id) == "" {
				return fmt.Errorf("embedding recovery custody has no Job identity")
			}
			if len(record.Cloud) > 0 {
				var cloud struct {
					Ref string `json:"credential_custody_ref"`
				}
				if err := json.Unmarshal(record.Cloud, &cloud); err != nil {
					return err
				}
				if cloud.Ref != "" {
					if err := connector.ValidateCredentialCustodyRefForJob(cloud.Ref, id); err != nil {
						return err
					}
					if err := s.releaseCloudCredentialCustody(cloud.Ref); err != nil {
						return err
					}
				}
			}
			changed = true
		}
		if !changed {
			continue
		}
		snapshot.Records = filtered
		clean, err := json.Marshal(snapshot)
		if err != nil {
			return err
		}
		if err := writeScenarioJobDocument(path, clean); err != nil {
			return err
		}
	}
	return nil
}
