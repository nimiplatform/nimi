package localservice

import runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"

// localAssetHealth is Runtime-private process/asset diagnostic state. It is
// never projected through RuntimeLocalService.
type localAssetHealth struct {
	LocalAssetId string
	Status       runtimev1.LocalAssetStatus
	Detail       string
	Endpoint     string
	ReasonCode   runtimev1.ReasonCode
}

func (h *localAssetHealth) GetLocalAssetId() string {
	if h == nil {
		return ""
	}
	return h.LocalAssetId
}

func (h *localAssetHealth) GetStatus() runtimev1.LocalAssetStatus {
	if h == nil {
		return runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNSPECIFIED
	}
	return h.Status
}

func (h *localAssetHealth) GetDetail() string {
	if h == nil {
		return ""
	}
	return h.Detail
}

func (h *localAssetHealth) GetEndpoint() string {
	if h == nil {
		return ""
	}
	return h.Endpoint
}

func (h *localAssetHealth) GetReasonCode() runtimev1.ReasonCode {
	if h == nil {
		return runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED
	}
	return h.ReasonCode
}
