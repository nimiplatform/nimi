package app

import (
	"context"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/appstorage"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestProtectedLocalAppStorageRoundTripIsBoundedAndIdempotent(t *testing.T) {
	service := newTestService(WithAppStorageDataRoot(t.TempDir()))
	path := "agent-chat/conversation.json"

	write, err := service.WriteLocalAppStorageJson(localAppStorageTestContext(accountservice.LocalAppOperationStorageJSONWrite, "principal-a"), &runtimev1.WriteLocalAppStorageJsonRequest{
		RelativePath: path,
		JsonValue:    []byte(`{"title":"中文", "turns": [1, true]}`),
	})
	if err != nil || string(write.GetJsonValue()) != `{"title":"中文","turns":[1,true]}` || write.GetSizeBytes() != int64(len(write.GetJsonValue())) || write.GetReasonCode() != runtimev1.ReasonCode_ACTION_EXECUTED {
		t.Fatalf("write response = (%+v, %v)", write, err)
	}

	read, err := service.ReadLocalAppStorageJson(localAppStorageTestContext(accountservice.LocalAppOperationStorageJSONRead, "principal-a"), &runtimev1.ReadLocalAppStorageJsonRequest{RelativePath: path})
	if err != nil || string(read.GetJsonValue()) != string(write.GetJsonValue()) || read.GetSizeBytes() != write.GetSizeBytes() || read.GetReasonCode() != runtimev1.ReasonCode_ACTION_EXECUTED {
		t.Fatalf("read response = (%+v, %v)", read, err)
	}

	removeContext := localAppStorageTestContext(accountservice.LocalAppOperationStorageJSONRemove, "principal-a")
	first, err := service.RemoveLocalAppStorageJson(removeContext, &runtimev1.RemoveLocalAppStorageJsonRequest{RelativePath: path})
	if err != nil || !first.GetRemoved() || first.GetReasonCode() != runtimev1.ReasonCode_ACTION_EXECUTED {
		t.Fatalf("first remove response = (%+v, %v)", first, err)
	}
	second, err := service.RemoveLocalAppStorageJson(removeContext, &runtimev1.RemoveLocalAppStorageJsonRequest{RelativePath: path})
	if err != nil || second.GetRemoved() || second.GetReasonCode() != runtimev1.ReasonCode_ACTION_EXECUTED {
		t.Fatalf("second remove response = (%+v, %v)", second, err)
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
		RegisteredAppSubject: principalID,
		Operation:            operation,
		AuthorityClass:       localappop.AuthorityClassBase,
		OperationCapability:  appstorage.LocalAppPrivateStorageEntitlement,
		ExpiresAt:            time.Now().Add(time.Minute),
	})
}
