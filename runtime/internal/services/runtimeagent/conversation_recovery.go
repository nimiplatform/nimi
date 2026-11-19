package runtimeagent

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

// @nimi-authority: rule.nimi.runtime.agent-participation.r175
// Recovery is owned by the original turn. It contains no successful assistant
// result, raw provider stream or independent receipt/index lifecycle.
type publicChatTurnRecovery struct {
	SelfIntention        *selfIntentionResult     `json:"selfIntention,omitempty"`
	TurnID               string                   `json:"turnId"`
	RegisteredAppSubject string                   `json:"registeredAppSubject,omitempty"`
	RequestID            string                   `json:"requestId,omitempty"`
	Fingerprint          string                   `json:"fingerprint"`
	InputTurnID          string                   `json:"inputTurnId"`
	RetryOfTurnID        string                   `json:"retryOfTurnId,omitempty"`
	Input                *publicChatRecoveryInput `json:"input,omitempty"`
	PublicText           string                   `json:"publicText,omitempty"`
	AcceptedAt           time.Time                `json:"acceptedAt"`
}

type publicChatRecoveryInput struct {
	Quote      *publicChatMessageQuote                  `json:"quote,omitempty"`
	Role       string                                   `json:"role"`
	Text       string                                   `json:"text"`
	Attachment *publicChatCommittedTranscriptAttachment `json:"attachment,omitempty"`
}

func clonePublicChatRecoveryInput(input *publicChatRecoveryInput) *publicChatRecoveryInput {
	if input == nil {
		return nil
	}
	out := *input
	out.Quote = clonePublicChatQuote(input.Quote)
	if input.Attachment != nil {
		value := *input.Attachment
		out.Attachment = &value
	}
	return &out
}

func clonePublicChatRecoveries(input map[string]*publicChatTurnRecovery) map[string]*publicChatTurnRecovery {
	out := make(map[string]*publicChatTurnRecovery, len(input))
	for id, item := range input {
		if item == nil {
			continue
		}
		out[id] = cloneConversationRecovery(item)
	}
	return out
}

func cloneConversationRecovery(item *publicChatTurnRecovery) *publicChatTurnRecovery {
	copied := *item
	if item.SelfIntention != nil {
		result := *item.SelfIntention
		copied.SelfIntention = &result
	}
	copied.Input = clonePublicChatRecoveryInput(item.Input)
	return &copied
}

func publicChatRequestFingerprint(messages []publicChatMessagePayload, retryOf string) string {
	type normalizedMessage struct {
		Role, Text string
		Artifacts  []string
		Quote      *publicChatQuoteSelector `json:",omitempty"`
	}
	value := struct {
		RetryOf  string
		Messages []normalizedMessage
	}{RetryOf: strings.TrimSpace(retryOf)}
	if value.RetryOf == "" {
		for _, message := range messages {
			item := normalizedMessage{Role: strings.TrimSpace(message.Role), Text: strings.TrimSpace(message.Content)}
			item.Quote = message.quoteSelector
			for _, attachment := range message.Attachments {
				item.Artifacts = append(item.Artifacts, strings.TrimSpace(attachment.ArtifactID))
			}
			value.Messages = append(value.Messages, item)
		}
	}
	raw, _ := json.Marshal(value)
	digest := sha256.Sum256(raw)
	return hex.EncodeToString(digest[:])
}

func (s *Service) findPublicChatRequest(ctx context.Context, anchor *publicChatAnchorState, subject, requestID string) (*publicChatTurnRecovery, error) {
	if anchor == nil || subject == "" || requestID == "" {
		return nil, nil
	}
	var id, raw string
	err := s.backend.DB().QueryRowContext(ctx, `SELECT turn_id,recovery_json FROM runtime_conversation_recovery WHERE anchor_id=?
   AND json_extract(recovery_json,'$.registeredAppSubject')=? AND json_extract(recovery_json,'$.requestId')=?`, anchor.ConversationAnchorID, subject, requestID).Scan(&id, &raw)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return decodeConversationRecovery(raw, id)
}

