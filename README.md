# 🏭 Panya — PLC Assistant

An AI-powered knowledge assistant for **industrial automation** and **PLC** operations. Built with **RAG (Retrieval-Augmented Generation)**, real-time PLC monitoring, and an agentic workflow engine for automated diagnostics and corrective actions.

---

## ✨ Key Features

| Category                 | Features                                                                                                    |
| ------------------------ | ----------------------------------------------------------------------------------------------------------- |
| **AI Chat**              | RAG-powered Q&A from your PLC documentation, multi-turn conversations, source citations, Markdown rendering |
| **PLC Live Monitoring**  | Real-time WebSocket data stream, machine status cards, OEE trend charts, alarm management                   |
| **Agentic Workflow**     | AI-driven root cause analysis, auto-suggested corrective actions, action log tracking                       |
| **Multi-Input**          | Text and voice input (Whisper STT)                                                                          |
| **Evaluation**           | Built-in RAGAS evaluation pipeline for answer quality metrics                                               |
| **Auth & Security**      | JWT authentication, CSRF protection, Redis-backed rate limiting, role-based access                          |
| **Internationalization** | English & Thai (🇬🇧 / 🇹🇭)                                                                                    |
| **Theming**              | Dark / Light mode with glassmorphism UI                                                                     |

---

## 🛠 Tech Stack

| Layer                  | Technology                                                               |
| ---------------------- | ------------------------------------------------------------------------ |
| **Frontend**           | React 18 · Vite · Tailwind CSS · Framer Motion · Recharts · Lucide Icons |
| **Backend**            | FastAPI (Python) · LangChain · LangGraph                                 |
| **LLM**                | Groq (`llama-3.3-70b-versatile`) — also supports Ollama (local LLaMA)    |
| **Embeddings**         | `BAAI/bge-m3` via SentenceTransformers                                   |
| **Database**           | PostgreSQL + pgvector                                                    |
| **Cache / Rate Limit** | Redis 7                                                                  |
| **PLC Connector**      | Modbus TCP (pymodbus) / Built-in Simulator                               |
| **STT**                | faster-whisper                                                           |
| **Evaluation**         | RAGAS                                                                    |
| **Deployment**         | Docker Compose · Railway                                                 |

---

## 📁 Project Structure

