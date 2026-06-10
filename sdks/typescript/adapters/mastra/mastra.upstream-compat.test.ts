// Upstream compatibility suite: mirrors Mastra public Agent / createTool /
// structuredOutput behavior through `@mastra/core`. These are adapter-contract
// tests against observable Mastra behavior, not copies of Mastra's internal unit
// tests. Split by dimension and aggregated here for the single-file gate.
import './mastra.upstream-text-compat.test';
import './mastra.upstream-tool-compat.test';
import './mastra.upstream-object-compat.test';
import './mastra.upstream-runtime-surface.test';
