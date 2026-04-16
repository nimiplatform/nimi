package cognition

import (
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/artifactref"
	"github.com/nimiplatform/nimi/nimi-cognition/internal/embedding"
	"github.com/nimiplatform/nimi/nimi-cognition/internal/identity"
	"github.com/nimiplatform/nimi/nimi-cognition/internal/storage"
	"github.com/nimiplatform/nimi/nimi-cognition/knowledge"
)

// Save persists a knowledge page after source-integrity checks.
func (s *KnowledgeService) Save(page knowledge.Page) error {
	if err := validateKnowledgePageForWrite(s.store, page); err != nil {
		return fmt.Errorf("knowledge save: %w", err)
	}
	raw, err := json.Marshal(page)
	if err != nil {
		return fmt.Errorf("knowledge save: marshal: %w", err)
	}
	return s.store.Save(page.ScopeID, storage.KindKnowledge, string(page.PageID), raw)
}

func (s *KnowledgeService) Load(scopeID string, pageID knowledge.PageID) (*knowledge.Page, error) {
	page, err := s.loadOptional(scopeID, pageID)
	if err != nil {
		return nil, err
	}
	if page == nil {
		return nil, fmt.Errorf("knowledge load: page %s does not exist in scope %s", pageID, scopeID)
	}
	return page, nil
}

func (s *KnowledgeService) List(scopeID string) ([]knowledge.Page, error) {
	if err := validateScopeID(scopeID); err != nil {
		return nil, err
	}
	pages, err := s.store.LoadKnowledgePages(scopeID)
	if err != nil {
		return nil, err
	}
	return validateVisibleKnowledgePagesForService(s.store, pages)
}

func (s *KnowledgeService) SearchLexical(scopeID string, query string, limit int) ([]knowledge.Page, error) {
	if err := validateScopeID(scopeID); err != nil {
		return nil, err
	}
	if err := validateQueryRequired("knowledge search", query); err != nil {
		return nil, err
	}
	pages, err := s.store.SearchKnowledge(scopeID, query, limit)
	if err != nil {
		return nil, err
	}
	return validateVisibleKnowledgePagesForService(s.store, pages)
}

// SearchHybrid performs deterministic lexical+vector hybrid retrieval.
func (s *KnowledgeService) SearchHybrid(scopeID string, query string, limit int) ([]knowledge.Page, error) {
	if err := validateScopeID(scopeID); err != nil {
		return nil, err
	}
	if err := validateQueryRequired("knowledge hybrid search", query); err != nil {
		return nil, err
	}
	pages, err := s.List(scopeID)
	if err != nil {
		return nil, err
	}
	if len(pages) == 0 {
		return []knowledge.Page{}, nil
	}
	if limit <= 0 {
		limit = 10
	}
	embeddings, err := s.store.LoadKnowledgeEmbeddings(scopeID)
	if err != nil {
		return nil, fmt.Errorf("knowledge hybrid search: %w", err)
	}
	for _, page := range pages {
		vec, ok := embeddings[string(page.PageID)]
		if !ok {
			return nil, fmt.Errorf("knowledge hybrid search: embedding missing for page %s", page.PageID)
		}
		if len(vec) != embedding.Dimension {
			return nil, fmt.Errorf("knowledge hybrid search: embedding corrupt for page %s", page.PageID)
		}
	}
	lexicalHits, err := s.store.SearchKnowledge(scopeID, query, len(pages))
	if err != nil {
		return nil, err
	}
	lexicalHits, err = validateVisibleKnowledgePages(lexicalHits)
	if err != nil {
		return nil, err
	}
	lexicalRank := make(map[knowledge.PageID]float64, len(lexicalHits))
	for i, page := range lexicalHits {
		lexicalRank[page.PageID] = 1.0 / float64(i+1)
	}
	queryVec := embedding.Vectorize(query)
	type scoredPage struct {
		page    knowledge.Page
		score   float64
		lexical float64
		vector  float64
	}
	scored := make([]scoredPage, 0, len(pages))
	for _, page := range pages {
		vectorScore := embedding.CosineSimilarity(queryVec, embeddings[string(page.PageID)])
		lexicalScore := lexicalRank[page.PageID]
		total := (lexicalScore * 0.55) + (vectorScore * 0.45)
		if total <= 0 {
			continue
		}
		scored = append(scored, scoredPage{page: page, score: total, lexical: lexicalScore, vector: vectorScore})
	}
	if len(scored) == 0 {
		return []knowledge.Page{}, nil
	}
	sort.SliceStable(scored, func(i, j int) bool {
		if scored[i].score == scored[j].score {
			if scored[i].vector == scored[j].vector {
				if scored[i].lexical == scored[j].lexical {
					return scored[i].page.UpdatedAt.After(scored[j].page.UpdatedAt)
				}
				return scored[i].lexical > scored[j].lexical
			}
			return scored[i].vector > scored[j].vector
		}
		return scored[i].score > scored[j].score
	})
	results := make([]knowledge.Page, 0, min(limit, len(scored)))
	for _, item := range scored {
		if len(results) >= limit {
			break
		}
		results = append(results, item.page)
	}
	return results, nil
}

