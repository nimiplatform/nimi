package runtimeagent

import (
	"encoding/json"
	"strings"
	"testing"

	"google.golang.org/protobuf/encoding/protojson"
)

func TestAgentTurnContextSummaryIsBoundedAndPrivateContentFree(t *testing.T) {
	t.Parallel()
	input := agentTurnContextTestInput(t, "realmPersona")
	canaries := []string{
		"PRIVATE-RUNTIME-POLICY-CANARY",
		"PRIVATE-APML-CANARY",
		"PRIVATE-MEMORY-CANARY",
		"PRIVATE-HISTORY-CANARY",
		"PRIVATE-CURRENT-TURN-CANARY",
	}
	input.RuntimePolicy[0].Text += " " + canaries[0]
	input.OutputContract.APML += " " + canaries[1]
	input.Memory[0].Text += " " + canaries[2]
	input.Transcript[0].UserText += " " + canaries[3]
	input.CurrentUserTurn.Text += " " + canaries[4]
	compiled, err := compileAgentTurnContext(input)
	if err != nil {
		t.Fatal(err)
	}
	providerText := agentTurnContextTestProviderText(compiled.ProviderPrompt)
	for _, canary := range canaries {
		if !strings.Contains(providerText, canary) {
			t.Fatalf("private provider prompt is missing fixture canary %q", canary)
		}
	}
	summaryJSON, err := protojson.Marshal(compiled.Summary)
	if err != nil {
		t.Fatal(err)
	}
	manifestJSON, err := json.Marshal(compiled.Manifest)
	if err != nil {
		t.Fatal(err)
	}
	for _, raw := range [][]byte{summaryJSON, manifestJSON} {
		text := string(raw)
		for _, canary := range canaries {
			if strings.Contains(text, canary) {
				t.Fatalf("bounded projection leaked private canary %q: %s", canary, text)
			}
		}
		for _, forbidden := range []string{"packetProof", "challengeDigest", "nonce", "providerCredential", "toolArguments", "toolResults"} {
			if strings.Contains(text, forbidden) {
				t.Fatalf("bounded projection leaked forbidden field %q: %s", forbidden, text)
			}
		}
	}
	if !strings.Contains(string(summaryJSON), compiled.Manifest.ManifestInstanceHash) || !strings.Contains(string(summaryJSON), compiled.Manifest.ContextContentHash) || !strings.Contains(string(summaryJSON), compiled.Manifest.PromptHash) {
		t.Fatalf("bounded summary omitted safe hashes: %s", summaryJSON)
	}
	if compiled.Summary.GetSourceRef().GetSourceId() != input.Snapshot.SourceRef.SourceID || compiled.Summary.GetBudget().GetUsedTokens() != compiled.Manifest.Budget.UsedTokens || compiled.Summary.GetTranscriptTurnCount() != uint32(len(input.Transcript)) || compiled.Summary.GetMemoryItemCount() != uint32(len(input.Memory)) {
		t.Fatalf("bounded summary safe fields mismatch: %+v", compiled.Summary)
	}
}

func TestAgentTurnContextRejectsUnverifiedSnapshotAndUnadmittedMedia(t *testing.T) {
	t.Parallel()
	input := agentTurnContextTestInput(t, "worldCharacter")
	input.Snapshot.SnapshotHash = strings.Repeat("0", 64)
	if compiled, err := compileAgentTurnContext(input); err == nil || compiled != nil || !strings.Contains(err.Error(), "snapshot hash mismatch") {
		t.Fatalf("unverified snapshot result=%+v err=%v", compiled, err)
	}

	input = agentTurnContextTestInput(t, "worldCharacter")
	input.CurrentUserTurn.Media = []agentTurnContextMedia{{MediaID: "media-1", Kind: "image", MIMEType: "text/html", ArtifactRef: "artifact-1"}}
	if compiled, err := compileAgentTurnContext(input); err == nil || compiled != nil || !strings.Contains(err.Error(), "MIME") {
		t.Fatalf("unadmitted media result=%+v err=%v", compiled, err)
	}
	input.CurrentUserTurn.Media[0].MIMEType = "image/png"
	input.CurrentUserTurn.Media[0].ArtifactRef = "https://secret.example/token"
	if compiled, err := compileAgentTurnContext(input); err == nil || compiled != nil || !strings.Contains(err.Error(), "opaque") {
		t.Fatalf("URL media ref result=%+v err=%v", compiled, err)
	}
}
