//go:build darwin && cgo && nimi_macos_local_development

package entrypoint

// This endpoint is compile-time fixed for the isolated non-product profile.
// Renderer, argv, environment, app manifests, and mutable Runtime config cannot
// redirect account or Realm authority.
const macOSProtectedRealmBaseURL = "http://127.0.0.1:3002"
