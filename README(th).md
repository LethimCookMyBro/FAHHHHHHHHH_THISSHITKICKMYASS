# Panya: คู่มือส่งต่องานภาษาไทย

เอกสารนี้เขียนสำหรับคนที่จะเข้ามารับงานต่อในโปรเจกต์ Panya โดยอธิบายโครงสร้างจริงของระบบ, วิธีรัน, จุดที่ต้องระวัง, และลำดับการอ่านโค้ดที่ควรรู้ก่อนแก้งาน

README หลักภาษาอังกฤษอยู่ที่ [README.md](./README.md)

## โปรเจกต์นี้คืออะไร

Panya คือระบบ Operations Console สำหรับงาน PLC / Industrial Automation ที่รวม 4 ส่วนหลักไว้ด้วยกัน:

- แชตบอตสำหรับถามตอบจากคู่มือและเอกสาร PLC
- หน้าติดตามสถานะเครื่องและ alarm แบบ live
- flow วิเคราะห์ incident, สร้างแผน, approve action
- UI ฝั่ง operations เช่น dashboard, port map, equipment, action history

สรุปง่าย ๆ:

- backend = FastAPI + database + retrieval + PLC integration
- frontend = React SPA ที่อ่าน shared state เดียวกัน
- chat = knowledge assistant แบบ RAG
- PLC = simulator เป็นค่าเริ่มต้นใน dev, แต่รองรับ Modbus TCP จริง

## โครงสร้างระบบโดยย่อ

### 1. Backend

โฟลเดอร์: `backend/`

ไฟล์สำคัญ:

- `backend/main.py`
  - entrypoint ของ FastAPI
  - register router
  - ตั้ง middleware
  - เปิด background task
  - เชื่อม database / redis / PLC connector

- `backend/app/routes_auth.py`
  - login / register / auth endpoint

- `backend/app/routes_chat.py`
  - chat session
  - chat message
  - source document download

- `backend/app/routes_api.py`
  - health check
  - metrics
  - agent endpoint
  - transcribe endpoint
  - API info endpoint

- `backend/app/routes_plc_data.py`
  - dashboard snapshot / PLC data

- `backend/app/routes_plc_alarms.py`
  - list alarm
  - acknowledge alarm
  - resolve alarm

- `backend/app/routes_plc_actions.py`
  - diagnose
  - create action plan
  - approve action

- `backend/app/chatbot.py`
  - prompt + retrieval + citation + response cleanup

- `backend/app/retriever.py`
  - pgvector retrieval
  - hybrid keyword retrieval
  - rerank

- `backend/app/plc/`
  - connector
  - simulator
  - modbus connector
  - diagnostic / action policy / contracts

- `backend/app/core/`
  - rate limit
  - redis client
  - metrics
  - retention
  - websocket ticket
  - PLC ingest loop

### 2. Frontend

โฟลเดอร์: `frontend/`

ไฟล์สำคัญ:

- `frontend/src/App.jsx`
  - root app
  - route ทั้งระบบ
  - provider หลัก

- `frontend/src/features/plc/PlcLiveDataContext.jsx`
  - live PLC context
  - อ่าน snapshot + websocket

- `frontend/src/features/ops/OpsSyncContext.jsx`
  - shared source of truth ฝั่ง ops
  - sync alarms / actions / machines / zone summaries
  - หน้าหลักหลายหน้าพึ่งตัวนี้

- `frontend/src/hooks/useChatManager.js`
  - logic ใหญ่ของหน้า chat
  - sessions, message loading, submit, mock zone flow, delete modal

- `frontend/src/pages/Chat.jsx`
  - wiring หน้า chat

- `frontend/src/pages/chat/*`
  - composer
  - messages
  - sidebar
  - welcome
  - dialog ต่าง ๆ

- `frontend/src/features/ops/dashboard/`
  - dashboard overview

- `frontend/src/features/ops/port-map/`
  - zone map
  - zone status
  - Ask AI handoff

- `frontend/src/features/ops/alarms/`
  - incident center
  - decision panel
  - diagnose / plan / approve flow

- `frontend/src/features/ops/equipment/`
  - machine/equipment status

