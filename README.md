# Personalized Mental Wellness Platform

Research prototype for student wellness tracking, Eustress/Distress classification, selective conversational context and consent-based counsellor support. Not a diagnostic or emergency service.

- [Research architecture](docs/research-architecture.md)
- [ML reproduction](ml/README.md)
- [Human evaluation protocol](research/human-evaluation-protocol.md)
- [Workflow checks](docs/end-to-end-testing.md)
- [Project test results — 8 October 2026](docs/project-testing-2026-10-08.md)

## Run locally — Windows PowerShell, project root

Requires Node 20+, pnpm, Python 3.13 for the saved model environment, and MongoDB.

```powershell
pnpm install --store-dir .pnpm-store
pnpm setup:local
# Configure MONGODB_URI in backend/.env.
python -m venv ml/.venv
& ml/.venv/Scripts/python.exe -m pip install -r ml/requirements-lock.txt
pnpm dev
```

On macOS/Linux use ml/.venv/bin/python. Frontend: http://localhost:5173; backend: http://localhost:5000.

The setup command preserves database/provider settings, replaces a weak placeholder JWT secret and removes retired ML paths. A private .env.pre-research backup is created once. Secret changes require signing in again. Keep CLIENT_ORIGIN and frontend/.env aligned.

The backend defaults to ml/.venv and ml/models/stress-type-model.joblib; optional PYTHON_EXECUTABLE and ML_MODEL_PATH override them. Missing models return 503 without substitute predictions.

## Accounts and services

Students self-register; counsellors require admin activation. Public admin registration is disabled. Provision the initial administrator locally (hidden password prompt):

```powershell
pnpm --filter backend admin:create
```

### Local AI (no API key, cloud service, or paid inference)

The student assistant and optional counsellor briefing use Ollama's local HTTP API. In PowerShell, install Ollama and download the small Qwen3 1.7B instruction model:

```powershell
irm https://ollama.com/install.ps1 | iex
# Close and reopen PowerShell after installation if the `ollama` command is not found.
ollama pull qwen3:1.7b
ollama run qwen3:1.7b "Reply with: local model ready"
```

Ollama's Qwen3 1.7B Q4 model download is about 1.4 GB. The 4K context setting keeps runtime memory more appropriate for an 8 GB Windows laptop; Ollama and Windows still need additional RAM, so close memory-heavy applications if generation is slow. No model is downloaded automatically. The app calls only the loopback endpoint by default (`http://127.0.0.1:11434`) and rejects cloud model aliases and non-local endpoints.

`backend/.env.example` contains safe defaults. Copy the `ASSISTANT_OLLAMA_BASE_URL`, `ASSISTANT_OLLAMA_MODEL`, and `ASSISTANT_OLLAMA_TIMEOUT_MS` values into `backend/.env` if needed; defaults are `http://127.0.0.1:11434`, `qwen3:1.7b`, and 180000 ms. No OpenAI key or other paid AI credentials are required or used. Start MongoDB, then run:

At backend startup, a short local metadata check logs whether the configured model is available and prints setup guidance if Ollama or the model is missing. This check does not generate text or prevent the rest of the application from starting.

```powershell
pnpm setup:local
pnpm dev
```

Open http://localhost:5173, sign in as a student, and open **AI assistant**. To verify saved context is used, opt in to assistant journal context in Profile, add a recent mood entry (or an assessment), then send a related concern such as “I feel unmotivated and stressed about exams.” A successful reply will show “Personalized using your …” only for sources actually retrieved for that request. The request is sent to the local Ollama process. If Ollama or the model is missing, the app saves the student's message and shows installation/pull instructions with a retry action; it does not return a scripted pretend answer. Student chats are separate database-backed conversations. Counsellor briefings remain local-only, and the factual overview remains available when Ollama is unavailable; see [local briefing setup](docs/local-counsellor-briefing.md).

Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET for optional private PDFs up to 500 KB. Explicit sharing and an active appointment are required. Authenticated download links expire after 60 seconds. Live account verification remains necessary.

Before using an existing database, run the read-only audit:

```powershell
pnpm --filter backend db:check
```

See [database migration notes](docs/database-migration.md). No existing database was seeded or migrated during this work.

## Verification

```powershell
$env:MONGOMS_DOWNLOAD_DIR = Join-Path (Get-Location) '.test-cache/mongodb'
pnpm test
& ml/.venv/Scripts/python.exe -m unittest discover -s ml -p test_contract.py -v
pnpm lint
pnpm build
pnpm test:browser
pnpm research:context
```

API tests use disposable MongoDB and the actual saved classifier. The first run downloads MongoDB. Provider tests use mocks, and context results use authored engineering fixtures; neither represents participant outcomes.

`pnpm test` runs backend and frontend tests. `pnpm test:browser` builds the frontend and runs all six Chrome suites sequentially with disposable databases. Chrome defaults to `C:/Program Files/Google/Chrome/Application/chrome.exe`; set `CHROME_PATH` if installed elsewhere. Browser tests do not load the application's `.env` or connect to its configured database. The test process needs permission to launch Chrome, start MongoDB and access loopback HTTP/WebSocket servers.

Demo seeding changes demo-account records. Use only a disposable database, explicitly set ALLOW_DEMO_SEED=true, then run pnpm seed:demo. Demo data must never be counted as research findings; no ML estimate is prefilled.