func (s *KnowledgeService) Delete(scopeID string, pageID knowledge.PageID) error {
	if err := validateScopeID(scopeID); err != nil {
		return err
	}
	if strings.TrimSpace(string(pageID)) == "" {
		return errors.New("knowledge delete: page_id is required")
	}
	if page, err := s.loadOptional(scopeID, pageID); err != nil {
		return err
	} else if page == nil {
		return fmt.Errorf("knowledge delete: page %s does not exist in scope %s", pageID, scopeID)
	}
	blockers, err := s.refgraph.RemoveBlockers(scopeID, artifactref.KindKnowledgePage, string(pageID))
	if err != nil {
		return err
	}
	blocking := blockingDeleteBlockers(blockers)
	if len(blocking) > 0 {
		return fmt.Errorf("knowledge delete: page %s is blocked by %s", pageID, formatDeleteBlockers(blocking))
	}
	return s.store.Delete(scopeID, storage.KindKnowledge, string(pageID))
}

func (s *KnowledgeService) History(scopeID string, pageID knowledge.PageID) ([]knowledge.HistoryEntry, error) {
	if err := validateScopeID(scopeID); err != nil {
		return nil, err
	}
	if strings.TrimSpace(string(pageID)) == "" {
		return nil, errors.New("knowledge history: page_id is required")
	}
	history, err := s.store.LoadKnowledgeHistory(scopeID, string(pageID))
	if err != nil {
		return nil, err
	}
	if len(history) == 0 {
		page, err := s.loadOptional(scopeID, pageID)
		if err != nil {
			return nil, err
		}
		if page == nil {
			return nil, fmt.Errorf("knowledge history: page %s does not exist in scope %s", pageID, scopeID)
		}
	}
	return history, nil
}

func (s *KnowledgeService) PutRelation(rel knowledge.Relation) error {
	if err := knowledge.ValidateRelation(rel); err != nil {
		return fmt.Errorf("knowledge relation save: %w", err)
	}
	fromPage, err := s.Load(rel.ScopeID, rel.FromPageID)
	if err != nil {
		return err
	}
	if fromPage == nil {
		return fmt.Errorf("knowledge relation save: source page %s does not exist", rel.FromPageID)
	}
	toPage, err := s.Load(rel.ScopeID, rel.ToPageID)
	if err != nil {
		return err
	}
	if toPage == nil {
		return fmt.Errorf("knowledge relation save: target page %s does not exist", rel.ToPageID)
	}
	if fromPage.ScopeID != toPage.ScopeID || fromPage.ScopeID != rel.ScopeID {
		return errors.New("knowledge relation save: cross-scope relations are not allowed")
	}
	if !knowledgePageIsLiveForRelation(fromPage) {
		return fmt.Errorf("knowledge relation save: source page %s is not live", rel.FromPageID)
	}
	if !knowledgePageIsLiveForRelation(toPage) {
		return fmt.Errorf("knowledge relation save: target page %s is not live", rel.ToPageID)
	}
	return s.store.SaveKnowledgeRelation(rel)
}

