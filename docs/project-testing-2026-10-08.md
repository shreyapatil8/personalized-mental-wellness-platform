# Project verification — 8 October 2026

Testing uses invented accounts and disposable MongoDB databases. The configured application database and existing user records were not accessed or changed.

## Corrections

- Journal creation and updates now reject whitespace-only reflections with HTTP 400. The form shows an actionable validation message and keeps the draft.
- Mood and WHO-5 validation no longer converts null, blank, boolean or array inputs into numerical measurements. Valid numbers and numeric form strings remain supported.
- Tracking history limits now reject invalid, fractional, zero and negative values; normal defaults and maximum caps remain supported.
- Damaged, obsolete, blocked or full browser storage no longer crashes authentication. Sign-out immediately clears the API authorization header; obsolete session-refresh responses are ignored after account changes.
- Feedback and intelligence pages now have primary page headings.
- The intelligence page constrains its long prompt preview to its grid column instead of expanding the entire page beyond the viewport.
- The root test command now includes frontend tests. `pnpm test:browser` builds the frontend and runs all six existing browser suites sequentially.
- Older counselling browser assertions now reflect the existing contract: relevant assessment notes can be shared with both consent gates enabled, and an unavailable briefing provider disables generation. These tests explicitly disable cloud generation rather than depending on a developer's local Ollama state.
- The README now describes the actual Ollama default and explicit opt-in required for OpenAI briefings.

## Verified checks

| Check | Result |
| --- | --- |
| Backend unit and API tests | 172 passed, 0 failed |
| Frontend utility and session-storage tests | 7 passed, 0 failed |
| Python survey/model contract tests | 4 passed |
| Frontend ESLint | Passed |
| Production Vite build | Passed |
| Context evaluation | Completed: 6 synthetic cases across 4 variants |
| Admin browser suite | 6 workflow groups passed |
| Assistant browser suite | 6 workflow groups passed |
| Counselling session history browser suite | 5 workflow groups passed |
| Counsellor summary browser suite | 5 workflow groups passed |
| Wellness overview / real ML browser suite | 8 workflow groups passed |
| Expanded fresh-user browser suite | 25 workflow groups passed |

Totals: 183 automated tests (172 backend, 7 frontend, 4 Python) and 55 browser workflow groups passed. The fresh-user browser suite covers registration, initial assessment, profile, moods, journals, live counselling messages, reconnection, consent, authorization, persistence, failed-write recovery, feedback submission, context generation, session-storage recovery and responsive layouts across 11 student pages. Its final run is recorded in `.test-cache/project-fresh-final-browser.log`.

Desktop and mobile screenshots are in `.test-cache/ui-review/`. Dashboard, wellness overview and corrected intelligence-page screenshots were visually inspected. Responsive assertions exercise 1440, 768, 390 and 320 pixel widths; tests also cover keyboard focus, reduced motion and uncaught browser exceptions.

## Evidence and reproduction

- `.test-cache/input-validation-before.log`: three reproduced validation failures before the fixes.
- `.test-cache/project-final-tests.log`: passing backend and frontend suites after fixes.
- `.test-cache/project-browser-tests.log`: all six browser suites passing before the final feedback/intelligence coverage extension.
- `.test-cache/project-fresh-final-browser.log`: expanded fresh-user browser run.
- `research/results/context-evaluation.json`: regenerated synthetic context evaluation.

```powershell
$env:MONGOMS_DOWNLOAD_DIR = Join-Path (Get-Location) '.test-cache/mongodb'
pnpm test
& ml/.venv/Scripts/python.exe -m unittest discover -s ml -p test_contract.py -v
pnpm lint
pnpm test:browser
pnpm research:context
```

The initial restricted run failed because the sandbox denied MongoDB file renames and loopback requests. The same checks passed with local process/network access. These were environment failures, not product failures.

## Verification limits

Live OpenAI/Ollama generation and Cloudinary uploads/downloads were not exercised against real provider accounts. Provider behavior uses mocks or explicit unavailable-provider cases. The saved ML classifier was exercised for real. Production deployment, existing-database migrations and external-service credentials remain outside this isolated verification.