// The original input is held here until a complete answer commits. Thereafter
// the canonical transcript supplies that immutable input, not a second copy.
func publicChatRecoveryInputForTurn(anchor *publicChatAnchorState, item *publicChatTurnRecovery) *publicChatRecoveryInput {
	if anchor == nil || item == nil {
		return nil
	}
	if input := anchor.windowInputs[item.InputTurnID]; input != nil {
		return clonePublicChatRecoveryInput(input)
	}
	original := anchor.Recoveries[item.InputTurnID]
	if original != nil && original.Input != nil {
		return clonePublicChatRecoveryInput(original.Input)
	}
	for _, turn := range anchor.CommittedTranscript {
		if firstNonEmpty(turn.InputTurnID, turn.TurnID) != item.InputTurnID {
			continue
		}
		return recoveryInputFromTranscript(turn)
	}
	return nil
}

func recoveryInputFromTranscript(turn publicChatCommittedTranscriptTurn) *publicChatRecoveryInput {
	role := "user"
	if isProactiveOrigin(turn.Origin) {
		role = publicChatInternalFollowUpInstructionRole
	}
	return clonePublicChatRecoveryInput(&publicChatRecoveryInput{Role: role, Text: turn.InputText, Attachment: turn.InputAttachment, Quote: turn.InputQuote})
}

func (s *Service) reusedPublicChatAdmission(ctx context.Context, anchor *publicChatAnchorState, req publicChatTurnRequestPayload) (publicChatTurnState, bool, error) {
	item, err := s.findPublicChatRequest(ctx, anchor, req.RegisteredAppSubject, strings.TrimSpace(req.RequestID))
	if err != nil {
		return publicChatTurnState{}, false, err
	}
	if item == nil {
		return publicChatTurnState{}, false, nil
	}
	if item.Fingerprint != publicChatRequestFingerprint(req.Messages, req.RetryOfTurnID) {
		return publicChatTurnState{}, false, localAppConversationInvalid("requestId already belongs to different input")
	}
	return publicChatTurnState{TurnID: item.TurnID, RequestID: item.RequestID, AdmissionReused: true}, true, nil
}

func newPublicChatTurnRecovery(turn publicChatTurnState, req publicChatTurnRequestPayload, anchor *publicChatAnchorState) *publicChatTurnRecovery {
	if len(req.Messages) != 1 {
		return nil
	}
	item := &publicChatTurnRecovery{
		TurnID: turn.TurnID, RegisteredAppSubject: req.RegisteredAppSubject,
		RequestID: strings.TrimSpace(req.RequestID), Fingerprint: publicChatRequestFingerprint(req.Messages, req.RetryOfTurnID),
		InputTurnID: turn.TurnID, RetryOfTurnID: req.RetryOfTurnID, AcceptedAt: turn.TimelineStartedAt,
	}
	if req.RetryOfTurnID != "" {
		item.InputTurnID = anchor.Recoveries[req.RetryOfTurnID].InputTurnID
		return item
	}
	message := req.Messages[0]
	item.Input = &publicChatRecoveryInput{Role: strings.TrimSpace(message.Role), Text: strings.TrimSpace(message.Content)}
	item.Input.Quote = clonePublicChatQuote(message.quote)
	if len(req.resolvedAttachments) == 1 {
		attachment := req.resolvedAttachments[0]
		item.Input.Attachment = &publicChatCommittedTranscriptAttachment{ArtifactID: attachment.ArtifactID, MimeType: attachment.MimeType, DisplayName: attachment.DisplayName}
	}
	return item
}

