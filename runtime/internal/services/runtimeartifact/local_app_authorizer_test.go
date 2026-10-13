package runtimeartifact

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestOpenAuthorizedLocalAppArtifactRejectionReleasesDiskBody(t *testing.T) {
	for name, use := range map[string]LocalAppArtifactUse{
		"inline read":       LocalAppArtifactUseInlineRead,
		"scenario input":    LocalAppArtifactUseScenarioInput,
		"adoption":          LocalAppArtifactUseAdoption,
		"audio preparation": LocalAppArtifactUseAudioPreparation,
	} {
		t.Run(name, func(t *testing.T) {
			store, err := NewDiskStore(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			// Native Conversation voice has its own audience and no Local App owner.
			if err := store.Put("conversation-voice", ArtifactRecord{
				Bytes:    []byte("voice"),
				MimeType: "audio/wav",
				GeneratedVoice: &GeneratedVoiceArtifactMetadata{
					AgentID: "agent", ConversationAnchorID: "conversation",
				},
			}); err != nil {
				t.Fatal(err)
			}
			source, err := OpenAuthorizedLocalAppArtifact(context.Background(), store, "conversation-voice",
				LocalAppArtifactOwner{AccountID: "account", RegisteredAppSubject: "app-subject"}, use)
			if source != nil || !errors.Is(err, ErrLocalAppArtifactUnavailable) {
				t.Fatalf("ownerless artifact must remain unavailable: source=%v err=%v", source, err)
			}

			// A rejected read must not retain the disk pin and stall unrelated writes.
			finished := make(chan error, 1)
			go func() {
				if err := store.Put("next-artifact", ArtifactRecord{Bytes: []byte("next"), MimeType: "text/plain"}); err != nil {
					finished <- err
					return
				}
				finished <- store.Delete("conversation-voice")
			}()
			select {
			case err := <-finished:
				if err != nil {
					t.Fatalf("write/cleanup after rejection: %v", err)
				}
			case <-time.After(2 * time.Second):
				t.Fatal("rejected artifact read blocked subsequent disk writes")
			}
		})
	}
}
