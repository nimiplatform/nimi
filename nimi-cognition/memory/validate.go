package memory

import (
	"encoding/json"
	"errors"
	"fmt"

	"github.com/nimiplatform/nimi/nimi-cognition/artifactref"
	"github.com/nimiplatform/nimi/nimi-cognition/kernel"
)

// ValidateRecord performs structural fail-closed validation on a
// memory record.
func ValidateRecord(r Record) error {
	if r.RecordID == "" {
		return errors.New("validate record: record_id is required")
	}
	if r.ScopeID == "" {
		return fmt.Errorf("validate record %s: scope_id is required", r.RecordID)
	}
	if err := validateRecordKind(r.Kind); err != nil {
		return fmt.Errorf("validate record %s: %w", r.RecordID, err)
	}
	if r.Version < 1 {
		return fmt.Errorf("validate record %s: version must be >= 1, got %d", r.RecordID, r.Version)
	}
	if len(r.Content) == 0 {
		return fmt.Errorf("validate record %s: content is required", r.RecordID)
	}
	if err := validateRecordContent(r.Kind, r.Content); err != nil {
		return fmt.Errorf("validate record %s: %w", r.RecordID, err)
	}
	if err := validateRecordLifecycle(r.Lifecycle); err != nil {
		return fmt.Errorf("validate record %s: %w", r.RecordID, err)
	}
	if r.CreatedAt.IsZero() {
		return fmt.Errorf("validate record %s: created_at is required", r.RecordID)
	}
	if r.UpdatedAt.IsZero() {
		return fmt.Errorf("validate record %s: updated_at is required", r.RecordID)
	}
	for i, ref := range r.SourceRefs {
		if err := validateSourceRef(ref); err != nil {
			return fmt.Errorf("validate record %s: source_refs[%d]: %w", r.RecordID, i, err)
		}
	}
	for i, ref := range r.ArtifactRefs {
		if err := artifactref.Validate(ref); err != nil {
			return fmt.Errorf("validate record %s: artifact_refs[%d]: %w", r.RecordID, i, err)
		}
		if ref.FromKind != artifactref.KindMemoryRecord || ref.FromID != string(r.RecordID) {
			return fmt.Errorf("validate record %s: artifact_refs[%d]: ownership must stay on the record", r.RecordID, i)
		}
	}
	return nil
}

func validateRecordContent(kind RecordKind, raw json.RawMessage) error {
	switch kind {
	case RecordKindExperience:
		var value Experience
		if err := json.Unmarshal(raw, &value); err != nil {
			return fmt.Errorf("content: decode experience: %w", err)
		}
		if value.Summary == "" {
			return errors.New("content: experience.summary is required")
		}
	case RecordKindObservation:
		var value Observation
		if err := json.Unmarshal(raw, &value); err != nil {
			return fmt.Errorf("content: decode observation: %w", err)
		}
		if value.Subject == "" {
			return errors.New("content: observation.subject is required")
		}
		if value.Predicate == "" {
			return errors.New("content: observation.predicate is required")
		}
		if value.Object == "" {
			return errors.New("content: observation.object is required")
		}
	case RecordKindEvent:
		var value Event
		if err := json.Unmarshal(raw, &value); err != nil {
			return fmt.Errorf("content: decode event: %w", err)
		}
		if value.EventType == "" {
			return errors.New("content: event.event_type is required")
		}
		if value.Summary == "" {
			return errors.New("content: event.summary is required")
		}
	case RecordKindEvidence:
		var value EvidenceRow
		if err := json.Unmarshal(raw, &value); err != nil {
			return fmt.Errorf("content: decode evidence: %w", err)
		}
		if value.Claim == "" {
			return errors.New("content: evidence.claim is required")
		}
		if value.Support == "" {
			return errors.New("content: evidence.support is required")
		}
	case RecordKindNarrative:
		var value NarrativeProjection
		if err := json.Unmarshal(raw, &value); err != nil {
			return fmt.Errorf("content: decode narrative: %w", err)
		}
		if value.Title == "" {
			return errors.New("content: narrative.title is required")
		}
		if value.Body == "" {
			return errors.New("content: narrative.body is required")
		}
	default:
		return fmt.Errorf("content: unsupported kind %q", kind)
	}
	return nil
}

func validateRecordKind(k RecordKind) error {
	switch k {
	case RecordKindExperience, RecordKindObservation, RecordKindEvent,
		RecordKindEvidence, RecordKindNarrative:
		return nil
	case "":
		return errors.New("kind is required")
	default:
		return fmt.Errorf("invalid kind %q", k)
	}
}

func validateRecordLifecycle(l RecordLifecycle) error {
	switch l {
	case RecordLifecycleActive, RecordLifecycleArchived, RecordLifecycleRemoved:
		return nil
	case "":
		return errors.New("lifecycle is required")
	default:
		return fmt.Errorf("invalid lifecycle %q", l)
	}
}

func validateSourceRef(ref kernel.SourceRef) error {
	if ref.SourceType == "" {
		return errors.New("source_type is required")
	}
	if ref.SourceID == "" {
		return errors.New("source_id is required")
	}
	if err := validateRefStrength(ref.Strength); err != nil {
		return err
	}
	if ref.ObservedAt.IsZero() {
		return errors.New("observed_at is required")
	}
	return nil
}

func validateRefStrength(strength kernel.RefStrength) error {
	switch strength {
	case kernel.RefStrong, kernel.RefWeak:
		return nil
	case "":
		return errors.New("strength is required")
	default:
		return fmt.Errorf("invalid ref strength %q", strength)
	}
}
