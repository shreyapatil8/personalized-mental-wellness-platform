# Research workflow verification

Use a disposable research database and invented records. Automated tests use isolated MongoDB, never the configured Atlas database. Run the root README commands. Test logs are in research/results/backend-tests.txt.

API checks cover role restrictions, activation, survey validation, actual model inference, unavailable models, appointment conflicts, private/shared notes, consent, document ownership, aggregate feedback and derived-context deletion. Unit checks cover context budgets, stale records, moving averages, provider output validation and signed links. Python checks cover the shared survey contract. Provider tests use fixtures and do not prove live connectivity.

## Manual and live-provider walkthrough

### Student entry: Register → Login → Dashboard

1. Run `pnpm dev` with your local MongoDB configured. Open `http://localhost:5173/` in a private browser window. The welcome page should show a student-wellness illustration and clearly labeled Register and Login links. Check it at desktop and mobile widths.
2. Choose Register. The student form should contain only Full Name, Email, Password and Confirm Password. Try empty fields, an invalid email, a whitespace-only name, a password shorter than 8 characters, and mismatched passwords. Each must prevent registration with a validation message.
3. Register with a new test email and matching passwords. You should arrive at `/login` with a success message, the email prefilled, and an empty password field. Registration should not create a signed-in browser session.
4. Try an incorrect password and check the error message. Then log in with the registered password. Students without a completed initial assessment see `/wellness-assessment`; choose Skip for Now to reach the existing dashboard at `/`. Refresh and verify that the session persists.
5. Open Profile and the existing wellness assessment/tracking pages to complete details later. Sign out, try a protected URL such as `/profile`, and verify that it redirects to login. Opening `/` while signed out should show the welcome page again.
6. Register again with the same email and check the duplicate-account message. From the registration page, follow Counsellor registration and verify that the existing application/administrator approval flow still works.

Focused API checks (disposable MongoDB):

```powershell
$env:MONGOMS_DOWNLOAD_DIR = Join-Path (Get-Location) '.test-cache/mongodb'
node --test backend/src/tests/studentEntry.test.js
```

### Initial wellness assessment

1. Log in as a student who has not completed the initial assessment. Verify the "Complete Your Wellness Assessment" invitation and its Start Assessment / Skip for Now options. Counsellors and administrators should continue to their existing home pages.
2. Choose Skip for Now. Confirm that the dashboard loads and offers Start Assessment. Skipping must not create assessment responses or a completion date. An incomplete assessment is offered again on the next login.
3. Return through the dashboard and choose Start Assessment. Confirm one question at a time, the exact supplied wording/options, and "Question N of 15". Next without a response must show an error. Back must retain prior selections. Question 15 must allow an empty text field.
4. Submit all 14 choices, leaving question 15 blank. Verify "Assessment complete", then Continue to Dashboard. The dashboard now offers View / Update Assessment. No new wellness score or ML prediction should appear from this assessment.
5. View the saved answers, select Update Assessment, change a choice and add an optional note, then submit. Refresh the review page and verify persistence. Profile should also offer View / Update Assessment. Completed students go directly to the dashboard on subsequent login.
6. Simulate a failed save in browser network tools: the form must retain answers and allow retry. Verify the assessment at mobile width and with keyboard navigation. Sign out and open `/wellness-assessment`; it must redirect to login.

Storage: the existing `studentprofiles` collection contains an optional `initialWellnessAssessment` object with `schemaVersion`, all 15 named `responses`, `completedAt` (first submission) and `updatedAt` (latest submission). Existing profiles need no migration; absent assessment means incomplete. Submission atomically creates/updates this section for the authenticated student and preserves academic details, wellness goals and sharing consent. Only submitted responses are stored; in-progress answers are held in page state and are not saved when leaving or refreshing. No clinical scoring, ML prediction, or engine integration is added.

Student-only endpoints: `GET /api/profile/me/initial-assessment` and `PUT /api/profile/me/initial-assessment`. PUT accepts `{ schemaVersion: "initial-wellness-v1", responses: { ... } }`; required choices are validated against the shared contract and optional notes are limited to 2,000 characters. Student ownership comes from authentication, not request fields.

Focused checks: `node --test backend/src/tests/initialWellnessAssessment.test.js` with `MONGOMS_DOWNLOAD_DIR` set as above.

### Existing wellness workflows

1. Register student and counsellor accounts. Counsellor login must fail until admin activation; public admin registration must fail.
2. Save profile, mood, WHO-5 and journal records. Edit/delete the journal; verify history and selected context update. Inspect chart data tables. WHO-5 bands are prototype heuristics; ML stress type is separate.
3. Prediction must require the complete 22-item survey. Save it, generate a real estimate and inspect provenance. Verify the uncalibrated-probability and No Stress limitation notices.
4. Install Ollama and pull `qwen3:1.7b` as documented in the root README. Opt in to assistant journal context in the student profile, write a relevant entry, and ask the assistant about that concern. Verify the UI's personalized-source indication matches the API's `context.usedSources`. If Ollama or the model is unavailable, verify the saved student message remains retryable and the UI shows local setup instructions; no scripted answer should appear.
5. Book a future hour/half-hour slot. Duplicate student/counsellor slots must fail. Approve as the assigned counsellor, add a private note and shared progress; only progress appears for the student.
6. Summary access requires profile AND appointment sharing. With both enabled and Ollama running locally, generate a briefing. Revoke permission while generation runs: the result must be withheld. Closed appointments must block counsellor summary/document access.
7. With Cloudinary configured, upload a small test PDF with explicit consent. Check unrelated-user denial, active-assigned-counsellor access, link expiry after 60 seconds, and deletion from both app and storage. Do not use personal medical documents for connectivity checks.
8. Submit feedback. Admin analytics must show aggregates without raw journals, comments or named stress estimates. Authorized account management still exposes account identities.

Record dates, environment, provider/model versions, screenshots and failures for these live/browser checks. No live-provider or visual-browser pass is asserted by automated results. Run db:check for legacy databases; fresh-database tests do not prove the old indexes were migrated.
