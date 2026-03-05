package grpcserver

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestInferRequestIdentityFromScenarioHead(t *testing.T) {
	req := &runtimev1.ExecuteScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "model-a",
		},
	}
	appID, subjectUserID, modelID := inferRequestIdentity(req)
	if appID != "nimi.desktop" {
		t.Fatalf("app_id mismatch: got=%q want=%q", appID, "nimi.desktop")
	}
	if subjectUserID != "user-001" {
		t.Fatalf("subject_user_id mismatch: got=%q want=%q", subjectUserID, "user-001")
	}
	if modelID != "model-a" {
		t.Fatalf("model_id mismatch: got=%q want=%q", modelID, "model-a")
	}
}

func TestAppIDFromRequestFallsBackToScenarioHead(t *testing.T) {
	req := &runtimev1.SubmitScenarioJobRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId: "nimi.desktop",
		},
	}
	if got := appIDFromRequest(req); got != "nimi.desktop" {
		t.Fatalf("app_id mismatch: got=%q want=%q", got, "nimi.desktop")
	}
}
