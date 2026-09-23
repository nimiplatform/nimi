package appactivity

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

const maxSafeRevision = 1<<53 - 1

var (
	objectRefPattern    = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:~+=-]{0,255}$`)
	activityTypePattern = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+\.v[1-9][0-9]{0,5}$`)
	minOccurredAt       = time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC)
)

// publishInput is the validated, canonical publisher-supplied content.
type publishInput struct {
	Key          string
	Revision     uint64
	Kind         string
	TodoState    string
	Attention    bool
	Title        string
	Summary      string
	ObjectRef    string
	ActivityType string
	DataJSON     string
	OccurredAtMS int64
	AgentHandle  string
}

func validatePutRequest(req *runtimev1.PutAppActivityRequest, now time.Time) (publishInput, error) {
	if req == nil {
		return publishInput{}, fmt.Errorf("%w: request", ErrInvalidInput)
	}
	input := publishInput{
		Key: req.GetKey(), Revision: req.GetRevision(), Attention: req.GetAttention(),
		Title: req.GetTitle(), Summary: req.GetSummary(), ObjectRef: req.GetObjectRef(),
		ActivityType: req.GetActivityType(), AgentHandle: req.GetAgentHandle(),
	}
	if !boundedLine(input.Key, MaxKeyBytes) {
		return publishInput{}, fmt.Errorf("%w: key", ErrInvalidInput)
	}
	// Revisions stay within the exact JSON integer range of every carrier.
	if input.Revision == 0 || input.Revision > maxSafeRevision {
		return publishInput{}, fmt.Errorf("%w: revision", ErrInvalidInput)
	}
	switch req.GetKind() {
	case runtimev1.AppActivityKind_APP_ACTIVITY_KIND_ACTIVITY:
		input.Kind = kindActivity
		if req.GetTodoState() != runtimev1.AppActivityTodoState_APP_ACTIVITY_TODO_STATE_UNSPECIFIED {
			return publishInput{}, fmt.Errorf("%w: activity has no todo state", ErrInvalidInput)
		}
	case runtimev1.AppActivityKind_APP_ACTIVITY_KIND_TODO:
		input.Kind = kindTodo
		state, ok := todoStateText(req.GetTodoState())
		if !ok {
			return publishInput{}, fmt.Errorf("%w: todo state", ErrInvalidInput)
		}
		input.TodoState = state
		if input.ObjectRef == "" {
			return publishInput{}, fmt.Errorf("%w: todo requires an App source object", ErrInvalidInput)
		}
	default:
		return publishInput{}, fmt.Errorf("%w: kind", ErrInvalidInput)
	}
	if !boundedLine(input.Title, MaxTitleBytes) {
		return publishInput{}, fmt.Errorf("%w: title", ErrInvalidInput)
	}
	if input.Summary != "" && !boundedText(input.Summary, MaxSummaryBytes) {
		return publishInput{}, fmt.Errorf("%w: summary", ErrInvalidInput)
	}
	if input.ObjectRef != "" && !objectRefPattern.MatchString(input.ObjectRef) {
		return publishInput{}, fmt.Errorf("%w: object reference", ErrInvalidInput)
	}
	if len(input.ActivityType) > MaxActivityType || !activityTypePattern.MatchString(input.ActivityType) ||
		strings.HasPrefix(input.ActivityType, reservedRuntimeTypePrefix) {
		return publishInput{}, fmt.Errorf("%w: activity type", ErrInvalidInput)
	}
	data, err := canonicalDataJSON(req.GetDataJson())
	if err != nil {
		return publishInput{}, err
	}
	input.DataJSON = data
	occurred := req.GetOccurredAt()
	if occurred == nil || !occurred.IsValid() {
		return publishInput{}, fmt.Errorf("%w: occurred time", ErrInvalidInput)
	}
	occurredAt := occurred.AsTime()
	if occurredAt.Before(minOccurredAt) || occurredAt.After(now.Add(24*time.Hour)) {
		return publishInput{}, fmt.Errorf("%w: occurred time", ErrInvalidInput)
	}
	input.OccurredAtMS = occurredAt.UnixMilli()
	if input.AgentHandle != "" && !boundedLine(input.AgentHandle, 256) {
		return publishInput{}, fmt.Errorf("%w: Agent handle", ErrInvalidInput)
	}
	if encodedSize(input) > MaxRecordBytes {
		return publishInput{}, ErrTooLarge
	}
	return input, nil
}

