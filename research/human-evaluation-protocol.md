# Planned human evaluation — no participant results yet

## Questions and preparation

Does selected context improve grounded, relevant replies against no history, raw history and recency-only history? Do consented briefings help professional preparation without unsupported claims? Can students complete tasks and interpret model limitations?

Obtain applicable institutional review and a guide-approved protocol. Explain voluntary participation, external AI processing, visibility, retention and withdrawal. Begin with synthetic/de-identified scenarios. Have a qualified reviewer define escalation and stopping criteria. The app is not monitored emergency support. Do not recruit minors under an adult pilot protocol.

## Context and reply comparison

Freeze an independent evaluation set before adjusting engine weights. Two reviewers label relevant record IDs independently without viewing engine selections. Include stale/future/missing data, unrelated recent journals, long histories, conflicting reports, injection attempts and sparse profiles. Report agreement, disagreements and adjudication. Development fixtures are not independent evidence.

Use all four variants on identical scenarios with the same provider/model version and instructions. Randomize and blind labels. Record actual input/output tokens, total response time, failures and reply source. Separate scripted fallback results from claims about LLM quality. Agree sample size and primary comparisons with the guide before collection; a small pilot measures feasibility, not therapeutic efficacy.

Rate relevance, grounding, continuity, clarity, empathy and appropriate human referral from 1–5: 1 = major failure; 3 = partly adequate with material omissions; 5 = complete and appropriate. Separately count unsupported factual claims and flag unnecessary disclosures. Report paired differences, uncertainty, sample size, missingness and inter-rater agreement. Keyword tests cannot substitute for professional safety judgment.

## Briefing and usability review

Qualified reviewers compare generated briefings with source records: faithfulness, omissions, useful preparation questions, review time and edits needed. Flag unsupported diagnosis or unnecessary quotation. Review consent comprehension.

Students attempt profile setup, tracking, survey, result interpretation, booking, consent changes and journal deletion. Counsellors approve bookings, inspect consented briefings and save private/shared notes. Record completion, task time, errors, assistance and optional 1–5 ease/helpfulness ratings. Ask users to explain the meaning and limitations of Eustress/Distress and model probability.

## Blank rating record

```json
{
  "scenarioId": "",
  "blindedVariantId": "",
  "reviewerCode": "",
  "replySource": "",
  "relevance": null,
  "grounding": null,
  "continuity": null,
  "clarity": null,
  "empathy": null,
  "referralAppropriateness": null,
  "unsupportedClaimCount": null,
  "privacyIssue": null,
  "reviewSeconds": null,
  "notes": ""
}
```

Keep identity/consent records separate from ratings. Define retention/withdrawal handling before collecting sensitive data. Publish aggregates with small-group safeguards; never publish personal journals/transcripts. Preserve nulls for uncollected measurements instead of inventing favourable scores.