```
Panya/
├── backend/                    # FastAPI backend
│   ├── main.py                 # App entrypoint, lifespan, middleware
│   ├── embed.py                # Standalone embedding / ingest CLI
│   ├── app/
│   │   ├── routes_api.py       # General API routes
│   │   ├── routes_auth.py      # Auth endpoints (login/register/refresh)
│   │   ├── routes_chat.py      # Chat & RAG endpoints
│   │   ├── routes_plc.py       # PLC data, alarms, actions, WebSocket
│   │   ├── chatbot.py          # LLM orchestration, agent workflow
│   │   ├── retriever.py        # Vector search + FlashRank reranker
│   │   ├── llm.py              # LLM provider factory (Groq / Ollama)
│   │   ├── db.py               # Database connection & schema
│   │   ├── security.py         # JWT, password hashing, CSRF
│   │   ├── auth.py             # Auth dependency injection
│   │   ├── embed_logic.py      # Chunking & embedding logic
│   │   ├── ingest_state.py     # Incremental ingest state tracking
│   │   ├── ragas_eval.py       # RAGAS evaluation pipeline
│   │   ├── seed.py             # Golden QA seeding
│   │   ├── plc/                # PLC integration
│   │   │   ├── connector.py    # Abstract PLC connector
│   │   │   ├── simulator.py    # Built-in PLC simulator (dev)
│   │   │   ├── modbus_connector.py  # Modbus TCP connector (prod)
│   │   │   ├── diagnostic.py   # AI-powered PLC diagnostics
│   │   │   ├── action_policy.py    # Action approval policies
│   │   │   ├── contracts.py    # Data contracts / schemas
│   │   │   └── mapping.py      # Register ↔ tag mapping
│   │   └── core/               # Cross-cutting concerns
│   │       ├── rate_limit.py   # Redis-backed rate limiter
│   │       ├── redis_client.py # Redis connection
│   │       ├── metrics.py      # Request counters
│   │       ├── retention.py    # Data retention cleanup
│   │       ├── plc_ingest.py   # Background alarm ingestion
│   │       ├── upload_guard.py # Upload size/type validation
│   │       └── ws_ticket.py    # WebSocket auth tickets
│   ├── data/                   # PLC mapping configs
│   └── requirements.txt
│
├── frontend/                   # React + Vite SPA
│   ├── src/
│   │   ├── App.jsx             # Root: routing, auth, theme, providers
│   │   ├── pages/
│   │   │   ├── Chat.jsx        # Knowledge Assistant chat page
│   │   │   ├── chat/           # Chat sub-components
│   │   │   │   ├── ChatComposer.jsx
│   │   │   │   ├── ChatMessages.jsx
│   │   │   │   ├── ChatSidebar.jsx
│   │   │   │   ├── ChatWelcome.jsx
│   │   │   │   ├── ThinkingIndicator.jsx
│   │   │   │   └── markdown.jsx
│   │   │   ├── Login.jsx
│   │   │   └── Register.jsx
│   │   ├── features/
│   │   │   ├── ops/            # Operations module
│   │   │   │   ├── dashboard/  # Plant overview, OEE charts, machine queue
│   │   │   │   ├── alarms/     # Alarm list, incident analysis panel
│   │   │   │   └── actions/    # AI action log, timeline, filters
│   │   │   ├── plc/            # PLC live data context & normalizers
│   │   │   └── auth/           # Auth context & session hooks
│   │   ├── components/
│   │   │   ├── Sidebar.jsx     # Main navigation sidebar
│   │   │   ├── GooeyNav.jsx    # Animated bottom nav
│   │   │   └── ui/             # Shared UI primitives
│   │   │       ├── GlassSurface.jsx
│   │   │       ├── DataTable.jsx
│   │   │       ├── MetricTile.jsx
│   │   │       ├── SectionCard.jsx
│   │   │       ├── StatusPill.jsx
│   │   │       ├── Skeleton.jsx
│   │   │       └── ...
│   │   ├── hooks/              # usePlcLiveData, useVoiceRecording, ...
│   │   ├── utils/              # API client, i18n, feature flags, markdown
│   │   ├── locales/            # en.json, th.json
│   │   └── styles/             # Design tokens, glass, layout, responsive
│   ├── server.cjs              # Production Express server (serves dist + API proxy)
│   └── package.json
│
├── scripts/
│   ├── dev-backend.js          # Dev backend launcher (uvicorn + venv detection)
│   └── ingest_knowledge.sh     # Knowledge ingest helper
│
├── server.js                   # Root production web server (proxy + static)
├── docker-compose.yml          # 6-service stack (see below)
├── Dockerfile                  # Single-service production image
├── .env.example                # All configuration variables
└── package.json                # Monorepo dev scripts (concurrently)
```

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** ≥ 18
- **Python** ≥ 3.10 with a virtual environment
- **PostgreSQL** with pgvector extension
- **Redis** (for rate limiting)
- **Groq API key** (or local Ollama)

### Local Development

```bash
# 1. Clone
git clone https://github.com/LethimCookMyBro/FAHHHHHHHHH_THISSHITKICKMYASS.git
cd Panya

# 2. Environment
cp .env.example .env
# Edit .env → set GROQ_API_KEY, DATABASE_URL, etc.

# 3. Backend setup
cd backend
python -m venv ../.venv
source ../.venv/bin/activate        # Linux/macOS
# ..\.venv\Scripts\activate         # Windows
pip install -r requirements.txt
cd ..

# 4. Frontend setup
cd frontend
npm install
cd ..

# 5. Install root dev deps
npm install

# 6. Start both (API + Web dev servers)
npm run dev
```

### Access

