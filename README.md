# Panya

Panya is an industrial operations console that combines:

- a FastAPI backend for authentication, chat, PLC data, alarms, and actions
- a React/Vite frontend for dashboard, port map, incident triage, equipment, and chat
- a retrieval-augmented chatbot for PLC documentation
- a simulator-first PLC workflow that can fall back to real Modbus TCP integration

For the Thai handoff guide, see [README(th).md](./README(th).md).

## What the project does

Panya is built for operations and maintenance workflows around PLC systems. The app supports:

- chat-based PLC troubleshooting with document retrieval
- live PLC monitoring with REST snapshot + WebSocket stream
- incident triage and action planning
- port map visualization with AI handoff flow
- equipment diagnostics and action history
- English and Thai UI localization

## Architecture

### Frontend

Location: `frontend/`

Main stack:

- React 18
- Vite
- React Router
- Axios
- Recharts
- Framer Motion
- Lucide React

Main app structure:

- `src/App.jsx`: top-level app shell, providers, routes
- `src/features/plc/`: PLC live data context and payload normalizers
- `src/features/ops/`: operational UI modules
- `src/hooks/useChatManager.js`: chat page orchestration
- `src/features/ops/OpsSyncContext.jsx`: shared source of truth for alarms, actions, machines, and zone summaries
- `src/pages/chat/`: chat UI components

Operational modules:

- `dashboard/`: overview cards, charts, machine queue
- `port-map/`: zone map, zone summary panel, AI handoff entry
- `alarms/`: incident queue, decision panel, diagnose/plan/approve flow
- `equipment/`: equipment fleet and diagnostics
- `actions/`: action history and filters
- `analytics/`: predictive/summary panels

### Backend

Location: `backend/`

Main stack:

- FastAPI
- psycopg2 + PostgreSQL
- pgvector
- Redis
- LangChain / LangGraph-compatible retrieval flow
- SentenceTransformers
- Flashrank / optional cross-encoder reranking
- faster-whisper

Runtime entrypoint:

- `backend/main.py`

Important backend modules:

- `app/routes_auth.py`: login, registration, auth/session endpoints
- `app/routes_chat.py`: chat sessions, chat messages, source file delivery
- `app/routes_api.py`: health, metrics, agent endpoints, transcription, misc API
- `app/routes_plc.py`: PLC route aggregation
- `app/routes_plc_data.py`: PLC dashboard/snapshot data
- `app/routes_plc_alarms.py`: alarm listing, acknowledge, resolve
- `app/routes_plc_actions.py`: diagnose, plan, approve action flows
- `app/chatbot.py`: prompt construction, retrieval orchestration, output normalization
- `app/retriever.py`: pgvector retrieval, hybrid keyword retrieval, reranking
- `app/plc/`: simulator, Modbus connector, contracts, action policy
- `app/core/`: rate limiting, Redis client, metrics, retention, PLC ingestion, upload guards, WS tickets

### Deployment/runtime layers

There are two web server entrypoints:

- `server.js`: root production web server for the monorepo deployment shape
- `frontend/server.cjs`: frontend-local production server that serves `frontend/dist` and proxies `/api`

## Current system flow

### Chat

1. User opens `/chat`
2. Frontend calls `/api/chat/*` endpoints for session and message management
3. Backend chat route selects either:
   - direct LLM response, or
   - RAG flow via retriever + reranker + LLM
4. Reply is stored in chat history and rendered in the chat UI

### PLC and ops sync

1. `usePlcLiveData` loads `/api/plc/dashboard` and opens `/api/plc/ws`
2. `OpsSyncContext` loads `/api/plc/alarms` and `/api/plc/actions`
3. Frontend derives machines, recent alarms, recent actions, and zone summaries from shared state
4. Dashboard, Port Map, Alerts, Equipment, and Chat all read from that shared context

### Ask AI from Port Map

1. User selects a zone in Port Map
2. Zone panel stays open and offers `Ask AI`
3. Chat opens with zone context
4. After AI/mock resolution completes, resolved alarms and machine recovery propagate through shared ops state
5. Port map, alerts, dashboard, and related counts update together

## Repository layout

```text
Panya/
├─ backend/
│  ├─ app/
│  │  ├─ chat_agent/
│  │  ├─ core/
│  │  ├─ plc/
│  │  ├─ routes_api.py
│  │  ├─ routes_auth.py
│  │  ├─ routes_chat.py
│  │  ├─ routes_plc.py
│  │  ├─ routes_plc_actions.py
│  │  ├─ routes_plc_alarms.py
│  │  ├─ routes_plc_data.py
│  │  ├─ chatbot.py
│  │  ├─ retriever.py
│  │  └─ ...
│  ├─ tests/
│  ├─ embed.py
│  ├─ main.py
│  └─ requirements.txt
├─ frontend/
│  ├─ src/
│  │  ├─ components/
│  │  ├─ features/
│  │  │  ├─ auth/
│  │  │  ├─ ops/
│  │  │  ├─ plc/
│  │  │  └─ theme/
│  │  ├─ hooks/
│  │  ├─ locales/
│  │  ├─ pages/
│  │  ├─ styles/
│  │  └─ utils/
│  ├─ package.json
│  └─ server.cjs
├─ scripts/
├─ docker-compose.yml
├─ package.json
└─ server.js
```

## Local development

### Prerequisites

- Node.js 18+
- Python 3.10+ (3.11 also works in this repo)
- PostgreSQL with `pgvector`
- Redis
- Ollama or Groq API access

### 1. Install dependencies

Root:

```bash
npm install
```

Frontend:

```bash
cd frontend
npm install
cd ..
```

Backend:

```bash
cd backend
python -m venv ../.venv
```

Windows:

```powershell
..\.venv\Scripts\activate
```