- `frontend/src/features/ops/actions/`
  - action history

## Data flow ที่ต้องเข้าใจก่อนแก้

จุดสำคัญที่สุดของ frontend คือ ห้ามคิดว่าแต่ละหน้าเป็น isolated page

หน้าที่ควร sync กัน:

- Dashboard
- Port Map
- Alerts
- Equipment
- Action History
- Chat flow ที่มาแก้ incident

ตัวกลางหลักคือ:

- `frontend/src/features/ops/OpsSyncContext.jsx`

และ live PLC มาจาก:

- `frontend/src/hooks/usePlcLiveData.js`
- `frontend/src/features/plc/PlcLiveDataContext.jsx`

ถ้าคุณไปเพิ่ม state ใหม่แยกอีกก้อนโดยไม่เชื่อมกับ 2 ตัวนี้ มีโอกาสสูงที่ตัวเลขจะไม่ sync กัน

## Flow สำคัญของระบบ

### Chat

1. frontend เรียก `/api/chat/*`
2. backend เลือก direct LLM หรือ RAG path
3. ถ้าใช้ RAG จะผ่าน retriever + reranker + LLM
4. reply ถูกเก็บใน chat session และ render ใน UI

### PLC live + ops

1. frontend โหลด `/api/plc/dashboard`
2. เปิด `/api/plc/ws`
3. `OpsSyncContext` โหลด `/api/plc/alarms` และ `/api/plc/actions`
4. dashboard / port map / alerts / equipment ใช้ state กลางร่วมกัน

### Ask AI จาก Port Map

1. user กด zone
2. panel เปิดค้าง
3. กด `Ask AI`
4. chat รับ context ของ zone/machine/error
5. พอ AI/mock flow ตอบจบ ระบบ resolve incident และ update หน้าที่เกี่ยวข้องพร้อมกัน

## วิธีรันในเครื่อง

### สิ่งที่ต้องมี

- Node.js 18+
- Python 3.10+ หรือ 3.11
- PostgreSQL + pgvector
- Redis
- Ollama หรือ Groq API key

### ติดตั้ง

ที่ root:

```bash
npm install
```

frontend:

```bash
cd frontend
npm install
cd ..
```

backend:

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

จากนั้น:

```bash
pip install -r requirements.txt
cd ..
```

### ตั้งค่า env

```bash
cp .env.example .env
```

ตัวแปรที่ควรตรวจอย่างน้อย:

- `APP_ENV`
- `DATABASE_URL` หรือ `POSTGRES_*`
- `REDIS_URL`
- `JWT_SECRET`
- `OLLAMA_BASE_URL`
- `OLLAMA_MODEL`
- `GROQ_API_KEY`
- `PLC_CONNECTOR`
- `FEATURE_AGENT_WORKFLOW`
- `FEATURE_AUTOFIX_EXECUTION`

### รัน dev

```bash
npm run dev
```

URL:

- frontend: `http://localhost:5173`
- backend: `http://localhost:5000`
- docs: `http://localhost:5000/docs`

## การรันด้วย Docker

`docker-compose.yml` มี service หลัก:

- `postgres`
- `redis`
- `ollama`
- `backend`
- `frontend`
- `pgadmin` แบบ optional profile `debug`

รัน:

```bash
docker compose up -d
```

เปิด pgAdmin เพิ่ม:

```bash
docker compose --profile debug up -d pgadmin
```

หยุด:

```bash
docker compose down
```

ลบ volume:

```bash
docker compose down -v
```

## Script ที่ใช้บ่อย

ที่ root:

- `npm run dev`
- `npm run lint`
- `npm run build`
- `npm run test`
- `npm run test:backend`
- `npm run test:frontend`
- `npm run check`
- `npm run start`

ที่ frontend:

- `npm run dev`
- `npm run build`
- `npm run start`
- `npm run lint`
- `npm run test:normalizers`

## ส่วนของ RAG / embedding

ไฟล์สำคัญ:

- `backend/embed.py`
- `backend/embed_cli.py`
- `backend/embed_files.py`
- `backend/app/embed_logic.py`
- `backend/app/ingest_state.py`

