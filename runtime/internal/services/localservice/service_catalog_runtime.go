package localservice

import runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"

func (s *Service) catalogSnapshot() []*runtimev1.LocalCatalogModelDescriptor {
	if s == nil {
		return nil
	}

	s.mu.RLock()
	if len(s.catalog) > 0 {
		items := make([]*runtimev1.LocalCatalogModelDescriptor, 0, len(s.catalog))
		for _, item := range s.catalog {
			items = append(items, cloneCatalogItem(item))
		}
		s.mu.RUnlock()
		return items
	}
	verified := append([]*runtimev1.LocalVerifiedAssetDescriptor(nil), s.verified...)
	s.mu.RUnlock()

	generated := defaultCatalogFromVerified(verified)

	s.mu.Lock()
	if len(s.catalog) == 0 {
		s.catalog = generated
	}
	items := make([]*runtimev1.LocalCatalogModelDescriptor, 0, len(s.catalog))
	for _, item := range s.catalog {
		items = append(items, cloneCatalogItem(item))
	}
	s.mu.Unlock()
	return items
}