| Service         | URL                        |
| --------------- | -------------------------- |
| **Frontend**    | http://localhost:5173      |
| **Backend API** | http://localhost:5000      |
| **API Docs**    | http://localhost:5000/docs |

---

## 🐳 Docker Compose

The `docker-compose.yml` runs the full stack with 6 services.
`pgadmin` is on the optional `debug` profile and is not started by default.

| Service      | Image                         | Port  |
| ------------ | ----------------------------- | ----- |
| **postgres** | `pgvector/pgvector:pg16`      | 5432  |
| **redis**    | `redis:7-alpine`              | 6379  |
| **ollama**   | `ollama/ollama` (GPU)         | 11435 |
| **backend**  | Custom (FastAPI)              | 5000  |
| **frontend** | Custom (Vite build + Express) | 5173  |
| **pgadmin**  | `dpage/pgadmin4`              | 5050  |

```bash
# Start all core services
docker compose up -d

# Start pgAdmin only when needed
docker compose --profile debug up -d pgadmin

# Run an isolated audit stack with a different project/port set
BACKEND_PORT=15000 FRONTEND_PORT=15173 POSTGRES_PUBLISHED_PORT=15432 REDIS_PORT=16379 OLLAMA_PUBLISHED_PORT=11445 docker compose -p panya-audit up -d

# Pull LLM model (if using Ollama)
docker compose exec ollama ollama pull llama-3.3-70b-versatile

# View logs
docker compose logs -f backend

# Stop (keeps data)
docker compose down

# Stop and delete all data
docker compose down -v
```

**pgAdmin access:** http://localhost:5050 using `PGADMIN_DEFAULT_EMAIL` / `PGADMIN_DEFAULT_PASSWORD`

Backend database config resolves in this order: `DATABASE_URL`, then `PG*`, then `POSTGRES_*`.

---

## 📚 Document Embedding

The embed pipeline supports **incremental ingestion** with checksum-based deduplication.

| Behavior             | Description                   |
| -------------------- | ----------------------------- |
| Same checksum        | Skip (already embedded)       |
| New file             | Embed and index               |
| Changed checksum     | Replace old chunks, embed new |
| First run (no state) | Bootstrap state from DB       |

```bash
# Manual embed (Docker)
docker compose exec backend python embed.py /data/Knowledge \
  --collection plcnext \
  --knowledge-root /data/Knowledge \
  --state-path /data/ingest/state.json \
  --skip-mode checksum \
  --bootstrap-from-db \
  --replace-updated

# Dry-run preview
docker compose exec backend python embed.py /data/Knowledge --dry-run

# Helper script (Railway)
sh /app/scripts/ingest_knowledge.sh
# Full rebuild
INGEST_MODE=rebuild sh /app/scripts/ingest_knowledge.sh
```

<details>
<summary><b>All Embed Options</b></summary>

| Option                  | Default             | Description                                        |
| ----------------------- | ------------------- | -------------------------------------------------- |
| `--collection`          | `plcnext`           | Vector store collection name                       |
| `--knowledge-root`      | `KNOWLEDGE_DIR`     | Root path for `source_key`                         |
| `--state-path`          | `INGEST_STATE_PATH` | Persistent ingest state JSON                       |
| `--device`              | `auto`              | Embedding device (`auto`, `cpu`, `cuda`, `cuda:N`) |
| `--skip-mode`           | `checksum`          | Skip by `checksum` or `filename`                   |
| `--bootstrap-from-db`   | `true`              | Build state from existing DB if state missing      |
| `--replace-updated`     | `true`              | Replace old rows when checksum changes             |
| `--replace-all`         | `false`             | Force rebuild all discovered sources               |
| `--prune-missing`       | `false`             | Delete rows for files missing from disk            |
| `--chunk-size`          | `800`               | Characters per chunk                               |
| `--chunk-overlap`       | `150`               | Overlap between chunks                             |
| `--batch-size`          | `1000`              | Embeddings per batch                               |
| `--max-embed-tokens`    | `480`               | Token cap per chunk                                |
| `--embed-token-overlap` | `64`                | Token overlap for oversized chunks                 |
| `--dry-run`             | `false`             | Preview without saving                             |