ตัวแปร env ที่เกี่ยวข้อง:

- `KNOWLEDGE_DIR`
- `MODEL_CACHE`
- `INGEST_STATE_PATH`
- `AUTO_EMBED_KNOWLEDGE`
- `ALLOW_STARTUP_INGEST_IN_PRODUCTION`
- `EMBED_MODEL`
- `EMBED_DEVICE`

ตัวอย่างรัน embed:

```bash
cd backend
python embed.py /data/Knowledge --collection plcnext
```

## แนวทางเวลาจะเริ่มแก้โค้ด

ถ้าเป็นคนใหม่ แนะนำให้อ่านตามลำดับนี้:

1. `package.json`
2. `backend/main.py`
3. `frontend/src/App.jsx`
4. `frontend/src/features/plc/PlcLiveDataContext.jsx`
5. `frontend/src/features/ops/OpsSyncContext.jsx`
6. `frontend/src/hooks/useChatManager.js`
7. module ที่คุณจะลงมือแก้จริง

## จุดที่ต้องระวัง

### 1. อย่าเพิ่ม state ซ้ำโดยไม่จำเป็น

ถ้าข้อมูลนั้นมีอยู่แล้วใน:

- `usePlcLiveData`
- `OpsSyncContext`

ให้ reuse ก่อน

### 2. เวลาแก้ sync ระหว่างหน้า

เริ่มเช็กจาก:

- `frontend/src/features/ops/OpsSyncContext.jsx`
- `frontend/src/features/ops/port-map/zoneModel.js`
- `frontend/src/hooks/useChatManager.js`

### 3. เวลาแก้ API route

เช็กทั้งสองฝั่งเสมอ:

- backend route file
- frontend API caller

กลุ่ม route หลัก:

- `/api/auth/*`
- `/api/chat/*`
- `/api/agent-chat`
- `/api/agent/action`
- `/api/transcribe`
- `/api/plc/*`

### 4. Chatbot persona

ตอนนี้ chatbot ควรตอบเป็น English-first

ดังนั้น:

- UI localize ได้
- แต่ตัวอย่าง prompt / assistant persona / response expectations ควรคง English consistency

## Troubleshooting ที่เจอบ่อย

### หน้าเว็บขึ้น HTML แทน JSON

ตรวจ:

- `API_PROXY_TARGET`
- `server.js`
- `frontend/server.cjs`

อย่าชี้ proxy target กลับมาที่ frontend เอง

### Chat ไม่ตอบ หรือ fallback อย่างเดียว

ตรวจ:

- Ollama รันอยู่หรือไม่
- model ใน `OLLAMA_MODEL` ถูก pull แล้วหรือยัง
- ingestion เสร็จหรือยัง
- embedder โหลดขึ้นหรือยัง

### PLC ไม่อัปเดต

ตรวจ:

- `PLC_CONNECTOR`
- `/health/ready`
- `/api/plc/dashboard`
- `/api/auth/ws-ticket`
- `/api/plc/ws`

### Dashboard / Port Map / Alerts เลขไม่ตรงกัน

เริ่ม debug จาก:

- `OpsSyncContext`
- `usePlcLiveData`
- route `/api/plc/alarms`
- route `/api/plc/actions`

## ก่อน commit ควรรันอะไร

ขั้นต่ำ:

```bash
npm run lint
npm run test
npm run build
npm run check:backend
```

ถ้าจะเช็กละเอียดเพิ่ม:

```bash
cd frontend
npm run test:normalizers
```

```bash
python -m unittest discover -s backend/tests -p "test_*.py"
python -m compileall backend/app
```

## สรุปสั้น ๆ สำหรับรุ่นน้อง

ถ้าจะทำงานต่อใน repo นี้ ให้จำ 3 เรื่อง:

1. frontend หลายหน้าถูกออกแบบให้ sync กัน อย่าแก้แบบหน้าใครหน้ามัน
2. backend route กับ frontend caller ต้องเดินไปพร้อมกัน
3. ถ้าไม่แน่ใจว่า state ควรอยู่ไหน ให้เริ่มดู `OpsSyncContext` ก่อนเสมอ
