package nimillm

// ReasoningCapability describes the typed reasoning features a backend can
// satisfy without silently collapsing reasoning into normal text output.
type ReasoningCapability struct {
	SupportsModeToggle   bool
	SupportsSeparateText bool
	SupportsStreaming    bool
	SupportsBudget       bool
}

func UnsupportedReasoningCapability() ReasoningCapability {
	return ReasoningCapability{}
}

func OllamaReasoningCapability() ReasoningCapability {
	return ReasoningCapability{
		SupportsModeToggle:   true,
		SupportsSeparateText: true,
		SupportsStreaming:    true,
		SupportsBudget:       false,
	}
}

// TextStreamEventHandler keeps text and reasoning deltas distinct so runtime
// can preserve a typed stream contract end-to-end.
type TextStreamEventHandler struct {
	OnText      func(string) error
	OnReasoning func(string) error
}
