# Module 8 — Platform administration

The Admin workspace supports a platform/program administrator: counsellor requests, basic account management, participation reports and voluntary user feedback. Technical performance, request routes, model/prediction information, intelligence context and research monitoring are not displayed or returned by the Admin overview.

## Access and counsellor requests

All `/api/admin` routes retain `requireAuth` and `allowRoles("admin")`. Inactive accounts cannot authenticate. Public administrator registration remains disabled. Existing counsellor registration creates an inactive account, and the existing `isActive` gate still controls sign-in and the available-counsellor list.

- `GET /api/admin/counsellor-requests?reviewStatus=pending|approved|rejected&page=1` returns paginated basic accounts and the existing qualification/specialization registration fields.
- `PATCH /api/admin/counsellor-requests/:id` accepts `{ "decision": "approved" }` or `{ "decision": "rejected" }`. Only a pending counsellor can be reviewed; repeated/conflicting reviews return 409. Approval activates the account; rejection keeps it inactive.
- One optional, non-public User field, `counsellorReviewStatus`, persists Admin decisions. No migration or historical backfill is performed. Existing active or previously signed-in counsellors are treated as approved; inactive accounts without a recorded decision or sign-in history need review. The UI identifies these inferred statuses. Historical rejection and deactivation cannot always be distinguished because the old system recorded only active/inactive.
- Existing `PATCH /api/admin/users/:id/status` activation/deactivation remains supported. Activation also records approval for counsellors; deactivation preserves their approval status. Administrators cannot deactivate themselves.

## Basic user management

`GET /api/admin/users` accepts search, role, active/inactive status, page and limit (maximum 100; default 25). It returns name, email, role, active status, registration date and latest sign-in. Counsellor review status is included for counsellor accounts. Search treats input as literal text. No private profile, wellness response, prediction, journal, conversation, counselling note or feedback comment is returned.

## Dashboard and reports

`GET /api/admin/overview?period=weekly|monthly` uses `adminOverviewService.js` to return only aggregate counts and ratings. The summary contains total student accounts, enabled counsellors, pending requests, students/counsellors with a last sign-in within 30 days, and all-time feedback averages/counts.

Weekly reports cover the last 7 rolling days; monthly reports cover the last 30 rolling days. Each compares an equal preceding period. Daily groupings use Asia/Kolkata; the first and last daily bins can be partial. The start/end timestamps are included. Zero bins mean no retained records, not invented activity.

Usage counts come from existing saved records: mood check-ins, journal entries, WHO-5 wellness check-ins, student messages to the AI Assistant (assistant replies are excluded), counselling messages from either participant, and appointments booked. Each uses its creation timestamp, so a backdated mood check-in counts when saved. Completed sessions are separately counted by scheduled date and current completed status, not added to activity totals. Active students are distinct existing student accounts across those sources, including completed sessions; account activation alone and browsing without saved activity do not count. Registration totals include all account roles.

Feedback currently records ease of use (`rating`) and helpfulness, not a separate satisfaction question. Both are displayed with their response count. A descriptive comparison is displayed only with at least two responses in each period; no missing rating is treated as zero. Response counts are not unique-person counts. Comments and respondent identities are never returned.

## Data limits and verification

Deleted activity is absent from reports. Historical sign-in events and exact session-completion timestamps do not exist, so reports do not claim login trends, attendance duration or completion-time trends. Ratings describe voluntary feedback, not clinical effectiveness or a representative satisfaction survey. Small aggregate counts should not be interpreted as statistical anonymity.

Focused tests: `backend/src/tests/admin.test.js` and `backend/src/tests/admin.browser.mjs` use disposable MongoDB without loading `.env` or accessing/resetting the application database. Browser checks cover Admin login, approval/rejection, user management, reports, empty/available feedback, privacy/access control and responsive layouts. The existing Admin assertions in `researchFlows.test.js` use the current overview response.
