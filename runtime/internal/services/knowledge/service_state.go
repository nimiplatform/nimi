package knowledge

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"sort"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/encoding/protojson"
)

const knowledgeStateSchemaVersion = 1

type persistedKnowledgeState struct {
	SchemaVersion int                           `json:"schemaVersion"`
	SavedAt       string                        `json:"savedAt"`
	Banks         []persistedKnowledgeBankState `json:"banks"`
	Tasks         []persistedKnowledgeTaskState `json:"tasks,omitempty"`
}

type persistedKnowledgeBankState struct {
	Bank  json.RawMessage   `json:"bank"`
	Pages []json.RawMessage `json:"pages"`
	Links []json.RawMessage `json:"links,omitempty"`
}

type persistedKnowledgeTaskState struct {
	Task  json.RawMessage `json:"task"`
	AppID string          `json:"appId"`
}

func (s *Service) loadState() error {
	if s == nil || s.backend == nil {
		return nil
	}
	var schemaVersion int
	var snapshotRaw string
	err := s.backend.DB().QueryRow(`
		SELECT schema_version, snapshot_json
		FROM knowledge_snapshot
		WHERE singleton = 1
	`).Scan(&schemaVersion, &snapshotRaw)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil
		}
		return fmt.Errorf("load knowledge snapshot: %w", err)
	}
	if schemaVersion != knowledgeStateSchemaVersion {
		return fmt.Errorf("unsupported knowledge snapshot schema_version=%d", schemaVersion)
	}
	var snapshot persistedKnowledgeState
	if err := json.Unmarshal([]byte(snapshotRaw), &snapshot); err != nil {
		return fmt.Errorf("unmarshal knowledge snapshot: %w", err)
	}
	if snapshot.SchemaVersion != knowledgeStateSchemaVersion {
		return fmt.Errorf("unsupported knowledge snapshot schemaVersion=%d", snapshot.SchemaVersion)
	}
	for key := range s.banksByID {
		delete(s.banksByID, key)
	}
	for key := range s.bankIDByOwner {
		delete(s.bankIDByOwner, key)
	}
	for key := range s.ingestTasksByID {
		delete(s.ingestTasksByID, key)
	}
	for _, item := range snapshot.Banks {
		var bank runtimev1.KnowledgeBank
		if err := protojson.Unmarshal(item.Bank, &bank); err != nil {
			return fmt.Errorf("unmarshal knowledge bank: %w", err)
		}
		state := &bankState{
			Bank:       cloneKnowledgeBank(&bank),
			PagesByID:  make(map[string]*runtimev1.KnowledgePage, len(item.Pages)),
			SlugToPage: make(map[string]string, len(item.Pages)),
			LinksByID:  make(map[string]*runtimev1.KnowledgeLink, len(item.Links)),
		}
		for _, pageRaw := range item.Pages {
			var page runtimev1.KnowledgePage
			if err := protojson.Unmarshal(pageRaw, &page); err != nil {
				return fmt.Errorf("unmarshal knowledge page for bank %s: %w", bank.GetBankId(), err)
			}
			cloned := cloneKnowledgePage(&page)
			state.PagesByID[cloned.GetPageId()] = cloned
			if cloned.GetSlug() != "" {
				state.SlugToPage[cloned.GetSlug()] = cloned.GetPageId()
			}
		}
		for _, linkRaw := range item.Links {
			var link runtimev1.KnowledgeLink
			if err := protojson.Unmarshal(linkRaw, &link); err != nil {
				return fmt.Errorf("unmarshal knowledge link for bank %s: %w", bank.GetBankId(), err)
			}
			cloned := cloneKnowledgeLink(&link)
			state.LinksByID[cloned.GetLinkId()] = cloned
		}
		s.banksByID[state.Bank.GetBankId()] = state
		s.bankIDByOwner[locatorKey(state.Bank.GetLocator())] = state.Bank.GetBankId()
	}
	for _, item := range snapshot.Tasks {
		var task runtimev1.KnowledgeIngestTask
		if err := protojson.Unmarshal(item.Task, &task); err != nil {
			return fmt.Errorf("unmarshal knowledge ingest task: %w", err)
		}
		s.ingestTasksByID[task.GetTaskId()] = &ingestTaskState{
			Task:  cloneKnowledgeIngestTask(&task),
			AppID: item.AppID,
		}
	}
	return nil
}

