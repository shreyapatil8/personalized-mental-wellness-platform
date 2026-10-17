# Module 5 - AI Conversational Assistant

Module 5 adds the student-facing chat assistant. It uses Module 4 to prepare curated wellness context before generating a response.

## Backend Files

- `backend/src/models/ConversationMessage.js` stores student and assistant messages.
- `backend/src/services/assistantService.js` saves messages, generates Module 4 context, and creates assistant replies.
- `backend/src/services/localAssistantProvider.js` calls Ollama's local `/api/chat` endpoint with the selected student context and recent saved messages.
- `backend/src/controllers/chatController.js` exposes REST chat handlers.
- `backend/src/routes/chatRoutes.js` exposes student-only chat endpoints.
- `backend/src/socket.js` adds authenticated Socket.io events.

## Frontend Files

- `frontend/src/pages/AssistantPage.jsx` provides the student chat workspace.
- `frontend/src/App.jsx` mounts the protected `/assistant` route.
- `frontend/src/components/Layout.jsx` adds the Assistant navigation item for students.
- `frontend/vite.config.js` proxies `/socket.io` traffic to the backend during local development.

## API Routes

All routes require a valid student JWT.

- `GET /api/chat/messages`
- `POST /api/chat/messages`

## Socket Events

The client connects with JWT auth.

- Client sends: `chat:send`
- Server emits: `chat:reply`
- Server emits errors: `chat:error`

## Local Ollama Setup

Add these values to `backend/.env`:

```bash
ASSISTANT_OLLAMA_BASE_URL=http://127.0.0.1:11434
ASSISTANT_OLLAMA_MODEL=qwen3:1.7b
ASSISTANT_OLLAMA_TIMEOUT_MS=180000
```

The assistant requires no paid API key. If Ollama or the selected model is unavailable, the student's message remains saved and the API returns setup guidance for retry; no scripted response is presented as AI output. New replies are saved with the `ollama` or `safety_message` source. Local requests have a configurable timeout, 4K context, and reject incomplete, empty, malformed, or oversized output. A mocked provider test does not establish that Ollama is installed or that a real model has generated a response.

## Safety Boundary

The assistant is wellness support only. It does not diagnose, prescribe treatment, replace counsellors, or handle emergencies.
