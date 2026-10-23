package app

import (
	"context"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/appstorage"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestProtectedLocalAppStorageRoundTripIsBoundedAndIdempotent(t *testing.T) {
	f := newLocalAppSessionFixture(t, nil, WithAppStorageDataRoot(t.TempDir()))
	account := accountservice.New(nil, accountservice.WithAuditStore(auditlog.New(128, 128)), accountservice.WithNonProductionHarnessMode(), accountservice.WithClock(func() time.Time { return f.now }), accountservice.WithCustody(&localAppRefreshCustody{material: accountservice.AccountMaterial{AccountID: "account-1", RealmEnvironmentID: "realm-1", AccessToken: "access", RefreshToken: "refresh", AccessTokenExpires: f.now.Add(time.Hour)}}))
	WithRuntimeAccountProjectionProvider(account)(f.service)
	service := f.service
	t.Cleanup(service.CloseLocalAppStorage)
	if _, err := service.OpenLocalAppSessionProjection(f.context); err != nil {
		t.Fatal(err)
	}
	admit := func(ingress localappop.Ingress) context.Context {
		ctx, err := service.AuthorizeLocalAppIngress(f.context, ingress)
		if err != nil {
			t.Fatal(err)
		}
		return ctx
	}
	path := "agent-chat/conversation.json"

	write, err := service.WriteLocalAppStorageJson(admit(localappop.IngressStorageJSONWrite), &runtimev1.WriteLocalAppStorageJsonRequest{
		RelativePath: path,
		JsonValue:    []byte(`{"title":"中文", "turns": [1, true]}`),
	})
	if err != nil || string(write.GetJsonValue()) != `{"title":"中文","turns":[1,true]}` || write.GetSizeBytes() != int64(len(write.GetJsonValue())) || write.GetReasonCode() != runtimev1.ReasonCode_ACTION_EXECUTED {
		t.Fatalf("write response = (%+v, %v)", write, err)
	}

	read, err := service.ReadLocalAppStorageJson(admit(localappop.IngressStorageJSONRead), &runtimev1.ReadLocalAppStorageJsonRequest{RelativePath: path})
	if err != nil || string(read.GetJsonValue()) != string(write.GetJsonValue()) || read.GetSizeBytes() != write.GetSizeBytes() || read.GetReasonCode() != runtimev1.ReasonCode_ACTION_EXECUTED {
		t.Fatalf("read response = (%+v, %v)", read, err)
	}

	removeContext := admit(localappop.IngressStorageJSONRemove)
	first, err := service.RemoveLocalAppStorageJson(removeContext, &runtimev1.RemoveLocalAppStorageJsonRequest{RelativePath: path})
	if err != nil || !first.GetRemoved() || first.GetReasonCode() != runtimev1.ReasonCode_ACTION_EXECUTED {
		t.Fatalf("first remove response = (%+v, %v)", first, err)
	}
	second, err := service.RemoveLocalAppStorageJson(removeContext, &runtimev1.RemoveLocalAppStorageJsonRequest{RelativePath: path})
	if err != nil || second.GetRemoved() || second.GetReasonCode() != runtimev1.ReasonCode_ACTION_EXECUTED {
		t.Fatalf("second remove response = (%+v, %v)", second, err)
	}
}

func TestStorageWriteUsesFinalScopeFence(t *testing.T) {
	for _, fence := range []string{"registration", "account", "session", "revoke", "expiry", "cancel"} {
		t.Run(fence, func(t *testing.T) {
			f := newLocalAppSessionFixture(t, nil, WithAppStorageDataRoot(t.TempDir()))
			t.Cleanup(f.service.CloseLocalAppStorage)
			account := accountservice.New(nil, accountservice.WithAuditStore(auditlog.New(128, 128)), accountservice.WithNonProductionHarnessMode(), accountservice.WithClock(func() time.Time { return f.now }), accountservice.WithCustody(&localAppRefreshCustody{material: accountservice.AccountMaterial{AccountID: "account-1", RealmEnvironmentID: "realm-1", AccessToken: "access", RefreshToken: "refresh", AccessTokenExpires: f.now.Add(time.Hour)}}))
			barrier := &accountCommitBarrier{Service: account, entered: make(chan struct{}), release: make(chan struct{})}
			WithRuntimeAccountProjectionProvider(barrier)(f.service)
			if _, err := f.service.OpenLocalAppSessionProjection(f.context); err != nil {
				t.Fatal(err)
			}
			authorized, err := f.service.AuthorizeLocalAppIngress(f.context, localappop.IngressStorageJSONWrite)
			if err != nil {
				t.Fatal(err)
			}
			authorized, cancel := context.WithCancel(authorized)
			defer cancel()
			finished := make(chan error, 1)
			go func() {
				_, err := f.service.WriteLocalAppStorageJson(authorized, &runtimev1.WriteLocalAppStorageJsonRequest{RelativePath: "state.json", JsonValue: []byte(`true`)})
				finished <- err
			}()
			select {
			case <-barrier.entered:
			case <-time.After(3 * time.Second):
				close(barrier.release)
				t.Fatal("storage commit fence not reached")
			}
			var mutationErr error
			switch fence {
			case "registration":
				mutationErr = f.kernel.Registrations().Tombstone(context.Background(), f.registration.RegistrationHandle)
			case "account":
				_, mutationErr = account.Logout(context.Background(), &runtimev1.LogoutRequest{Caller: &runtimev1.AccountCaller{AppId: "nimi.desktop", AppInstanceId: "desktop-test", DeviceId: "test", Mode: runtimev1.AccountCallerMode_ACCOUNT_CALLER_MODE_DESKTOP_SHELL}})
			case "session":
				handle, _ := f.connection.Session()
				f.connection.InvalidateSession(handle)
			case "revoke":
				f.connection.Revoke()
			case "expiry":
				WithClock(func() time.Time { return f.now.Add(2 * time.Minute) })(f.service)
			case "cancel":
				cancel()
			}
			close(barrier.release)
			if mutationErr != nil {
				t.Fatal(mutationErr)
			}
			select {
			case err := <-finished:
				if err == nil {
					t.Fatal("withdrawn registration committed JSON")
				}
			case <-time.After(3 * time.Second):
				t.Fatal("storage commit deadlocked")
			}
			owner := appstorage.ManagedOwner{AccountID: "account-1", RegisteredAppSubject: f.registration.RegisteredAppSubject}
			if _, err := f.service.localAppJSONStore.Read(context.Background(), owner, "state.json"); err != appstorage.ErrLocalAppJSONNotFound {
				t.Fatal("rejected storage commit changed disk", err)
			}
		})
	}
}

