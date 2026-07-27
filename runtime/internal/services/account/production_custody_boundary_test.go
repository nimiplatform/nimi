package account

import (
	"context"
	"testing"
)

func TestProductionAccountCustodyRejectsEnvironmentAndGenericUserKeyring(t *testing.T) {
	t.Setenv("NIMI_RUNTIME_ACCOUNT_REALM_BASE_URL", "https://env-realm.example")
	t.Setenv("NIMI_RUNTIME_ACCOUNT_AUTHORIZATION_URL", "https://env-realm.example/api/auth/oauth/authorize")
	t.Setenv("NIMI_RUNTIME_ACCOUNT_TOKEN_URL", "https://env-realm.example/api/auth/oauth/token")
	t.Setenv("NIMI_RUNTIME_ACCOUNT_CUSTODY_PARTITION", "env-partition")
	t.Setenv("NIMI_RUNTIME_ACCOUNT_TEST_CUSTODY_FILE_PATH", t.TempDir()+"/account.json")

	resolved := resolveProductionConfig(ProductionConfig{})
	if resolved.RealmBaseURL != "" || resolved.AuthorizationURL != "" || resolved.TokenURL != "" ||
		resolved.CustodyPartition != "" {
		t.Fatalf("production account security inputs must ignore environment overrides: %+v", resolved)
	}

	service := NewProduction(nil, ProductionConfig{})
	if _, ok := service.custody.(unavailableCustody); !ok {
		t.Fatalf("production account custody must fail closed until protected service custody is injected, got %T", service.custody)
	}

	injected := injectedTestCustody{}
	withoutPartition := NewProduction(nil, ProductionConfig{Custody: injected})
	if _, ok := withoutPartition.custody.(unavailableCustody); !ok {
		t.Fatalf("protected custody without verified account partition must fail closed, got %T", withoutPartition.custody)
	}
	withPartition := NewProduction(nil, ProductionConfig{
		Custody:          injected,
		CustodyPartition: "verified-user-and-logon-session",
	})
	if _, ok := withPartition.custody.(injectedTestCustody); !ok {
		t.Fatalf("explicit protected custody and partition were not bound, got %T", withPartition.custody)
	}
}

type injectedTestCustody struct{}

func (injectedTestCustody) Load(context.Context, string) (AccountMaterial, error) {
	return AccountMaterial{}, ErrNoStoredAccount
}

func (injectedTestCustody) Store(context.Context, string, AccountMaterial) error { return nil }

func (injectedTestCustody) Clear(context.Context, string) error { return nil }
