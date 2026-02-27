// Package nimillm provides the unified cloud AI provider module.
// It consolidates all cloud adapter routing (alibaba, bytedance, gemini,
// minimax, kimi, glm) behind a single module boundary.
//
// The package exports:
//   - Provider / StreamingTextProvider / DecisionInfoProvider interfaces
//   - Backend: OpenAI-compatible HTTP backend
//   - CloudProvider: multi-backend cloud routing with health awareness
//   - CloudConfig: connection parameters for all cloud backends
package nimillm