func todoStateText(state runtimev1.AppActivityTodoState) (string, bool) {
	switch state {
	case runtimev1.AppActivityTodoState_APP_ACTIVITY_TODO_STATE_OPEN:
		return todoStateOpen, true
	case runtimev1.AppActivityTodoState_APP_ACTIVITY_TODO_STATE_COMPLETED:
		return todoStateCompleted, true
	case runtimev1.AppActivityTodoState_APP_ACTIVITY_TODO_STATE_CANCELLED:
		return todoStateCancelled, true
	default:
		return "", false
	}
}

// canonicalDataJSON accepts only a JSON object and re-encodes it with sorted
// keys so identical content hashes identically across retries.
func canonicalDataJSON(raw string) (string, error) {
	if raw == "" {
		return "", nil
	}
	if len(raw) > MaxDataJSONBytes*2 {
		return "", ErrTooLarge
	}
	if !utf8.ValidString(raw) {
		return "", fmt.Errorf("%w: data", ErrInvalidInput)
	}
	decoder := json.NewDecoder(strings.NewReader(raw))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return "", fmt.Errorf("%w: data", ErrInvalidInput)
	}
	if decoder.More() {
		return "", fmt.Errorf("%w: data", ErrInvalidInput)
	}
	if _, ok := value.(map[string]any); !ok {
		return "", fmt.Errorf("%w: data must be a JSON object", ErrInvalidInput)
	}
	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil {
		return "", fmt.Errorf("%w: data", ErrInvalidInput)
	}
	canonical := strings.TrimSuffix(buffer.String(), "\n")
	if len(canonical) > MaxDataJSONBytes {
		return "", ErrTooLarge
	}
	return canonical, nil
}

func encodedSize(input publishInput) int {
	return len(input.Key) + len(input.Title) + len(input.Summary) + len(input.ObjectRef) +
		len(input.ActivityType) + len(input.DataJSON) + 256
}

// contentHash covers every publisher-supplied field of one revision. Agent
// association is included as the resolved private reference.
func contentHash(input publishInput, agentLocalRef string) string {
	hash := sha256.New()
	for _, part := range []string{
		input.Kind, input.TodoState, strconv.FormatBool(input.Attention), input.Title, input.Summary,
		input.ObjectRef, input.ActivityType, input.DataJSON, strconv.FormatInt(input.OccurredAtMS, 10), agentLocalRef,
	} {
		_, _ = hash.Write([]byte(strconv.Itoa(len(part))))
		_, _ = hash.Write([]byte{':'})
		_, _ = hash.Write([]byte(part))
	}
	return hex.EncodeToString(hash.Sum(nil))
}

// boundedLine accepts non-empty trimmed single-line text without control
// characters.
func boundedLine(value string, maxBytes int) bool {
	if value == "" || len(value) > maxBytes || value != strings.TrimSpace(value) || !utf8.ValidString(value) {
		return false
	}
	for _, r := range value {
		if r < 0x20 || r == 0x7f {
			return false
		}
	}
	return true
}

// boundedText accepts trimmed plain text that may contain line breaks and tabs.
func boundedText(value string, maxBytes int) bool {
	if value == "" || len(value) > maxBytes || value != strings.TrimSpace(value) || !utf8.ValidString(value) {
		return false
	}
	for _, r := range value {
		if (r < 0x20 && r != '\n' && r != '\t') || r == 0x7f {
			return false
		}
	}
	return true
}

func validActivityID(value string) bool {
	return strings.HasPrefix(value, "act_") && boundedLine(value, 64)
}