macOS/Linux:

```bash
source ../.venv/bin/activate
```

Then:

```bash
pip install -r requirements.txt
cd ..
```

### 2. Configure environment

Copy the example file:

```bash
cp .env.example .env
```

Important values to review:

- `APP_ENV`
- `DATABASE_URL` or `POSTGRES_*`
- `REDIS_URL`
- `JWT_SECRET`
- `OLLAMA_BASE_URL`
- `OLLAMA_MODEL`
- `GROQ_API_KEY`
- `PLC_CONNECTOR`
- `FEATURE_AGENT_WORKFLOW`
- `FEATURE_AUTOFIX_EXECUTION`

### 3. Start the app

Recommended dev command:

```bash
npm run dev
```

This starts:

- backend via `scripts/dev-backend.js`
- frontend dev server after `/health/live` is available

### 4. Open the app

- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:5000`
- OpenAPI docs: `http://localhost:5000/docs`

## Docker Compose

The included `docker-compose.yml` runs the main stack:

- `postgres`
- `redis`
- `ollama`
- `backend`
- `frontend`
- `pgadmin` under the optional `debug` profile

Start core services:

```bash
docker compose up -d
```

Start pgAdmin only when needed:

```bash
docker compose --profile debug up -d pgadmin
```

Stop services:

```bash
docker compose down
```

Delete volumes too:

```bash
docker compose down -v
```

## Scripts

Root scripts:

- `npm run dev`: backend + frontend
- `npm run lint`: frontend lint
- `npm run build`: frontend production build
- `npm run test`: backend + frontend tests
- `npm run test:backend`
- `npm run test:frontend`
- `npm run check`: lint + build + backend compile check
- `npm run start`: run root production web server

Frontend scripts:

- `npm run dev`
- `npm run build`
- `npm run start`
- `npm run lint`
- `npm run test:normalizers`

## Data and knowledge ingestion

The backend supports document ingestion into pgvector.

Key files:

- `backend/embed.py`
- `backend/embed_cli.py`
- `backend/embed_files.py`
- `backend/app/embed_logic.py`
- `backend/app/ingest_state.py`

Common workflow:

```bash
cd backend
python embed.py /data/Knowledge --collection plcnext
```

Common related env values:

- `KNOWLEDGE_DIR`
- `MODEL_CACHE`
- `INGEST_STATE_PATH`
- `AUTO_EMBED_KNOWLEDGE`
- `ALLOW_STARTUP_INGEST_IN_PRODUCTION`
- `EMBED_MODEL`
- `EMBED_DEVICE`

## Main API groups

The exact routes are defined in the route files, but these are the major groups:

- Auth: `/api/auth/*`
- Chat sessions/messages: `/api/chat/*`
- Agent/misc API: `/api/agent-chat`, `/api/agent/action`, `/api/transcribe`
- Health/metrics: `/health`, `/health/live`, `/health/ready`, `/metrics`
- PLC dashboard and realtime: `/api/plc/dashboard`, `/api/plc/ws`
- PLC alarms: `/api/plc/alarms*`
- PLC actions/workflow: `/api/plc/actions*`, `/api/plc/diagnose`

If you change or add endpoints, keep frontend callers aligned with backend routes.

## Testing and validation

Recommended validation before commit:

```bash
npm run lint
npm run test
npm run build
npm run check:backend
```

Project-specific checks already used in this repo:

```bash
cd frontend
npm run test:normalizers
```

```bash
python -m unittest discover -s backend/tests -p "test_*.py"
python -m compileall backend/app
```

## Notes for contributors

### Shared frontend state

Do not treat each ops page as an isolated feature. These pages are expected to stay synchronized:

- Dashboard
- Port Map
- Alerts
- Equipment
- Action History
- Chat-driven incident resolution

The main shared state layer is:

- `frontend/src/features/ops/OpsSyncContext.jsx`

### Chat-specific notes

- The assistant output is intended to be English-first
- The UI can still be localized
- Prompt chips and operational examples should stay consistent with the chatbot persona

### Safe editing guidance

Prefer changing:

- shared hooks
- view models
- central contexts
- route handlers that are already part of the same feature flow

Avoid introducing duplicate state sources when the data already exists in:

- `usePlcLiveData`
- `OpsSyncContext`
- backend route families for alarms/actions/chat

## Troubleshooting

### Frontend shows HTML instead of API JSON

Check API proxy settings:

- root production server uses `API_PROXY_TARGET`
- frontend production server also uses `API_PROXY_TARGET`

Do not point the proxy target back to the frontend itself.

### Chat returns fallback text / no RAG answer

Check:

- Ollama availability
- model pulled at `OLLAMA_MODEL`
- embedder/model cache readiness
- document ingestion completed
- `LOAD_EMBEDDER_ON_DEMAND`

### PLC data not updating

Check:

- `PLC_CONNECTOR`
- backend `/health/ready`
- `/api/plc/dashboard`
- `/api/auth/ws-ticket`
- WebSocket connection to `/api/plc/ws`

### Alerts and Port Map look out of sync

Start with:

- `frontend/src/features/ops/OpsSyncContext.jsx`
- `frontend/src/features/ops/port-map/zoneModel.js`
- `frontend/src/hooks/useChatManager.js`

## Recommended onboarding order

If you are new to the codebase, read in this order:

1. `package.json`
2. `backend/main.py`
3. `frontend/src/App.jsx`
4. `frontend/src/features/plc/PlcLiveDataContext.jsx`
5. `frontend/src/features/ops/OpsSyncContext.jsx`
6. `frontend/src/hooks/useChatManager.js`
7. relevant feature module you plan to edit

## License / project note

This README documents the current internal project structure and runtime behavior based on the repository state in this workspace.