func (s *Service) persistLocked() error {
	if s == nil || s.backend == nil {
		return nil
	}
	snapshot := persistedKnowledgeState{
		SchemaVersion: knowledgeStateSchemaVersion,
		SavedAt:       time.Now().UTC().Format(time.RFC3339Nano),
		Banks:         make([]persistedKnowledgeBankState, 0, len(s.banksByID)),
		Tasks:         make([]persistedKnowledgeTaskState, 0, len(s.ingestTasksByID)),
	}
	bankIDs := make([]string, 0, len(s.banksByID))
	for bankID := range s.banksByID {
		bankIDs = append(bankIDs, bankID)
	}
	sort.Strings(bankIDs)
	for _, bankID := range bankIDs {
		state := s.banksByID[bankID]
		if state == nil || state.Bank == nil {
			continue
		}
		bankRaw, err := protojson.Marshal(state.Bank)
		if err != nil {
			return fmt.Errorf("marshal knowledge bank %s: %w", bankID, err)
		}
		pageIDs := make([]string, 0, len(state.PagesByID))
		for pageID := range state.PagesByID {
			pageIDs = append(pageIDs, pageID)
		}
		sort.Strings(pageIDs)
		pageRaws := make([]json.RawMessage, 0, len(pageIDs))
		for _, pageID := range pageIDs {
			pageRaw, err := protojson.Marshal(state.PagesByID[pageID])
			if err != nil {
				return fmt.Errorf("marshal knowledge page %s: %w", pageID, err)
			}
			pageRaws = append(pageRaws, pageRaw)
		}
		linkIDs := make([]string, 0, len(state.LinksByID))
		for linkID := range state.LinksByID {
			linkIDs = append(linkIDs, linkID)
		}
		sort.Strings(linkIDs)
		linkRaws := make([]json.RawMessage, 0, len(linkIDs))
		for _, linkID := range linkIDs {
			linkRaw, err := protojson.Marshal(state.LinksByID[linkID])
			if err != nil {
				return fmt.Errorf("marshal knowledge link %s: %w", linkID, err)
			}
			linkRaws = append(linkRaws, linkRaw)
		}
		snapshot.Banks = append(snapshot.Banks, persistedKnowledgeBankState{
			Bank:  bankRaw,
			Pages: pageRaws,
			Links: linkRaws,
		})
	}
	taskIDs := make([]string, 0, len(s.ingestTasksByID))
	for taskID := range s.ingestTasksByID {
		taskIDs = append(taskIDs, taskID)
	}
	sort.Strings(taskIDs)
	for _, taskID := range taskIDs {
		state := s.ingestTasksByID[taskID]
		if state == nil || state.Task == nil {
			continue
		}
		taskRaw, err := protojson.Marshal(state.Task)
		if err != nil {
			return fmt.Errorf("marshal knowledge ingest task %s: %w", taskID, err)
		}
		snapshot.Tasks = append(snapshot.Tasks, persistedKnowledgeTaskState{
			Task:  taskRaw,
			AppID: state.AppID,
		})
	}
	payload, err := json.Marshal(snapshot)
	if err != nil {
		return fmt.Errorf("marshal knowledge snapshot: %w", err)
	}
	return s.backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
		if _, err := tx.Exec(`
			INSERT INTO knowledge_snapshot(singleton, schema_version, saved_at, snapshot_json)
			VALUES (1, ?, ?, ?)
			ON CONFLICT(singleton) DO UPDATE SET
				schema_version = excluded.schema_version,
				saved_at = excluded.saved_at,
				snapshot_json = excluded.snapshot_json
		`, knowledgeStateSchemaVersion, snapshot.SavedAt, string(payload)); err != nil {
			return fmt.Errorf("persist knowledge snapshot: %w", err)
		}
		return nil
	})
}