func (s *KnowledgeService) DeleteRelation(scopeID string, fromPageID knowledge.PageID, toPageID knowledge.PageID, relationType string) error {
	if err := validateScopeID(scopeID); err != nil {
		return err
	}
	if strings.TrimSpace(string(fromPageID)) == "" || strings.TrimSpace(string(toPageID)) == "" {
		return errors.New("knowledge relation delete: page ids are required")
	}
	if strings.TrimSpace(relationType) == "" {
		return errors.New("knowledge relation delete: relation_type is required")
	}
	page, err := s.Load(scopeID, fromPageID)
	if err != nil {
		return err
	}
	if page == nil {
		return fmt.Errorf("knowledge relation delete: source page %s does not exist", fromPageID)
	}
	rels, err := s.store.ListKnowledgeRelations(scopeID, string(fromPageID))
	if err != nil {
		return err
	}
	found := false
	for _, rel := range rels {
		if rel.ToPageID == toPageID && rel.RelationType == relationType {
			found = true
			break
		}
	}
	if !found {
		return fmt.Errorf("knowledge relation delete: relation %s -> %s (%s) does not exist", fromPageID, toPageID, relationType)
	}
	return s.store.DeleteKnowledgeRelation(scopeID, string(fromPageID), string(toPageID), relationType)
}

func (s *KnowledgeService) ListRelations(scopeID string, pageID knowledge.PageID) ([]knowledge.Relation, error) {
	if err := validateScopeID(scopeID); err != nil {
		return nil, err
	}
	if strings.TrimSpace(string(pageID)) == "" {
		return nil, errors.New("knowledge list relations: page_id is required")
	}
	page, err := s.Load(scopeID, pageID)
	if err != nil {
		return nil, err
	}
	if page == nil {
		return nil, fmt.Errorf("knowledge list relations: page %s does not exist", pageID)
	}
	return s.store.ListKnowledgeRelations(scopeID, string(pageID))
}

func (s *KnowledgeService) ListBacklinks(scopeID string, pageID knowledge.PageID) ([]knowledge.Relation, error) {
	if err := validateScopeID(scopeID); err != nil {
		return nil, err
	}
	if strings.TrimSpace(string(pageID)) == "" {
		return nil, errors.New("knowledge list backlinks: page_id is required")
	}
	page, err := s.loadOptional(scopeID, pageID)
	if err != nil {
		return nil, err
	}
	if page == nil {
		return nil, fmt.Errorf("knowledge list backlinks: page %s does not exist", pageID)
	}
	return s.store.ListKnowledgeBacklinks(scopeID, string(pageID))
}

func (s *KnowledgeService) Traverse(scopeID string, rootPageID knowledge.PageID, depth int) ([]knowledge.TraversalHit, error) {
	if err := validateScopeID(scopeID); err != nil {
		return nil, err
	}
	if strings.TrimSpace(string(rootPageID)) == "" {
		return nil, errors.New("knowledge traverse: root_page_id is required")
	}
	if depth <= 0 {
		return nil, errors.New("knowledge traverse: depth must be > 0")
	}
	root, err := s.Load(scopeID, rootPageID)
	if err != nil {
		return nil, err
	}
	if root == nil {
		return nil, fmt.Errorf("knowledge traverse: root page %s does not exist", rootPageID)
	}
	type node struct {
		pageID       knowledge.PageID
		depth        int
		via          knowledge.PageID
		relationType string
		path         []knowledge.PageID
	}
	queue := []node{{pageID: rootPageID, depth: 0, path: []knowledge.PageID{rootPageID}}}
	visited := map[knowledge.PageID]bool{rootPageID: true}
	var hits []knowledge.TraversalHit
	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]
		if current.depth > 0 {
			hits = append(hits, knowledge.TraversalHit{
				PageID:       current.pageID,
				Depth:        current.depth,
				ViaPageID:    current.via,
				RelationType: current.relationType,
				Path:         append([]knowledge.PageID(nil), current.path...),
			})
		}
		if current.depth >= depth {
			continue
		}
		rels, err := s.ListRelations(scopeID, current.pageID)
		if err != nil {
			return nil, err
		}
		for _, rel := range rels {
			if visited[rel.ToPageID] {
				continue
			}
			visited[rel.ToPageID] = true
			nextPath := append(append([]knowledge.PageID(nil), current.path...), rel.ToPageID)
			queue = append(queue, node{
				pageID:       rel.ToPageID,
				depth:        current.depth + 1,
				via:          current.pageID,
				relationType: rel.RelationType,
				path:         nextPath,
			})
		}
	}
	return hits, nil
}

