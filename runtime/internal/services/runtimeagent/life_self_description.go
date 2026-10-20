package runtimeagent

type lifeSelfDescription struct {
	Outcome string `json:"outcome,omitempty"`
	Action  string `json:"action"`
	Object  string `json:"object"`
	Result  string `json:"result"`
}
