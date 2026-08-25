// Package textwire owns the closed provider-neutral directives passed from an
// exact Capability Driver to a provider dialect adapter.
package textwire

type ReasoningToggle uint8

const (
	ReasoningToggleUnspecified ReasoningToggle = iota
	ReasoningToggleDisabled
)

type Directives struct {
	ReasoningToggle ReasoningToggle
}

func (d Directives) Empty() bool {
	return d.ReasoningToggle == ReasoningToggleUnspecified
}

func (d Directives) Valid() bool {
	return d.ReasoningToggle == ReasoningToggleUnspecified ||
		d.ReasoningToggle == ReasoningToggleDisabled
}
