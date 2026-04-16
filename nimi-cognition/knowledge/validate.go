package knowledge

import (
	"errors"
	"fmt"
	"strings"

	"github.com/nimiplatform/nimi/nimi-cognition/artifactref"
	"github.com/nimiplatform/nimi/nimi-cognition/kernel"
)

// ValidatePage performs structural fail-closed validation on a
// knowledge page.
func ValidatePage(p Page) error {
	if p.PageID == "" {
		return errors.New("validate page: page_id is required")
	}
	if p.ScopeID == "" {
		return fmt.Errorf("validate page %s: scope_id is required", p.PageID)
	}
	if err := validateProjectionKind(p.Kind); err != nil {
		return fmt.Errorf("validate page %s: %w", p.PageID, err)
	}
	if p.Version < 1 {
		return fmt.Errorf("validate page %s: version must be >= 1, got %d", p.PageID, p.Version)
	}
	if p.Title == "" {
		return fmt.Errorf("validate page %s: title is required", p.PageID)
	}
	if len(p.Body) == 0 {
		return fmt.Errorf("validate page %s: body is required", p.PageID)
	}
	if err := validateProjectionLifecycle(p.Lifecycle); err != nil {
		return fmt.Errorf("validate page %s: %w", p.PageID, err)
	}
	if p.CreatedAt.IsZero() {
		return fmt.Errorf("validate page %s: created_at is required", p.PageID)
	}
	if p.UpdatedAt.IsZero() {
		return fmt.Errorf("validate page %s: updated_at is required", p.PageID)
	}
	for i, c := range p.Citations {
		if err := validateCitation(c); err != nil {
			return fmt.Errorf("validate page %s: citations[%d]: %w", p.PageID, i, err)
		}
	}
	for i, ref := range p.SourceRefs {
		if err := validateSourceRef(ref); err != nil {
			return fmt.Errorf("validate page %s: source_refs[%d]: %w", p.PageID, i, err)
		}
	}
	for i, ref := range p.ArtifactRefs {
		if err := artifactref.Validate(ref); err != nil {
			return fmt.Errorf("validate page %s: artifact_refs[%d]: %w", p.PageID, i, err)
		}
		if ref.FromKind != artifactref.KindKnowledgePage || ref.FromID != string(p.PageID) {
			return fmt.Errorf("validate page %s: artifact_refs[%d]: ownership must stay on the page", p.PageID, i)
		}
		if ref.ToKind == artifactref.KindKnowledgePage {
			return fmt.Errorf("validate page %s: artifact_refs[%d]: knowledge_page relations must be first-class relation rows", p.PageID, i)
		}
		if isRelationRole(ref.Role) {
			return fmt.Errorf("validate page %s: artifact_refs[%d]: relation:* roles are not admitted in page artifact_refs", p.PageID, i)
		}
	}
	return nil
}

// ValidateRelation performs structural fail-closed validation on a knowledge relation.
func ValidateRelation(r Relation) error {
	if r.ScopeID == "" {
		return errors.New("scope_id is required")
	}
	if r.FromPageID == "" {
		return errors.New("from_page_id is required")
	}
	if r.ToPageID == "" {
		return errors.New("to_page_id is required")
	}
	if r.FromPageID == r.ToPageID {
		return errors.New("self-links are not allowed")
	}
	if r.RelationType == "" {
		return errors.New("relation_type is required")
	}
	switch r.Strength {
	case artifactref.StrengthStrong, artifactref.StrengthWeak:
	default:
		return fmt.Errorf("invalid relation strength %q", r.Strength)
	}
	if r.CreatedAt.IsZero() {
		return errors.New("created_at is required")
	}
	if r.UpdatedAt.IsZero() {
		return errors.New("updated_at is required")
	}
	return nil
}

// ValidateIngestEnvelope validates local ingest inputs.
func ValidateIngestEnvelope(env IngestEnvelope) error {
	if env.PageID == "" {
		return errors.New("page_id is required")
	}
	if err := validateProjectionKind(env.Kind); err != nil {
		return err
	}
	if env.Title == "" {
		return errors.New("title is required")
	}
	if len(env.Body) == 0 {
		return errors.New("body is required")
	}
	return nil
}

// ValidateIngestTask validates persisted ingest task state.
func ValidateIngestTask(task IngestTask) error {
	if task.TaskID == "" {
		return errors.New("task_id is required")
	}
	if task.ScopeID == "" {
		return errors.New("scope_id is required")
	}
	switch task.Status {
	case IngestTaskStatusQueued, IngestTaskStatusRunning, IngestTaskStatusCompleted, IngestTaskStatusFailed:
	default:
		if task.Status == "" {
			return errors.New("status is required")
		}
		return fmt.Errorf("invalid ingest task status %q", task.Status)
	}
	if task.ProgressPercent < 0 || task.ProgressPercent > 100 {
		return errors.New("progress_percent must be between 0 and 100")
	}
	if task.CreatedAt.IsZero() {
		return errors.New("created_at is required")
	}
	if task.UpdatedAt.IsZero() {
		return errors.New("updated_at is required")
	}
	if task.Status == IngestTaskStatusCompleted && task.PageID == "" {
		return errors.New("page_id is required for completed ingest task")
	}
	if task.Status == IngestTaskStatusFailed && envLikeBlank(task.Error) {
		return errors.New("error is required for failed ingest task")
	}
	return nil
}

func validateCitation(c Citation) error {
	if c.TargetKind == "" {
		return errors.New("target_kind is required")
	}
	if c.TargetID == "" {
		return errors.New("target_id is required")
	}
	if err := validateRefStrength(c.Strength); err != nil {
		return err
	}
	return nil
}

func validateProjectionKind(k ProjectionKind) error {
	switch k {
	case ProjectionKindExplainer, ProjectionKindSummary, ProjectionKindGuide, ProjectionKindNote:
		return nil
	case "":
		return errors.New("kind is required")
	default:
		return fmt.Errorf("invalid kind %q", k)
	}
}

func validateProjectionLifecycle(l ProjectionLifecycle) error {
	switch l {
	case ProjectionLifecycleActive, ProjectionLifecycleStale,
		ProjectionLifecycleArchived, ProjectionLifecycleRemoved:
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

func envLikeBlank(value string) bool {
	return strings.TrimSpace(value) == ""
}

func isRelationRole(role string) bool {
	return strings.HasPrefix(strings.TrimSpace(role), "relation:")
}
