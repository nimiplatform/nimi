// Package productrelease verifies the Platform-admitted Windows product
// inventory. It neither selects releases nor owns update or data lifecycle.
package productrelease

// PublicKey is sealed from config/product-update-policy.mjs by the formal
// build's Go overlay. Empty trust disables production admission; environment,
// argv, local files and development certificates cannot supply this value.
const PublicKey = ""
