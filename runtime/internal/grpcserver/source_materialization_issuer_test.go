package grpcserver

import (
	"errors"
	"fmt"
	"io"
	"log/slog"
	"testing"

	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	runtimeagentservice "github.com/nimiplatform/nimi/runtime/internal/services/runtimeagent"
)

func TestNewAccountRealmSourceMaterializationIssuerRequiresExactDependencies(t *testing.T) {
	account := accountservice.New(slog.New(slog.NewTextHandler(io.Discard, nil)), accountservice.WithNonProductionHarnessMode())
	for _, test := range []struct {
		name    string
		account *accountservice.Service
		issuer  string
		wantErr bool
	}{
		{name: "ready", account: account, issuer: "https://realm.example.test", wantErr: false},
		{name: "missing account", issuer: "https://realm.example.test", wantErr: true},
		{name: "missing issuer", account: account, wantErr: true},
		{name: "whitespace issuer", account: account, issuer: " https://realm.example.test", wantErr: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			resolved, err := newAccountRealmSourceMaterializationIssuer(test.account, test.issuer)
			if (err != nil) != test.wantErr {
				t.Fatalf("constructor error = %v, wantErr = %t", err, test.wantErr)
			}
			if !test.wantErr && resolved == nil {
				t.Fatal("ready issuer is nil")
			}
		})
	}
}

func TestAccountRealmSourceMaterializationIssuerContractIdentity(t *testing.T) {
	var _ runtimeagentservice.RealmSourceMaterializationIssuer = (*accountRealmSourceMaterializationIssuer)(nil)
	if sourceMaterializationAccessPolicyDigestV5 != "7649e8c7aa85f6667b1af5134686fc653f33ed5094e5d11483a5e60f39765faa" {
		t.Fatalf("access policy digest = %q", sourceMaterializationAccessPolicyDigestV5)
	}
}

func TestAccountRealmSourceMaterializationIssuerClassifiesAcquisitionFailures(t *testing.T) {
	for _, test := range []struct {
		name string
		in   error
		want error
	}{
		{name: "invalid Packet request", in: accountservice.ErrRealmSourceMaterializationInvalidRequest, want: runtimeagentservice.ErrRealmSourceMaterializationAcquisitionInvalidRequest},
		{name: "stale source binding", in: accountservice.ErrRealmSourceMaterializationSourceBinding, want: runtimeagentservice.ErrRealmSourceMaterializationAcquisitionSourceBinding},
		{name: "source policy or visibility denied", in: accountservice.ErrRealmSourceMaterializationDenied, want: runtimeagentservice.ErrRealmSourceMaterializationAcquisitionDenied},
		{name: "producer contract denied or malformed", in: fmt.Errorf("wrapped: %w", accountservice.ErrRealmSourceMaterializationContract), want: runtimeagentservice.ErrRealmSourceMaterializationAcquisitionDenied},
		{name: "capacity", in: accountservice.ErrRealmSourceMaterializationResponseSize, want: runtimeagentservice.ErrRealmSourceMaterializationAcquisitionCapacity},
		{name: "account generation", in: accountservice.ErrRealmSourceMaterializationAccountLease, want: runtimeagentservice.ErrRealmSourceMaterializationAcquisitionAccount},
	} {
		t.Run(test.name, func(t *testing.T) {
			got := classifyAccountRealmSourceMaterializationAcquisitionError(test.in)
			if !errors.Is(got, test.want) {
				t.Fatalf("classified error = %v, want %v", got, test.want)
			}
		})
	}

	transport := accountservice.ErrRealmSourceMaterializationUnavailable
	if got := classifyAccountRealmSourceMaterializationAcquisitionError(transport); !errors.Is(got, transport) || errors.Is(got, runtimeagentservice.ErrRealmSourceMaterializationAcquisitionDenied) {
		t.Fatalf("transport availability was misclassified: %v", got)
	}
}
