// Package productrelease verifies Platform-admitted Windows inventories and
// enforces their code-retention constraints. Platform owns the policy; this
// package does not own update activation or data lifecycle.
package productrelease

// PublicKey is sealed from config/product-update-policy.mjs by the formal
// build's Go overlay. Empty trust disables production admission; environment,
// argv, local files and development certificates cannot supply this value.
const PublicKey = ""