</details>

---

## ⚙️ Environment Variables

All configurable via `.env`. See [`.env.example`](.env.example) for the full reference.

<details>
<summary><b>Key Variables</b></summary>

| Variable                 | Description                                 |
| ------------------------ | ------------------------------------------- |
| `GROQ_API_KEY`           | Groq API key (primary LLM provider)         |
| `DATABASE_URL`           | PostgreSQL connection string                |
| `REDIS_URL`              | Redis connection string                     |
| `JWT_SECRET`             | Secret for JWT token signing                |
| `OLLAMA_BASE_URL`        | Ollama server URL (if using local LLM)      |
| `OLLAMA_MODEL`           | Ollama model name (e.g. `llama3.2`)         |
| `EMBED_MODEL`            | Embedding model (`BAAI/bge-m3`)             |
| `EMBED_DEVICE`           | Device for embeddings (`auto`/`cpu`/`cuda`) |
| `PLC_CONNECTOR`          | `simulator` (dev) or `modbus_tcp` (prod)    |
| `PLC_MODBUS_HOST`        | Modbus TCP host address                     |
| `APP_ENV`                | `development` or `production`               |
| `FEATURE_AGENT_WORKFLOW` | Enable agentic diagnostics                  |
| `VITE_FEATURE_UI_V2`     | Enable v2 glass UI                          |

</details>

---

## 🔌 PLC Connector

Panya supports two PLC connector modes:

| Mode           | Use Case                                                             | Config                     |
| -------------- | -------------------------------------------------------------------- | -------------------------- |
| **Simulator**  | Development & demo. Generates virtual machine data and random alarms | `PLC_CONNECTOR=simulator`  |
| **Modbus TCP** | Production. Connects to real PLCs via Modbus TCP protocol            | `PLC_CONNECTOR=modbus_tcp` |

In **development**, the simulator starts automatically with 4 virtual machines. In **production**, configure `PLC_MODBUS_HOST` and `PLC_MODBUS_PORT` for real PLC connections.

The PLC module provides:

- **Live data streaming** via WebSocket (`/api/plc/ws`)
- **Alarm management** — active alarms, acknowledgement, history
- **AI Diagnostics** — root cause analysis with LLM
- **Corrective Actions** — AI-suggested fixes with approval workflow
- **Register mapping** — configurable via `plc_mapping.json`

---

## 🚂 Railway Deployment

### Option A: Single Service (Recommended)

The root `Dockerfile` bundles both frontend and backend into one container:

- FastAPI backend on `127.0.0.1:8000`
- Node web server on `$PORT`, serving `frontend/dist`
- Runtime proxy: `/api/*` → `http://127.0.0.1:8000`

**Required env:**

```env
APP_ENV=production
JWT_SECRET=<strong-random-secret>
DATABASE_URL=<postgresql://...>
GROQ_API_KEY=<your-key>
AUTO_EMBED_KNOWLEDGE=false
ALLOW_STARTUP_INGEST_IN_PRODUCTION=false
```

**Volume mount:** `/data` → set `KNOWLEDGE_DIR=/data/Knowledge`, `MODEL_CACHE=/data/models`, `INGEST_STATE_PATH=/data/ingest/state.json`

### Option B: Two Services (Frontend + Backend split)

**Frontend service:**

- Root Directory: `frontend`
- Start: `npm start` (runs `server.cjs`)
- Set `API_PROXY_TARGET=https://<backend-service>.up.railway.app`

**Backend service:**

- Root Directory: `backend`
- Run with Dockerfile / uvicorn

### Verification

```bash
# Should return JSON (401/422 is OK, not HTML)
curl -i https://<frontend>.up.railway.app/api/auth/me
```

---

## 🧪 Testing

```bash
# Run all tests
npm test

# Backend only
npm run test:backend

# Frontend normalizer tests
npm run test:frontend

# Lint
npm run lint
```

# run all (use this for development)
npm run dev