func TestProtectedLocalAppStorageFailsClosedWithSanitizedReasons(t *testing.T) {
	dataRoot := t.TempDir()
	service := newTestService(WithAppStorageDataRoot(dataRoot))
	tests := []struct {
		name   string
		invoke func() error
		code   codes.Code
		reason runtimev1.ReasonCode
	}{
		{
			name: "invalid path",
			invoke: func() error {
				_, err := service.ReadLocalAppStorageJson(localAppStorageTestContext(accountservice.LocalAppOperationStorageJSONRead, "principal-a"), &runtimev1.ReadLocalAppStorageJsonRequest{RelativePath: "../secret.json"})
				return err
			},
			code: codes.InvalidArgument, reason: runtimev1.ReasonCode_APP_STORAGE_PATH_INVALID,
		},
		{
			name: "missing entry",
			invoke: func() error {
				_, err := service.ReadLocalAppStorageJson(localAppStorageTestContext(accountservice.LocalAppOperationStorageJSONRead, "principal-a"), &runtimev1.ReadLocalAppStorageJsonRequest{RelativePath: "state/missing.json"})
				return err
			},
			code: codes.NotFound, reason: runtimev1.ReasonCode_APP_STORAGE_ENTRY_NOT_FOUND,
		},
		{
			name: "invalid json",
			invoke: func() error {
				_, err := service.WriteLocalAppStorageJson(localAppStorageTestContext(accountservice.LocalAppOperationStorageJSONWrite, "principal-a"), &runtimev1.WriteLocalAppStorageJsonRequest{RelativePath: "state/value.json", JsonValue: []byte(`{"broken"`)})
				return err
			},
			code: codes.InvalidArgument, reason: runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID,
		},
		{
			name: "operation mismatch",
			invoke: func() error {
				_, err := service.ReadLocalAppStorageJson(localAppStorageTestContext(accountservice.LocalAppOperationStorageJSONWrite, "principal-a"), &runtimev1.ReadLocalAppStorageJsonRequest{RelativePath: "state/value.json"})
				return err
			},
			code: codes.PermissionDenied, reason: runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := test.invoke()
			reason, _ := grpcerr.ExtractReasonCode(err)
			if status.Code(err) != test.code || reason != test.reason {
				t.Fatalf("failure = code=%s reason=%s err=%v", status.Code(err), reason, err)
			}
			message := status.Convert(err).Message()
			if strings.Contains(message, dataRoot) || strings.Contains(message, "secret.json") || strings.Contains(message, "principal-a") {
				t.Fatalf("failure leaked protected storage detail: %q", message)
			}
		})
	}

	withoutRoot := newTestService()
	_, err := withoutRoot.ReadLocalAppStorageJson(localAppStorageTestContext(accountservice.LocalAppOperationStorageJSONRead, "principal-a"), &runtimev1.ReadLocalAppStorageJsonRequest{RelativePath: "state/value.json"})
	reason, _ := grpcerr.ExtractReasonCode(err)
	if status.Code(err) != codes.FailedPrecondition || reason != runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE {
		t.Fatalf("missing data root failure = code=%s reason=%s err=%v", status.Code(err), reason, err)
	}
}

func localAppStorageTestContext(operation accountservice.LocalAppOperation, principalID string) context.Context {
	return accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{
		AccountID:            "account-a",
		RegisteredAppSubject: principalID,
		Operation:            operation,
		AuthorityClass:       localappop.AuthorityClassBase,
		OperationCapability:  appstorage.LocalAppPrivateStorageEntitlement,
		ExpiresAt:            time.Now().Add(time.Minute),
	})
}
