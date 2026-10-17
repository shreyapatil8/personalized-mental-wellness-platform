# Module 2 - Wellness Tracking

Module 2 builds longitudinal wellness history for context selection, assistant replies, counsellor briefings and dashboards. The classifier uses the separate 22-item research survey, not invented features from this history.

WHO-5 sums five responses scored 0–5 and multiplies the total by four; higher scores indicate better reported well-being. See the [WHO instrument](https://www.who.int/publications/m/item/WHO-UCN-MSD-MHE-2024.01). The prototype's additional low/moderate/high support flags are application heuristics, not validated clinical severity categories.

## Backend Files

- `backend/src/models/MoodLog.js` stores daily mood, stress level, sleep hours, and notes.
- `backend/src/models/JournalEntry.js` stores private journal reflections, tags, and sentiment labels.
- `backend/src/models/Assessment.js` stores WHO-5 responses, raw score, percentage score, and risk level.
- `backend/src/controllers/trackingController.js` contains CRUD handlers and summary aggregation.
- `backend/src/routes/trackingRoutes.js` exposes student-only tracking endpoints.
- `backend/src/utils/wellnessScoring.js` contains WHO-5 scoring and mood trend helpers.

## API Routes

All routes require a valid student JWT.

- `GET /api/tracking/summary`
- `GET /api/tracking/assessment/questions`
- `GET /api/tracking/assessments`
- `POST /api/tracking/assessments`
- `GET /api/tracking/moods`
- `POST /api/tracking/moods`
- `PUT /api/tracking/moods/:id`
- `DELETE /api/tracking/moods/:id`
- `GET /api/tracking/journals`
- `POST /api/tracking/journals`
- `PUT /api/tracking/journals/:id`
- `DELETE /api/tracking/journals/:id`

## WHO-5 Scoring

The WHO-5 assessment has five questions. Each response is scored from 0 to 5.

- Raw score range: 0 to 25
- Percentage score: raw score multiplied by 4
- High risk: below 32
- Moderate risk: 32 to 51
- Low risk: 52 and above

## Frontend Files

- `frontend/src/pages/TrackingPage.jsx` provides mood, journal, and assessment tabs.
- `frontend/src/components/Layout.jsx` adds the student tracking navigation item.
- `frontend/src/pages/DashboardPage.jsx` links students to the tracking workspace.

## Verification

Run:

```bash
pnpm --filter backend test
pnpm --filter backend check
pnpm --filter frontend build
```
