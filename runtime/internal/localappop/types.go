package localappop

// AuthorityClass is retained only as an internal owner handoff shape while
// protected App access is unavailable. IMP2 supplies the canonical operation
// map and admission evaluator.
type AuthorityClass string

const (
	AuthorityClassBase      AuthorityClass = "base"
	AuthorityClassAppAccess AuthorityClass = "app_access"
)

type Selector struct {
	AgentID              string
	ConversationAnchorID string
	TurnID               string
	VoiceStreamID        string
	StorageRelativePath  string
}