// Regeneration is restricted to the latest unanswered admission. Its exact
// original input may precede the selected execution history.
func (s *Service) retryInputLocked(ctx context.Context, a *publicChatAnchorState, id string) (*publicChatRecoveryInput, error) {
	refused := func() error {
		return localAppConversationInvalid("This turn cannot be regenerated. Continue with a new message.")
	}
	if a == nil || a.ActiveTurnID != "" || a.LatestAcceptedTurnID != id {
		return nil, refused()
	}
	tx, err := s.backend.DB().BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	var raw string
	var answered bool
	err = tx.QueryRowContext(ctx, `SELECT r.recovery_json,coalesce(t.answered,0) FROM runtime_conversation_recovery r
 LEFT JOIN runtime_conversation_turn t ON t.anchor_id=r.anchor_id AND t.turn_id=r.turn_id WHERE r.anchor_id=? AND r.turn_id=?`, a.ConversationAnchorID, id).Scan(&raw, &answered)
	if err == sql.ErrNoRows || err == nil && answered {
		return nil, refused()
	}
	if err != nil {
		return nil, err
	}
	recovery, err := decodeConversationRecovery(raw, id)
	if err != nil {
		return nil, err
	}
	original := recovery
	if recovery.InputTurnID != id {
		if err := tx.QueryRowContext(ctx, `SELECT recovery_json FROM runtime_conversation_recovery WHERE anchor_id=? AND turn_id=?`, a.ConversationAnchorID, recovery.InputTurnID).Scan(&raw); err == nil {
			original, err = decodeConversationRecovery(raw, recovery.InputTurnID)
			if err != nil {
				return nil, err
			}
		} else if err != sql.ErrNoRows {
			return nil, err
		}
	}
	input := original.Input
	if input == nil {
		input, err = readOriginalConversationInput(ctx, tx, a.ConversationAnchorID, recovery.InputTurnID)
		if err != nil {
			return nil, err
		}
	}
	if input == nil || input.Role != "user" {
		return nil, refused()
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	if a.Recoveries == nil {
		a.Recoveries = make(map[string]*publicChatTurnRecovery)
	}
	a.Recoveries[id] = recovery
	a.Recoveries[original.TurnID] = original
	if a.windowInputs == nil {
		a.windowInputs = make(map[string]*publicChatRecoveryInput)
	}
	a.windowInputs[recovery.InputTurnID] = input
	return clonePublicChatRecoveryInput(input), nil
}

func publicChatHasCompleteAnswer(anchor *publicChatAnchorState, turnID string) bool {
	for _, turn := range anchor.CommittedTranscript {
		if turn.TurnID == turnID && strings.TrimSpace(turn.AssistantText) != "" {
			return true
		}
	}
	return false
}

func publicChatCanRegenerate(anchor *publicChatAnchorState, turnID string) bool {
	if anchor == nil || anchor.ActiveTurnID != "" || anchor.LatestAcceptedTurnID != turnID || publicChatHasCompleteAnswer(anchor, turnID) {
		return false
	}
	item := anchor.Recoveries[turnID]
	input := publicChatRecoveryInputForTurn(anchor, item)
	return item != nil && input != nil && input.Role == "user"
}

func localAppConversationPartialMessage(item *publicChatTurnRecovery) *runtimev1.LocalAppConversationMessage {
	message := localAppConversationTextMessage(item.TurnID, runtimev1.LocalAppConversationMessageRole_LOCAL_APP_CONVERSATION_MESSAGE_ROLE_ASSISTANT, item.PublicText)
	message.Partial = true
	message.Parts[0].GetText().Text = item.PublicText
	return message
}

func publicChatCompletionNotice(reason runtimev1.ReasonCode) *string {
	if reason == runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
		return nil
	}
	message := "The reply was saved; check the status of any optional results."
	if reason == runtimev1.ReasonCode_AI_OUTPUT_INVALID {
		message = "The reply was saved, but its attached operation was not executed."
	}
	return &message
}

