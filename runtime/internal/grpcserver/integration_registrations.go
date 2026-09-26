package grpcserver

import (
	"context"
	"errors"

	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"github.com/nimiplatform/nimi/runtime/internal/services/integration"
)

type integrationRegistrations struct {
	store *localappkernel.RegistrationStore
}

func (r integrationRegistrations) Consumers(ctx context.Context) ([]integration.Consumer, error) {
	if r.store == nil {
		return nil, nil
	}
	statuses, err := r.store.ListStatuses(ctx)
	if err != nil {
		return nil, err
	}
	result := make([]integration.Consumer, 0, len(statuses))
	for _, status := range statuses {
		if status.State != localappkernel.RegistrationStateActive || !status.CurrentHostBound {
			continue
		}
		registration, err := r.store.GetBySubject(ctx, status.RegisteredAppSubject)
		if err != nil {
			return nil, err
		}
		consumes := false
		for _, domain := range registration.ActivatedDomains {
			if domain == "integration.consume" {
				consumes = true
				break
			}
		}
		if !consumes {
			continue
		}
		consumer, found, err := r.DescribeConsumer(ctx, registration.RegisteredAppSubject)
		if err != nil {
			return nil, err
		}
		if found {
			result = append(result, consumer)
		}
	}
	return result, nil
}

func (r integrationRegistrations) DescribeConsumer(ctx context.Context, subject string) (integration.Consumer, bool, error) {
	if r.store == nil {
		return integration.Consumer{}, false, nil
	}
	description, err := r.store.DescribeBySubject(ctx, subject)
	if errors.Is(err, localappkernel.ErrNotFound) {
		return integration.Consumer{}, false, nil
	}
	if err != nil {
		return integration.Consumer{}, false, err
	}
	kind := "unknown"
	switch {
	case description.Platform:
		kind = "platform"
	case description.SourceClass == localappkernel.SourceClassLocalDevelopment:
		kind = "development"
	case description.SourceClass == localappkernel.SourceClassVerified || description.SourceClass == localappkernel.SourceClassUserImported:
		kind = "installed"
	}
	return integration.Consumer{Subject: subject, AppID: description.AppID, DisplayName: description.DisplayName, SourceKind: kind}, true, nil
}
