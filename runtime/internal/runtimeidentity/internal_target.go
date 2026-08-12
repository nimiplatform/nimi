package runtimeidentity

import "strings"

// LocalTarget is a Runtime-private persisted identity. It is never serialized
// through the public Scenario, VoiceAsset, Memory, or LocalAsset protobufs.
type LocalTarget struct {
	ProfileBindingID string `json:"profileBindingId,omitempty"`
	ReadinessRef     string `json:"readinessRef,omitempty"`
}

func (t *LocalTarget) GetVersion() string {
	if t == nil {
		return ""
	}
	return "v2"
}

func (t *LocalTarget) GetProfileBindingId() string {
	if t == nil {
		return ""
	}
	return t.ProfileBindingID
}

func (t *LocalTarget) GetReadinessRef() string {
	if t == nil {
		return ""
	}
	return t.ReadinessRef
}

func (t *LocalTarget) Clone() *LocalTarget {
	if t == nil {
		return nil
	}
	return &LocalTarget{
		ProfileBindingID: strings.TrimSpace(t.ProfileBindingID),
		ReadinessRef:     strings.TrimSpace(t.ReadinessRef),
	}
}

func (t *LocalTarget) Valid() bool {
	if t == nil {
		return false
	}
	profileBindingID := strings.TrimSpace(t.ProfileBindingID)
	readinessRef := strings.TrimSpace(t.ReadinessRef)
	return t.ProfileBindingID == profileBindingID && t.ReadinessRef == readinessRef &&
		(profileBindingID != "") != (readinessRef != "")
}

// CloudTarget is the exact Runtime-private connector/model binding captured
// from Nimi-owned AIConfig and current-account Connector resolution before
// execution.
type CloudTarget struct {
	ConnectorID          string `json:"connectorId"`
	RemoteModelCatalogID string `json:"remoteModelCatalogId"`
	ProviderModelID      string `json:"providerModelId"`
	Provider             string `json:"provider"`
}

func (t *CloudTarget) GetVersion() string {
	if t == nil {
		return ""
	}
	return "v2"
}

func (t *CloudTarget) GetConnectorId() string {
	if t == nil {
		return ""
	}
	return t.ConnectorID
}

func (t *CloudTarget) GetRemoteModelCatalogId() string {
	if t == nil {
		return ""
	}
	return t.RemoteModelCatalogID
}

func (t *CloudTarget) GetProviderModelId() string {
	if t == nil {
		return ""
	}
	return t.ProviderModelID
}

func (t *CloudTarget) GetProvider() string {
	if t == nil {
		return ""
	}
	return t.Provider
}

func (t *CloudTarget) Clone() *CloudTarget {
	if t == nil {
		return nil
	}
	return &CloudTarget{
		ConnectorID:          strings.TrimSpace(t.ConnectorID),
		RemoteModelCatalogID: strings.TrimSpace(t.RemoteModelCatalogID),
		ProviderModelID:      strings.TrimSpace(t.ProviderModelID),
		Provider:             strings.TrimSpace(t.Provider),
	}
}

func (t *CloudTarget) Valid() bool {
	return t != nil &&
		t.ConnectorID == strings.TrimSpace(t.ConnectorID) && t.ConnectorID != "" &&
		t.RemoteModelCatalogID == strings.TrimSpace(t.RemoteModelCatalogID) && t.RemoteModelCatalogID != "" &&
		t.ProviderModelID == strings.TrimSpace(t.ProviderModelID) && t.ProviderModelID != "" &&
		t.Provider == strings.TrimSpace(t.Provider) && t.Provider != ""
}

// Target is a closed Runtime-private route binding. Exactly one variant must
// be present.
type Target struct {
	Local *LocalTarget `json:"local,omitempty"`
	Cloud *CloudTarget `json:"cloud,omitempty"`
}

func (t *Target) GetTarget() any {
	if t == nil {
		return nil
	}
	if t.Local != nil {
		return t.Local
	}
	if t.Cloud != nil {
		return t.Cloud
	}
	return nil
}

func (t *Target) GetLocalRuntime() *LocalTarget {
	if t == nil {
		return nil
	}
	return t.Local
}

func (t *Target) GetCloud() *CloudTarget {
	if t == nil {
		return nil
	}
	return t.Cloud
}

func (t *Target) Clone() *Target {
	if t == nil {
		return nil
	}
	return &Target{Local: t.Local.Clone(), Cloud: t.Cloud.Clone()}
}

func (t *Target) Valid() bool {
	if t == nil || (t.Local != nil) == (t.Cloud != nil) {
		return false
	}
	if t.Local != nil {
		return t.Local.Valid()
	}
	return t.Cloud.Valid()
}

func Equal(left, right *Target) bool {
	if left == nil || right == nil {
		return left == right
	}
	if left.Local != nil || right.Local != nil {
		return left.Local != nil && right.Local != nil &&
			left.Local.ProfileBindingID == right.Local.ProfileBindingID &&
			left.Local.ReadinessRef == right.Local.ReadinessRef
	}
	return left.Cloud != nil && right.Cloud != nil &&
		left.Cloud.ConnectorID == right.Cloud.ConnectorID &&
		left.Cloud.RemoteModelCatalogID == right.Cloud.RemoteModelCatalogID &&
		left.Cloud.ProviderModelID == right.Cloud.ProviderModelID &&
		left.Cloud.Provider == right.Cloud.Provider
}

// ResolvedLocalBinding is the private aggregate used by legacy profile and
// Runtime cognition internals while those domains migrate to capability
// configurations. It is not a public response projection.
type ResolvedLocalBinding struct {
	ProfileBindingID   string
	ReadinessRef       string
	LocalAssetID       string
	ExecutionProfileID string
	ResolvedModelID    string
}

func (b *ResolvedLocalBinding) GetProfileBindingId() string {
	if b == nil {
		return ""
	}
	return b.ProfileBindingID
}

func (b *ResolvedLocalBinding) GetReadinessRef() string {
	if b == nil {
		return ""
	}
	return b.ReadinessRef
}

func (b *ResolvedLocalBinding) GetLocalAssetId() string {
	if b == nil {
		return ""
	}
	return b.LocalAssetID
}

func (b *ResolvedLocalBinding) GetExecutionProfileId() string {
	if b == nil {
		return ""
	}
	return b.ExecutionProfileID
}

func (b *ResolvedLocalBinding) GetResolvedModelId() string {
	if b == nil {
		return ""
	}
	return b.ResolvedModelID
}
