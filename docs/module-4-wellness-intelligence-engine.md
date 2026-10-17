# Module 4 — Wellness Intelligence Engine

The context engine scores profile, assessment, mood, journal, current-schema model estimates and conversation candidates using priority, recency and keyword overlap. It removes invalid/future/older-than-90-day records (persistent profile excepted), filters irrelevant text unless priority is high, and selects top-k under a full rendered-context budget. Tokens are estimated as characters/4; API wrapper/output/billing tokens are separate.

Student-only GET/POST /api/intelligence/context/me exposes saved/new context. Mood/journal edits and deletions invalidate derived copies; profile changes invalidate all snapshots and briefing caches. This does not remove previously generated chat replies.

Implementation: wellnessIntelligenceEngine.js, wellnessIntelligenceService.js and WellnessContextSnapshot.js. The engine operates on bounded recent history loaded by the service; it is not semantic retrieval over all historical records. Test with pnpm research:context. Six authored cases do not establish independent novelty or generalization; see the research results/protocol.
