# Panya

Industrial operations console for PLC monitoring, incident triage, action workflows, and AI-assisted troubleshooting.

For the Thai handoff guide, see [README(th).md](./README(th).md).

## Overview

Panya is a full-stack monorepo with:

- a FastAPI backend for auth, chat, PLC data, alarms, and action workflows
- a React + Vite frontend for the authenticated operations console
- a retrieval-enabled assistant for PLC knowledge and troubleshooting
- a simulator-first PLC workflow that can fall back to real Modbus TCP integration

The current authenticated app is organized around these routes:

- `/overview` - plant overview, work orders, topology, machine priorities
- `/port-map` - zone map, zone panel, operator handoff, AI launch point
- `/equipment` - equipment fleet, diagnostics, log lookup, recovery actions
- `/alarms` - incident queue, diagnosis, planning, acknowledgement, resolution
- `/actions` - action history with filters and pagination
- `/chat` - knowledge assistant and machine/zone contextual chat

`/` redirects to `/overview`. Legacy `/portmap` redirects to `/port-map`.

## Current Stack

### Frontend

Location: `frontend/`

- React 18
- Vite 5
- React Router 7
- Axios
- Framer Motion
- Lucide React
- Native SVG/CSS charts and timeline UI

Important frontend areas:

- `src/App.jsx` - app shell and route registration
- `src/components/layout/AuthenticatedLayout.jsx` - sidebar/topbar/authenticated layout
- `src/features/ops/` - dashboard, port map, alarms, equipment, analytics, actions
- `src/features/ops/OpsSyncContext.jsx` - shared ops state for alarms/actions/machines/zones
- `src/hooks/useChatManager.js` - chat orchestration
- `src/utils/routes.js` - canonical app route constants

### Backend

Location: `backend/`

- FastAPI
- PostgreSQL + pgvector
- Redis
- LangChain ecosystem
- LangGraph-compatible workflow pieces
- Sentence Transformers
- Flashrank
- faster-whisper
- pymodbus

Important backend areas:

- `main.py` - FastAPI entrypoint
- `app/routes_auth.py` - login, registration, session/auth endpoints
- `app/routes_chat.py` - chat sessions, messages, source documents
- `app/routes_api.py` - health, agent utilities, transcription, misc API
- `app/routes_plc.py` - PLC route aggregation
- `app/routes_plc_data.py` - dashboard and PLC snapshot endpoints
- `app/routes_plc_alarms.py` - alarm list, acknowledge, resolve
- `app/routes_plc_actions.py` - diagnose, plan, approve, execution flows
- `app/plc/` - simulator, Modbus integration, PLC contracts and policies

### Runtime / Web Serving

There are two production-serving entrypoints:

- `server.js` - root production server for the monorepo deployment shape
- `frontend/server.cjs` - frontend-local production server for `frontend/dist`

Both serve the built frontend and proxy `/api` to the backend.

## Repository Layout

```text
Panya/
├─ backend/
│  ├─ app/
│  │  ├─ core/
│  │  ├─ plc/
│  │  ├─ routes_api.py
│  │  ├─ routes_auth.py
│  │  ├─ routes_chat.py
│  │  ├─ routes_plc.py
│  │  ├─ routes_plc_actions.py
│  │  ├─ routes_plc_alarms.py
│  │  └─ routes_plc_data.py
│  ├─ tests/
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

## Quick Start

### Prerequisites

- Node.js 18+
- Python 3.10+
- PostgreSQL with `pgvector`
- Redis
- Ollama or a configured remote LLM provider such as Groq

### 1. Install Dependencies

From the repo root:

```bash
npm install
cd frontend && npm install && cd ..
```

Set up the Python environment:

```bash
cd backend
python -m venv ../.venv
```

Activate it:

Windows:

```powershell
..\.venv\Scripts\activate
```

macOS/Linux:

```bash
source ../.venv/bin/activate
```

Install backend dependencies:

```bash
pip install -r requirements.txt
cd ..
```

### 2. Configure Environment

Create your local env file from the example:

```bash
cp .env.example .env
```

Review these first:

| Variable | Purpose |
|---|---|
| `APP_ENV` | Environment mode |
| `JWT_SECRET` | Auth/session signing secret |
| `DATABASE_URL` or `POSTGRES_*` | PostgreSQL connection |
| `REDIS_URL` | Redis connection |
| `OLLAMA_BASE_URL` | Local/remote Ollama target |
| `OLLAMA_MODEL` | Default local model |
| `GROQ_API_KEY` | Optional remote LLM provider |
| `PLC_CONNECTOR` | PLC mode selection |
| `FEATURE_AGENT_WORKFLOW` | Agent workflow toggle |
| `FEATURE_AUTOFIX_EXECUTION` | Execution/autofix behavior |

### 3. Start in Development

Recommended:

```bash
npm run dev
```

This does:

- starts the backend with `scripts/dev-backend.js`
- waits for `http://127.0.0.1:5000/health/live`
- starts the Vite frontend after the backend is live

