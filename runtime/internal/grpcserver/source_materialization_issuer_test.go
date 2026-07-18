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
	if sourceMaterializationAccessPolicyDigestV4 != "34f338ae76cbd85de58054cd6fc4d0ee18500030a0bc12f091e88d46f2fc572f" {
		t.Fatalf("access policy digest = %q", sourceMaterializationAccessPolicyDigestV4)
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
		{name: "grant or visibility denied", in: accountservice.ErrRealmSourceMaterializationDenied, want: runtimeagentservice.ErrRealmSourceMaterializationAcquisitionDenied},
		{name: "grant denied or malformed", in: fmt.Errorf("wrapped: %w", accountservice.ErrRealmSourceMaterializationContract), want: runtimeagentservice.ErrRealmSourceMaterializationAcquisitionDenied},
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
