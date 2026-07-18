package app

import (
	"context"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
)

type localAppConversationScopeAcceptAll struct{}

func (localAppConversationScopeAcceptAll) ValidateLocalAppConversationScope(context.Context, string, string) error {
	return nil
}

type localAppSubscriptionReasonError struct{ reason runtimev1.ReasonCode }

func (err localAppSubscriptionReasonError) Error() string { return "local-app subscription denied" }
func (err localAppSubscriptionReasonError) LocalAppOperationReasonCode() runtimev1.ReasonCode {
	return err.reason
}

type localAppSubscriptionAuthorizer struct {
	decision accountservice.LocalAppCallerDecision
	err      error
}

func (authorizer localAppSubscriptionAuthorizer) AuthorizeLocalAppProtectedOperation(context.Context, accountservice.LocalAppOperation, localappop.Selector) (accountservice.LocalAppCallerDecision, error) {
	return authorizer.decision, authorizer.err
}

func TestLocalAppSubscriptionRevalidatesAuthorityBeforeEveryDeliveredEvent(t *testing.T) {
	for _, reason := range []runtimev1.ReasonCode{
		runtimev1.ReasonCode_LOCAL_APP_PERMISSION_DENIED,
		runtimev1.ReasonCode_LOCAL_APP_PERMISSION_REVOKED,
		runtimev1.ReasonCode_LOCAL_APP_PRESENCE_EXPIRED,
		runtimev1.ReasonCode_LOCAL_APP_ACCOUNT_CHANGED,
		runtimev1.ReasonCode_LOCAL_APP_PROCESS_MISMATCH,
		runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED,
	} {
		t.Run(reason.String(), func(t *testing.T) {
			decision := accountservice.LocalAppCallerDecision{
				SessionID: accountServiceIdentifier(0x91), AppID: "nimi.zhiyu", AccountID: "account-a",
				LocalAppPrincipalID: "principal-a", LocalAppRecordID: "record-a",
				Operation: accountservice.LocalAppOperationSubscribeConversation,
			}
			authorizer := localAppSubscriptionAuthorizer{
				decision: decision,
				err:      localAppSubscriptionReasonError{reason: reason},
			}
			svc := newTestService(
				WithLocalAppConversationScopeValidator(localAppConversationScopeAcceptAll{}),
				WithLocalAppOperationAuthorizer(authorizer),
			)
			ctx := accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision)
			stream := &appMessageStreamCollector{ctx: ctx}
			done := make(chan error, 1)
			go func() {
				done <- svc.SubscribeAppMessages(&runtimev1.SubscribeAppMessagesRequest{
					FromAppIds: []string{"runtime.agent"}, LocalAgentRef: "agent-a", ConversationAnchorId: "anchor-a",
				}, stream)
			}()

			deadline := time.Now().Add(time.Second)
			for {
				svc.mu.RLock()
				ready := len(svc.subscribers) == 1
				svc.mu.RUnlock()
				if ready {
					break
				}
				if time.Now().After(deadline) {
					t.Fatal("local-app subscriber was not registered")
				}
				time.Sleep(time.Millisecond)
			}
			svc.publish(&runtimev1.AppMessageEvent{
				FromAppId: "runtime.agent", ToAppId: decision.AppID, SubjectUserId: decision.AccountID,
				MessageType: "runtime.agent.turn.text_delta",
			})

			select {
			case err := <-done:
				got, _ := grpcerr.ExtractReasonCode(err)
				if got != reason {
					t.Fatalf("active stream reason = %s, want %s err=%v", got, reason, err)
				}
				stream.mu.Lock()
				delivered := len(stream.events)
				stream.mu.Unlock()
				if delivered != 0 {
					t.Fatalf("stale stream delivered %d events", delivered)
				}
			case <-time.After(time.Second):
				t.Fatal("stale local-app stream remained open")
			}
		})
	}
}

func accountServiceIdentifier(seed byte) [32]byte {
	var value [32]byte
	for index := range value {
		value[index] = seed
	}
	return value
}