func (s *KnowledgeService) IngestDocument(scopeID string, env knowledge.IngestEnvelope) (*knowledge.IngestTask, error) {
	if err := validateScopeID(scopeID); err != nil {
		return nil, err
	}
	if err := knowledge.ValidateIngestEnvelope(env); err != nil {
		return nil, fmt.Errorf("knowledge ingest: %w", err)
	}
	now := s.clock.Now()
	taskID, err := identity.NewPrefixed("ingest")
	if err != nil {
		return nil, fmt.Errorf("knowledge ingest: %w", err)
	}
	task := knowledge.IngestTask{
		TaskID:          taskID,
		ScopeID:         scopeID,
		Status:          knowledge.IngestTaskStatusQueued,
		ProgressPercent: 0,
		PageID:          env.PageID,
		CreatedAt:       now,
		UpdatedAt:       now,
	}
	if err := s.store.SaveKnowledgeIngestTask(task); err != nil {
		return nil, err
	}
	go s.runIngestTask(task, env)
	return &task, nil
}

func (s *KnowledgeService) GetIngestTask(scopeID string, taskID string) (*knowledge.IngestTask, error) {
	if err := validateScopeID(scopeID); err != nil {
		return nil, err
	}
	if strings.TrimSpace(taskID) == "" {
		return nil, errors.New("knowledge get ingest task: task_id is required")
	}
	task, err := s.store.LoadKnowledgeIngestTask(scopeID, taskID)
	if err != nil {
		return nil, err
	}
	if task == nil {
		return nil, fmt.Errorf("knowledge get ingest task: task %s does not exist in scope %s", taskID, scopeID)
	}
	return task, nil
}

func (s *KnowledgeService) ListIDs(scopeID string) ([]string, error) {
	if err := validateScopeID(scopeID); err != nil {
		return nil, err
	}
	pages, err := s.List(scopeID)
	if err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(pages))
	for _, page := range pages {
		ids = append(ids, string(page.PageID))
	}
	return ids, nil
}

func (s *KnowledgeService) loadOptional(scopeID string, pageID knowledge.PageID) (*knowledge.Page, error) {
	if err := validateScopeID(scopeID); err != nil {
		return nil, err
	}
	if strings.TrimSpace(string(pageID)) == "" {
		return nil, errors.New("knowledge load: page_id is required")
	}
	page, err := loadOptionalKnowledgePage(s.store, scopeID, pageID)
	if err != nil {
		return nil, err
	}
	if page == nil {
		return nil, nil
	}
	return page, nil
}

func (s *KnowledgeService) archive(scopeID string, pageID knowledge.PageID, now time.Time) error {
	page, err := s.Load(scopeID, pageID)
	if err != nil {
		return err
	}
	if page.Lifecycle != knowledge.ProjectionLifecycleActive && page.Lifecycle != knowledge.ProjectionLifecycleStale {
		return fmt.Errorf("knowledge archive: page %s cannot transition from %s", pageID, page.Lifecycle)
	}
	page.Lifecycle = knowledge.ProjectionLifecycleArchived
	page.UpdatedAt = now
	return s.persistPage(*page)
}

func (s *KnowledgeService) remove(scopeID string, pageID knowledge.PageID, now time.Time) error {
	page, err := s.Load(scopeID, pageID)
	if err != nil {
		return err
	}
	if page.Lifecycle != knowledge.ProjectionLifecycleArchived {
		return fmt.Errorf("knowledge remove: page %s must be archived before remove", pageID)
	}
	blockers, err := s.refgraph.RemoveBlockers(scopeID, artifactref.KindKnowledgePage, string(pageID))
	if err != nil {
		return err
	}
	blocking := blockingDeleteBlockers(blockers)
	if len(blocking) > 0 {
		return fmt.Errorf("knowledge remove: page %s is blocked by %s", pageID, formatDeleteBlockers(blocking))
	}
	page.Lifecycle = knowledge.ProjectionLifecycleRemoved
	page.UpdatedAt = now
	return s.persistPage(*page)
}

func (s *KnowledgeService) persistPage(page knowledge.Page) error {
	if err := knowledge.ValidatePage(page); err != nil {
		return fmt.Errorf("knowledge persist: %w", err)
	}
	if err := validateKnowledgePageRelations(page); err != nil {
		return fmt.Errorf("knowledge persist: %w", err)
	}
	raw, err := json.Marshal(page)
	if err != nil {
		return fmt.Errorf("knowledge persist: %w", err)
	}
	return s.store.Save(page.ScopeID, storage.KindKnowledge, string(page.PageID), raw)
}