func (s *Service) localAppAdmittedInputMessage(anchorID, turnID string) *runtimev1.LocalAppConversationMessage {
	s.chatSurfaceMu.Lock()
	defer s.chatSurfaceMu.Unlock()
	anchor := s.chatAnchors[anchorID]
	if anchor == nil {
		return nil
	}
	item := anchor.Recoveries[turnID]
	input := publicChatRecoveryInputForTurn(anchor, item)
	if input == nil || input.Role != "user" {
		return nil
	}
	return localAppConversationUserMessage(publicChatCommittedTranscriptTurn{TurnID: item.InputTurnID, Origin: publicChatTurnOriginUser, InputText: input.Text, InputAttachment: input.Attachment, InputQuote: input.Quote})
}

func persistPublicChatRecoveryTx(tx *sql.Tx, anchorID string, version uint64, item *publicChatTurnRecovery, register bool) error {
	if item == nil || item.TurnID == "" {
		return fmt.Errorf("conversation recovery identity missing")
	}
	if register {
		var input *publicChatCommittedTranscriptAttachment
		if item.Input != nil {
			input = item.Input.Attachment
		}
		if err := indexConversationMessageRefs(tx, anchorID, item.TurnID, item.InputTurnID, input, nil); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO runtime_conversation_projection(anchor_id,turn_id,accepted_order) VALUES(?,?,?)
		ON CONFLICT(anchor_id,turn_id) DO UPDATE SET accepted_order=excluded.accepted_order WHERE accepted_order IS NULL`, anchorID, item.TurnID, conversationOrderTime(item.AcceptedAt)); err != nil {
			return err
		}
	}
	raw, err := json.Marshal(item)
	if err != nil {
		return err
	}
	var inputBytes any
	if input := item.Input; input != nil && input.Role == "user" {
		inputBytes = conversationMessageContentBytes(localAppConversationUserMessage(publicChatCommittedTranscriptTurn{TurnID: item.InputTurnID, Origin: publicChatTurnOriginUser, InputText: input.Text, InputAttachment: input.Attachment, InputQuote: input.Quote}))
	}
	_, err = tx.Exec(`INSERT INTO runtime_conversation_recovery(anchor_id,turn_id,version,input_turn_id,input_bytes,public_bytes,recovery_json) VALUES(?,?,?,?,?,?,?)
		ON CONFLICT(anchor_id,turn_id) DO UPDATE SET version=excluded.version,input_bytes=excluded.input_bytes,public_bytes=excluded.public_bytes,recovery_json=excluded.recovery_json
		WHERE version<=excluded.version AND recovery_json<>excluded.recovery_json`, anchorID, item.TurnID, version, item.InputTurnID, inputBytes, len(item.PublicText), string(raw))
	return err
}

func decodeConversationRecovery(raw, turnID string) (*publicChatTurnRecovery, error) {
	var item publicChatTurnRecovery
	if err := decodeConversationRow(raw, &item); err != nil {
		return nil, err
	}
	if item.TurnID != turnID || !validLocalAppConversationSelector(turnID) ||
		!validLocalAppConversationSelector(item.InputTurnID) || len(item.Fingerprint) != 64 ||
		item.AcceptedAt.IsZero() || (item.PublicText != "" && !validLocalAppConversationTextDelta(item.PublicText, localAppConversationMaxTextBytes)) {
		return nil, fmt.Errorf("conversation recovery identity or bounds invalid")
	}
	if _, err := hex.DecodeString(item.Fingerprint); err != nil {
		return nil, fmt.Errorf("conversation recovery fingerprint invalid")
	}
	if item.Input != nil {
		if err := validateStoredConversationQuote(item.Input.Quote); err != nil {
			return nil, err
		}
	}
	return &item, nil
}

func readPublicChatRecoveries(db conversationRowReader, snapshot *persistedPublicChatSurfaceState, indices map[string]int, scope string) error {
	where, args := conversationAnchorPredicate(scope)
	rows, err := db.Query(`SELECT anchor_id,turn_id,recovery_json FROM runtime_conversation_recovery WHERE 1=1`+where+" ORDER BY anchor_id,turn_id", args...)
	if err != nil {
		return err
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var anchorID, turnID, raw string
		if err := rows.Scan(&anchorID, &turnID, &raw); err != nil {
			return err
		}
		index, ok := indices[anchorID]
		if !ok {
			return fmt.Errorf("orphaned conversation recovery")
		}
		item, err := decodeConversationRecovery(raw, turnID)
		if err != nil {
			return err
		}
		anchor := &snapshot.Anchors[index]
		if anchor.Recoveries == nil {
			anchor.Recoveries = make(map[string]*publicChatTurnRecovery)
		}
		anchor.Recoveries[turnID] = item
	}
	return rows.Err()
}

// @nimi-authority: rule.nimi.runtime.agent-participation.r176
// Called under the publication mutex. Only the changed turn's public prefix
// is written; previous transcript and completed snapshot payloads are not
// serialized for each delta. The owner lock covers commit and read visibility.
func (s *Service) commitLocalAppConversationPublication(anchorID string, sequence uint64, events []*runtimev1.LocalAppConversationEvent) error {
	s.chatSurfaceMu.Lock()
	defer s.chatSurfaceMu.Unlock()
	anchor := s.chatAnchors[anchorID]
	if anchor == nil || s.agentTerminationFencedLocked(anchor.LocalAgentRef) || sequence == 0 || anchor.LocalAppSequence+1 != sequence || s.chatStateRepo == nil || s.chatStateRepo.backend == nil {
		return localAppConversationOwnerUnavailable()
	}
	last := sequence
	changes := make(map[string]*publicChatTurnRecovery)
	for index, event := range events {
		if event == nil || event.Sequence != sequence+uint64(index) || event.Sequence < sequence {
			return localAppConversationOwnerUnavailable()
		}
		last = event.Sequence
		if delta := event.GetTextDelta(); delta != nil {
			turn := s.chatTurns[delta.TurnId]
			if turn == nil || turn.Interrupted || anchor.ActiveTurnID != delta.TurnId {
				return localAppConversationOwnerUnavailable()
			}
			if publicChatHasCompleteAnswer(anchor, delta.TurnId) {
				continue
			}
			item := changes[delta.TurnId]
			if item == nil {
				original := anchor.Recoveries[delta.TurnId]
				if original == nil {
					return localAppConversationOwnerUnavailable()
				}
				copy := *original
				item = &copy
				changes[item.TurnID] = item
			}
			item.PublicText += delta.Delta
			if !validLocalAppConversationTextDelta(item.PublicText, localAppConversationMaxTextBytes) {
				return localAppConversationOwnerUnavailable()
			}
		}
	}
	version := s.chatSurfaceVersion + 1
	if version == 0 {
		return localAppConversationOwnerUnavailable()
	}
	err := s.chatStateRepo.backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
		updated, err := tx.Exec(`UPDATE runtime_conversation_anchor SET through_sequence=? WHERE anchor_id=? AND anchor_json IS NOT NULL AND through_sequence<?`, last, anchorID, last)
		if err != nil {
			return err
		}
		if count, err := updated.RowsAffected(); err != nil || count != 1 {
			return fmt.Errorf("conversation publication lost its owner fence")
		}
		for _, item := range changes {
			if err := persistPublicChatRecoveryTx(tx, anchorID, version, item, false); err != nil {
				return err
			}
		}
		_, err = tx.Exec(`INSERT INTO runtime_local_agent_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(value AS INTEGER)<=?`, runtimeAgentMetaPublicChatSurfaceVersionKey, encodeSequenceValue(version), version)
		return err
	})
	if err != nil {
		return fmt.Errorf("persist public Conversation prefix: %w", err)
	}
	for id, item := range changes {
		anchor.Recoveries[id] = item
	}
	anchor.LocalAppSequence = last
	s.chatSurfaceVersion = version
	return nil
}