### 4. Open the App

- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:5000`
- OpenAPI docs: `http://localhost:5000/docs`

## Docker Compose

The included `docker-compose.yml` runs:

- `postgres`
- `redis`
- `ollama`
- `backend`
- `frontend`
- `pgadmin` under the optional `debug` profile

Start the main stack:

```bash
docker compose up -d
```

Start pgAdmin only when needed:

```bash
docker compose --profile debug up -d pgadmin
```

Stop everything:

```bash
docker compose down
```

Remove volumes too:

```bash
docker compose down -v
```

## Development Scripts

### Root

| Command | What it does |
|---|---|
| `npm run dev` | Starts backend + waits + starts frontend |
| `npm run dev:backend` | Starts backend only |
| `npm run dev:frontend` | Starts frontend only |
| `npm run lint` | Frontend lint |
| `npm run build` | Frontend production build |
| `npm run test:backend` | Python unit tests |
| `npm run test:frontend` | Frontend normalizer/helper tests |
| `npm run test` | Backend + frontend tests |
| `npm run check:backend` | `python -m compileall backend/app` |
| `npm run check` | Lint + build + backend compile check |
| `npm run start` | Starts the root production web server |

### Frontend

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Production build |
| `npm run start` | Serve `dist` via `server.cjs` |
| `npm run lint` | ESLint |
| `npm run test:normalizers` | Lightweight frontend test suite |

## How the App Works

### Shared Ops State

The operational pages are not isolated views. They share one synchronized state layer:

- `frontend/src/features/ops/OpsSyncContext.jsx`

Dashboard, Port Map, Alarms, Equipment, Action History, and parts of Chat all derive their machine/alarm/action/zone state from there.

### Chat

1. User opens `/chat`
2. Frontend loads sessions and messages from `/api/chat/*`
3. Backend resolves either direct generation or retrieval-assisted generation
4. The response is written back into session history and rendered in the UI

### PLC / Ops Flow

1. Frontend reads dashboard and PLC state from `/api/plc/dashboard`
2. Live updates are streamed through `/api/plc/ws`
3. Alarms and actions are synchronized through `/api/plc/alarms` and `/api/plc/actions`
4. Shared derived state updates the overview, port map, alarms, equipment, and action history views together

### Port Map to AI Flow

1. Operator opens `/port-map`
2. Selects a zone and opens the zone panel
3. Launches AI handoff/chat with zone + machine + alarm context
4. Resulting resolution state propagates through shared ops state
5. Counts and indicators refresh across the dashboard and alarm surfaces

## Current Frontend Notes

- Canonical authenticated routes are defined in `frontend/src/utils/routes.js`
- The dashboard now uses lighter native SVG/CSS charts instead of a heavy charting dependency
- Action history is paginated and filtered rather than dumping all rows into one view
- Equipment uses a card-based fleet UI with diagnostics, logs, and AI escalation actions
- English and Thai locales are both supported

## Knowledge Ingestion

The backend supports embedding and indexing documents into pgvector.

Important files:

- `backend/embed.py`
- `backend/embed_cli.py`
- `backend/embed_files.py`
- `backend/app/embed_logic.py`
- `backend/app/ingest_state.py`

Example:

```bash
cd backend
python embed.py /data/Knowledge --collection plcnext
```

Useful env vars:

- `KNOWLEDGE_DIR`
- `MODEL_CACHE`
- `INGEST_STATE_PATH`
- `AUTO_EMBED_KNOWLEDGE`
- `ALLOW_STARTUP_INGEST_IN_PRODUCTION`
- `EMBED_MODEL`
- `EMBED_DEVICE`

## Main API Groups

Major route groups:

- `/api/auth/*`
- `/api/chat/*`
- `/api/plc/dashboard`
- `/api/plc/ws`
- `/api/plc/alarms*`
- `/api/plc/actions*`
- `/health`
- `/health/live`
- `/health/ready`
- `/metrics`

Use the FastAPI docs at `http://localhost:5000/docs` for the current schema.

## Testing and Validation

Recommended checks before commit:

```bash
npm run lint
npm run test
npm run build
npm run check:backend
```

Useful direct checks:

```bash
cd frontend
npm run test:normalizers
```

```bash
python -m unittest discover -s backend/tests -p "test_*.py"
python -m compileall backend/app
```

## Production Notes

- `server.js` serves `frontend/dist` and proxies `/api` to the backend
- `frontend/server.cjs` is useful when serving the frontend build standalone
- Static assets are cacheable; `index.html` stays `no-cache`
- Proxy loop protection exists in `server.js` to catch bad `API_PROXY_TARGET` values

## Contributor Notes

- Keep backend route changes aligned with frontend callers
- Treat ops pages as one synchronized system, not separate dashboards
- Prefer route constants over hardcoded app paths
- Keep tests cheap and focused for frontend helpers and state derivation
- Do not commit real secrets from `.env`

## License

No license file is currently included in this repository. Add one if you plan to distribute the project externally.