func validateKnowledgePageRelations(page knowledge.Page) error {
	for _, ref := range page.ArtifactRefs {
		if ref.ToKind == artifactref.KindKnowledgePage || isRelationRole(ref.Role) {
			return fmt.Errorf("page %s: page-embedded knowledge relations are not admitted", page.PageID)
		}
	}
	return nil
}

func isRelationRole(role string) bool {
	return strings.HasPrefix(role, "relation:")
}

func (s *KnowledgeService) markInterruptedIngestTasks() error {
	scopes, err := s.store.ListScopes()
	if err != nil {
		return err
	}
	now := s.clock.Now()
	for _, scopeID := range scopes {
		tasks, err := s.store.ListKnowledgeIngestTasks(scopeID)
		if err != nil {
			return err
		}
		for _, task := range tasks {
			if task.Status != knowledge.IngestTaskStatusQueued && task.Status != knowledge.IngestTaskStatusRunning {
				continue
			}
			task.Status = knowledge.IngestTaskStatusFailed
			task.Error = "interrupted before ingest task completion"
			task.UpdatedAt = now
			if err := s.store.SaveKnowledgeIngestTask(task); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *KnowledgeService) runIngestTask(task knowledge.IngestTask, env knowledge.IngestEnvelope) {
	running := task
	running.Status = knowledge.IngestTaskStatusRunning
	running.ProgressPercent = 25
	running.UpdatedAt = s.clock.Now()
	if err := s.store.SaveKnowledgeIngestTask(running); err != nil {
		s.persistFailedIngestTask(task, env.PageID, 25, fmt.Errorf("persist running task: %w", err))
		return
	}

	now := s.clock.Now()
	page := knowledge.Page{
		PageID:    env.PageID,
		ScopeID:   task.ScopeID,
		Kind:      env.Kind,
		Version:   1,
		Title:     env.Title,
		Body:      env.Body,
		Lifecycle: knowledge.ProjectionLifecycleActive,
		CreatedAt: now,
		UpdatedAt: now,
	}
	existing, err := s.loadOptional(task.ScopeID, env.PageID)
	if err != nil {
		s.persistFailedIngestTask(running, env.PageID, 25, err)
		return
	}
	if existing != nil {
		if !knowledgeLifecycleIsWriterOwned(existing.Lifecycle) {
			s.persistFailedIngestTask(running, env.PageID, 25, fmt.Errorf("page %s cannot be updated from %s", env.PageID, existing.Lifecycle))
			return
		}
		page.Version = existing.Version + 1
		page.CreatedAt = existing.CreatedAt
		page.Citations = existing.Citations
		page.SourceRefs = existing.SourceRefs
		page.ArtifactRefs = existing.ArtifactRefs
	}
	if err := validateKnowledgePageForWrite(s.store, page); err != nil {
		s.persistFailedIngestTask(running, env.PageID, 25, err)
		return
	}
	completed := running
	completed.Status = knowledge.IngestTaskStatusCompleted
	completed.ProgressPercent = 100
	completed.Error = ""
	completed.PageID = env.PageID
	completed.UpdatedAt = s.clock.Now()
	if err := s.store.SaveKnowledgePageAndIngestTask(page, completed); err != nil {
		s.persistFailedIngestTask(running, env.PageID, 100, fmt.Errorf("persist completed task: %w", err))
	}
}

func (s *KnowledgeService) persistFailedIngestTask(base knowledge.IngestTask, pageID knowledge.PageID, progress int, err error) {
	if err == nil {
		return
	}
	failed := base
	failed.Status = knowledge.IngestTaskStatusFailed
	failed.ProgressPercent = progress
	failed.Error = formatKnowledgeIngestError(err)
	failed.PageID = pageID
	failed.UpdatedAt = s.clock.Now()
	_ = s.store.SaveKnowledgeIngestTask(failed)
}

func formatKnowledgeIngestError(err error) string {
	if err == nil {
		return ""
	}
	if strings.HasPrefix(err.Error(), "knowledge ingest:") {
		return err.Error()
	}
	return "knowledge ingest: " + err.Error()
}
