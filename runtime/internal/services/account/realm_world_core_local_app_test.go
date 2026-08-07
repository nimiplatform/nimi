package account

import (
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestLocalAppWorldCoreListProjectsOnlyExactDTOs(t *testing.T) {
	response := projectLocalAppWorldCoreListResponse(&runtimev1.InvokeRealmUnaryResponse{
		Accepted: true, ResponseJson: "[" + validLocalAppWorldCoreJSON("world-1") + "]",
		ReasonCode:        runtimev1.ReasonCode_ACTION_EXECUTED,
		AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED,
		HttpStatus:        200,
	})
	if !response.GetAccepted() || response.GetReasonCode() != runtimev1.ReasonCode_ACTION_EXECUTED ||
		!strings.Contains(response.GetResponseJson(), `"id":"world-1"`) {
		t.Fatalf("exact WorldCore projection = %+v", response)
	}
}

func TestLocalAppWorldCoreCreateProjectsOnlyOneExactDTO(t *testing.T) {
	response := projectLocalAppWorldCoreCreateResponse(&runtimev1.InvokeRealmUnaryResponse{
		Accepted: true, ResponseJson: validLocalAppWorldCoreJSON("world-created"),
		ReasonCode:        runtimev1.ReasonCode_ACTION_EXECUTED,
		AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED,
		HttpStatus:        201,
	})
	if !response.GetAccepted() || response.GetReasonCode() != runtimev1.ReasonCode_ACTION_EXECUTED ||
		!strings.Contains(response.GetResponseJson(), `"id":"world-created"`) {
		t.Fatalf("exact created WorldCore projection = %+v", response)
	}
}

func TestLocalAppWorldCoreListRejectsUnknownMissingAndCredentialAdjacentDTOsWithoutRawBody(t *testing.T) {
	valid := validLocalAppWorldCoreJSON("world-1")
	for name, raw := range map[string]string{
		"unknown":    strings.Replace(valid, `"id":"world-1"`, `"id":"world-1","privateField":"private"`, 1),
		"missing":    strings.Replace(valid, `,"authoring":{"source":"manual"}`, ``, 1),
		"duplicate":  strings.Replace(valid, `"id":"world-1"`, `"id":"world-1","id":"other"`, 1),
		"signed uri": strings.Replace(valid, `"resourceRefs":[]`, `"resourceRefs":[],"externalRefs":[{"refId":"asset","kind":"image","uri":"https://cdn.example/a.png?token=secret"}]`, 1),
	} {
		t.Run(name, func(t *testing.T) {
			response := projectLocalAppWorldCoreListResponse(&runtimev1.InvokeRealmUnaryResponse{
				Accepted: true, ResponseJson: "[" + raw + "]",
				ReasonCode:        runtimev1.ReasonCode_ACTION_EXECUTED,
				AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED,
				HttpStatus:        200,
			})
			if response.GetAccepted() || response.GetResponseJson() != "" ||
				response.GetReasonCode() != runtimev1.ReasonCode_REALM_CONTRACT_INVALID ||
				response.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_CONTRACT_FAILED ||
				strings.Contains(response.GetErrorMessage(), "private") || strings.Contains(response.GetErrorMessage(), "token") {
				t.Fatalf("%s response = %+v", name, response)
			}
		})
	}
}

func TestLocalAppWorldCoreCreateRejectsMalformedAndCredentialAdjacentDTOs(t *testing.T) {
	valid := validLocalAppWorldCoreJSON("world-created")
	for name, raw := range map[string]string{
		"list instead of object": "[" + valid + "]",
		"unknown field":          strings.Replace(valid, `"id":"world-created"`, `"id":"world-created","rawBody":"private"`, 1),
		"duplicate field":        strings.Replace(valid, `"id":"world-created"`, `"id":"world-created","id":"other"`, 1),
		"signed uri":             strings.Replace(valid, `"resourceRefs":[]`, `"resourceRefs":[],"externalRefs":[{"refId":"asset","kind":"image","uri":"https://cdn.example/a.png?token=secret"}]`, 1),
	} {
		t.Run(name, func(t *testing.T) {
			response := projectLocalAppWorldCoreCreateResponse(&runtimev1.InvokeRealmUnaryResponse{
				Accepted: true, ResponseJson: raw,
				ReasonCode:        runtimev1.ReasonCode_ACTION_EXECUTED,
				AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED,
				HttpStatus:        201,
			})
			if response.GetAccepted() || response.GetResponseJson() != "" ||
				response.GetReasonCode() != runtimev1.ReasonCode_REALM_CONTRACT_INVALID ||
				strings.Contains(response.GetErrorMessage(), "private") || strings.Contains(response.GetErrorMessage(), "token") {
				t.Fatalf("%s response = %+v", name, response)
			}
		})
	}
}

func TestLocalAppWorldCoreFailureProjectionDropsRawOwnerDetail(t *testing.T) {
	response := sanitizeLocalAppWorldCoreFailure(&runtimev1.InvokeRealmUnaryResponse{
		Accepted: false, ReasonCode: runtimev1.ReasonCode_REALM_REQUEST_REJECTED,
		AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_REQUEST_REJECTED,
		HttpStatus:        422, ErrorMessage: `{"error":"private business body","token":"secret"}`,
	})
	if response.GetAccepted() || response.GetReasonCode() != runtimev1.ReasonCode_REALM_REQUEST_REJECTED ||
		response.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_REQUEST_REJECTED ||
		response.GetHttpStatus() != 422 || response.GetErrorMessage() != "" || response.GetResponseJson() != "" {
		t.Fatalf("sanitized owner failure = %+v", response)
	}
}

func validLocalAppWorldCoreJSON(id string) string {
	return `{
		"id":"` + id + `","schemaVersion":"1","contentRevision":1,"contentHash":"hash",
		"origin":{"kind":"manual"},"visibility":"private",
		"core":{
			"identity":{"name":"Test World","summary":"A test world"},
			"presentation":{},
			"ontology":{"entityKinds":[],"relationshipTypes":[]},
			"timeModel":{"mode":"static","flowRatio":1,"isPaused":true,
				"anchor":{"realStartedAt":"2026-08-06T00:00:00Z","worldStartedAt":"year 1","worldStartedAtDisplay":"Year 1"},
				"pausedWorldTime":null,"calendar":null,"displayFormat":null},
			"timeline":{"events":[]},"entities":[],"relationships":[],"systems":[],"scenes":[],
			"assets":{"resourceRefs":[],"intents":[]},"authoring":{"source":"manual"}
		},
		"createdAt":"2026-08-06T00:00:00Z","updatedAt":"2026-08-06T00:00:00Z"
	}`
}
