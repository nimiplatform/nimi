package grpcserver

import (
	"context"
	"errors"

	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
)

type installedSessionResolverChain []accountservice.InstalledSessionResolver

func (chain installedSessionResolverChain) ResolveInstalledSession(ctx context.Context, accountGeneration uint64) (accountservice.InstalledCallerBinding, error) {
	var failures []error
	for _, resolver := range chain {
		if resolver == nil {
			continue
		}
		binding, err := resolver.ResolveInstalledSession(ctx, accountGeneration)
		if err == nil {
			return binding, nil
		}
		failures = append(failures, err)
	}
	return accountservice.InstalledCallerBinding{}, errors.Join(failures...)
}

var _ accountservice.InstalledSessionResolver = installedSessionResolverChain{}
