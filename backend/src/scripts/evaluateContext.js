import { mkdir, readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { buildCandidates, buildWellnessContext, constructStructuredPrompt, estimateTokens, scoreContextItem } from "../utils/wellnessIntelligenceEngine.js";

const outputDir = new URL("../../../research/results/", import.meta.url);
const fixtures = JSON.parse(await readFile(new URL("../../../research/context-cases.json", import.meta.url), "utf8"));
const results = [];
for (const scenario of fixtures.cases) {
  const options = { ...scenario.records, userMessage: scenario.message, now: new Date(fixtures.now), tokenBudget: 700, maxItems: 4 };
  const candidates = buildCandidates(options).map((item) => scoreContextItem(item, scenario.message, options.now));
  const start = performance.now();
  let context;
  for (let i = 0; i < 100; i++) context = buildWellnessContext(options);
  const latencyMs = (performance.now() - start) / 100;
  const render = (items) => constructStructuredPrompt({ ...options, selectedItems: items });
  const recent = [...candidates].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  const recentSelected = [];
  for (const item of recent) {
    if (recentSelected.length >= 4) break;
    if (estimateTokens(render([...recentSelected, item])) <= 700) recentSelected.push(item);
  }
  const variants = { no_history: [], raw_history: candidates, recency_only: recentSelected, proposed_engine: context.selectedItems };
  for (const [variant, selected] of Object.entries(variants)) {
    const selectedIds = selected.map((item) => item.sourceId);
    const matches = selectedIds.filter((id) => scenario.relevantIds.includes(id)).length;
    const tokens = estimateTokens(render(selected));
    results.push({ case: scenario.id, variant, selectedIds, relevantIds: scenario.relevantIds,
      precision: selectedIds.length ? matches / selectedIds.length : null,
      recall: scenario.relevantIds.length ? matches / scenario.relevantIds.length : null,
      estimatedPromptTokens: tokens, withinBudget: tokens <= 700,
      tokenReductionVsRaw: 1 - tokens / estimateTokens(render(candidates)),
      selectionLatencyMs: variant === "proposed_engine" ? latencyMs : null });
  }
}
await mkdir(outputDir, { recursive: true });
await writeFile(new URL("context-evaluation.json", outputDir), JSON.stringify({
  generatedAt: new Date().toISOString(), fixtureType: fixtures.type,
  limitations: "Hand-authored engineering fixtures, not participant data. Relevance labels were authored with the cases. These checks do not establish clinical usefulness, response empathy or generalization. Token estimates use characters/4, not provider billing tokens. Latency is local in-memory selection only.", results
}, null, 2));
console.log(JSON.stringify({ cases: fixtures.cases.length, variants: 4, output: "research/results/context-evaluation.json" }));
