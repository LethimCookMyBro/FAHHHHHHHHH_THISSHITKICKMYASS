# backend/app/db.py
import os
import time
from psycopg2 import pool


class BlockingThreadedConnectionPool(pool.ThreadedConnectionPool):
    """Thread-safe pool with short blocking wait when all connections are busy."""

    def __init__(
        self,
        minconn: int,
        maxconn: int,
        *args,
        acquire_timeout_seconds: float = 2.0,
        acquire_retry_seconds: float = 0.05,
        **kwargs,
    ):
        super().__init__(minconn, maxconn, *args, **kwargs)
        self._acquire_timeout_seconds = max(0.1, float(acquire_timeout_seconds))
        self._acquire_retry_seconds = max(0.01, float(acquire_retry_seconds))

    def getconn(self, key=None):
        deadline = time.monotonic() + self._acquire_timeout_seconds
        while True:
            try:
                return super().getconn(key=key)
            except pool.PoolError:
                if time.monotonic() >= deadline:
                    raise
                time.sleep(self._acquire_retry_seconds)


_db_pool: BlockingThreadedConnectionPool | None = None


def init_db_pool(database_url: str) -> BlockingThreadedConnectionPool:
    """
    Initialize PostgreSQL connection pool (singleton).
    Called once at FastAPI startup.
    """
    global _db_pool

    if _db_pool is None:
        database_url = (database_url or "").strip()
        if not database_url:
            raise RuntimeError(
                "Resolved DATABASE_URL is empty. "
                "Set DATABASE_URL or provide PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE "
                "or POSTGRES_HOST/POSTGRES_PORT/POSTGRES_USER/POSTGRES_PASSWORD/POSTGRES_DB."
            )

        minconn = int(os.getenv("DB_POOL_MIN", "1"))
        maxconn = int(os.getenv("DB_POOL_MAX", "10"))
        acquire_timeout_seconds = float(os.getenv("DB_POOL_ACQUIRE_TIMEOUT_SECONDS", "2.0"))
        acquire_retry_seconds = float(os.getenv("DB_POOL_ACQUIRE_RETRY_SECONDS", "0.05"))
        _db_pool = BlockingThreadedConnectionPool(
            minconn=minconn,
            maxconn=maxconn,
            dsn=database_url,
            acquire_timeout_seconds=acquire_timeout_seconds,
            acquire_retry_seconds=acquire_retry_seconds,
        )

    return _db_pool


def get_db_pool() -> BlockingThreadedConnectionPool:
    """
    Get initialized DB pool.
    """
    if _db_pool is None:
        raise RuntimeError(
            "Database pool is not initialized. "
            "Did you forget to call init_db_pool() on startup?"
        )
    return _db_pool


def ensure_schema(db_pool: BlockingThreadedConnectionPool) -> None:
    """
    Apply idempotent schema migrations required by the current backend code.
    Fail-fast: raise on any error so startup does not continue with broken schema.
    """
    conn = db_pool.getconn()
    try:
        with conn.cursor() as cur:
            statements = [
                # pgvector + vector store table
                """
                CREATE EXTENSION IF NOT EXISTS vector;
                """,
                """
                CREATE TABLE IF NOT EXISTS public.documents (
                    id SERIAL PRIMARY KEY,
                    content TEXT NOT NULL,
                    metadata JSONB,
                    collection VARCHAR(255) NOT NULL,
                    hash VARCHAR(64) UNIQUE NOT NULL,
                    embedding VECTOR(1024),
                    created_at TIMESTAMPTZ DEFAULT now()
                );
                """,
                """
                ALTER TABLE public.documents
                ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
                """,
                """
                ALTER TABLE public.documents
                ALTER COLUMN metadata SET DEFAULT '{}'::jsonb;
                """,
                """
                UPDATE public.documents
                SET metadata = '{}'::jsonb
                WHERE metadata IS NULL;
                """,
                """
                UPDATE public.documents
                SET metadata = jsonb_set(
                    metadata,
                    '{source}',
                    to_jsonb(regexp_replace(metadata->>'source', '^.*/', '')),
                    true
                )
                WHERE metadata ? 'source'
                  AND (metadata->>'source') LIKE '%/%';
                """,
                """
                WITH inferred_pages AS (
                    SELECT
                        id,
                        (regexp_match(content, '(?i)(?:---\\s*page\\s*|\\bpage\\s*)(\\d{1,5})'))[1]::int AS page_num
                    FROM public.documents
                    WHERE CASE
                        WHEN (metadata->>'page') ~ '^\\d+$' THEN (metadata->>'page')::int
                        ELSE 0
                    END = 0
                    AND regexp_match(content, '(?i)(?:---\\s*page\\s*|\\bpage\\s*)(\\d{1,5})') IS NOT NULL
                )
                UPDATE public.documents d
                SET metadata = jsonb_set(
                    d.metadata,
                    '{page}',
                    to_jsonb(inferred_pages.page_num),
                    true
                )
                FROM inferred_pages
                WHERE d.id = inferred_pages.id
                  AND inferred_pages.page_num > 0;
                """,
                """
                CREATE INDEX IF NOT EXISTS idx_collection
                ON public.documents (collection);
                """,
                """
                CREATE INDEX IF NOT EXISTS idx_hnsw_embedding
                ON public.documents USING hnsw (embedding vector_l2_ops);
                """,
                # auth tables
                """
                CREATE TABLE IF NOT EXISTS public.users (
                  id SERIAL PRIMARY KEY,
                  email TEXT NOT NULL UNIQUE,
                  password_hash TEXT NOT NULL,
                  full_name TEXT,
                  is_active BOOLEAN DEFAULT true,
                  role TEXT DEFAULT 'operator',
                  created_at TIMESTAMPTZ DEFAULT now()
                );
                """,
                """
                ALTER TABLE public.users
                ALTER COLUMN role SET DEFAULT 'operator';
                """,
                """
                ALTER TABLE public.users
                ADD COLUMN IF NOT EXISTS ui_preferences JSONB DEFAULT '{}'::jsonb;
                """,
                """
                ALTER TABLE public.users
                ALTER COLUMN ui_preferences SET DEFAULT '{}'::jsonb;
                """,
                """
                UPDATE public.users
                SET ui_preferences = '{}'::jsonb
                WHERE ui_preferences IS NULL;
                """,
                """
                UPDATE public.users
                SET role = 'operator'
                WHERE role IS NULL
                   OR TRIM(role) = ''
                   OR LOWER(role) = 'user';
                """,
                """
                DO $$
                BEGIN
                  IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint
                    WHERE conname = 'chk_users_role_valid'
                  ) THEN
                    ALTER TABLE public.users
                    ADD CONSTRAINT chk_users_role_valid
                    CHECK (role IN ('viewer', 'operator', 'admin'));
                  END IF;
                END $$;
                """,
                """
                CREATE TABLE IF NOT EXISTS public.refresh_tokens (
                  id SERIAL PRIMARY KEY,
                  user_id INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
                  token_hash TEXT NOT NULL,
                  user_agent TEXT,
                  ip TEXT,
                  created_at TIMESTAMPTZ DEFAULT now(),
                  expires_at TIMESTAMPTZ,
                  revoked BOOLEAN DEFAULT FALSE
                );
                """,
                """
                CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id
                ON public.refresh_tokens(user_id);
                """,
                """
                CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token_hash
                ON public.refresh_tokens(token_hash);
                """,
                # Older local DBs may contain duplicate token hashes from before
                # the uniqueness constraint existed. Normalize them before
                # creating the unique index so startup migrations stay idempotent.
                """
                WITH duplicate_refresh_tokens AS (
                    SELECT
                      token_hash,
                      MIN(id) AS keeper_id,
                      BOOL_OR(COALESCE(revoked, FALSE)) AS should_revoke,
                      MIN(expires_at) FILTER (WHERE expires_at IS NOT NULL) AS earliest_expires_at,
                      MIN(created_at) FILTER (WHERE created_at IS NOT NULL) AS earliest_created_at
                    FROM public.refresh_tokens
                    GROUP BY token_hash
                    HAVING COUNT(*) > 1
                ),
                normalized_keeper AS (
                    UPDATE public.refresh_tokens rt
                    SET revoked = dup.should_revoke,
                        expires_at = COALESCE(dup.earliest_expires_at, rt.expires_at),
                        created_at = COALESCE(dup.earliest_created_at, rt.created_at)
                    FROM duplicate_refresh_tokens dup
                    WHERE rt.id = dup.keeper_id
                    RETURNING rt.id
                )
                DELETE FROM public.refresh_tokens rt
                USING duplicate_refresh_tokens dup
                WHERE rt.token_hash = dup.token_hash
                  AND rt.id <> dup.keeper_id;
                """,
                """
                CREATE UNIQUE INDEX IF NOT EXISTS uq_refresh_tokens_token_hash
                ON public.refresh_tokens(token_hash);
                """,
                # chat tables
                """
                CREATE TABLE IF NOT EXISTS public.chat_sessions (
                  id SERIAL PRIMARY KEY,
                  user_id INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
                  title TEXT,
                  created_at TIMESTAMPTZ DEFAULT now(),
                  updated_at TIMESTAMPTZ DEFAULT now()
                );
                """,
                """
                CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_id
                ON public.chat_sessions(user_id);
                """,
                """
                CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_updated_at
                ON public.chat_sessions(user_id, updated_at DESC);
                """,
                """
                CREATE TABLE IF NOT EXISTS public.chat_messages (
                  id SERIAL PRIMARY KEY,
                  session_id INTEGER NOT NULL REFERENCES public.chat_sessions(id) ON DELETE CASCADE,
                  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
                  content TEXT NOT NULL,
                  metadata JSONB DEFAULT '{}'::jsonb,
                  created_at TIMESTAMPTZ DEFAULT now()
                );
                """,
                """
                ALTER TABLE public.chat_messages
                ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
                """,
                """
                UPDATE public.chat_messages
                SET metadata = '{}'::jsonb
                WHERE metadata IS NULL;
                """,
                """
                CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id
                ON public.chat_messages(session_id);
                """,
                """
                CREATE INDEX IF NOT EXISTS idx_chat_messages_session_created_at
                ON public.chat_messages(session_id, created_at DESC);
                """,
                """
                CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at
                ON public.chat_messages(created_at DESC);
                """,
                # ── PLC Monitoring tables ──
                """
                CREATE TABLE IF NOT EXISTS public.machines (
                  id SERIAL PRIMARY KEY,
                  name TEXT NOT NULL,
                  plc_type TEXT DEFAULT 'mitsubishi',
                  model TEXT,
                  location TEXT,
                  status TEXT DEFAULT 'offline',
                  last_heartbeat TIMESTAMPTZ,
                  config JSONB DEFAULT '{}'::jsonb,
                  created_at TIMESTAMPTZ DEFAULT now()
                );
                """,
                """
                CREATE TABLE IF NOT EXISTS public.plc_alarms (
                  id SERIAL PRIMARY KEY,
                  machine_id INTEGER,
                  error_code TEXT NOT NULL,
                  severity TEXT DEFAULT 'warning',
                  message TEXT,
                  category TEXT DEFAULT 'unknown',
                  status TEXT DEFAULT 'active',
                  raw_data JSONB DEFAULT '{}'::jsonb,
                  diagnosed_at TIMESTAMPTZ,
                  resolved_at TIMESTAMPTZ,
                  created_at TIMESTAMPTZ DEFAULT now()
                );
                """,
                """
                ALTER TABLE public.plc_alarms
                ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ;
                """,
                """
                ALTER TABLE public.plc_alarms
                ADD COLUMN IF NOT EXISTS acknowledged_by INTEGER;
                """,
                """
                ALTER TABLE public.plc_alarms
                ADD COLUMN IF NOT EXISTS acknowledge_note TEXT;
                """,
                """
                CREATE INDEX IF NOT EXISTS idx_plc_alarms_status
                ON public.plc_alarms(status);
                """,
                """
                CREATE INDEX IF NOT EXISTS idx_plc_alarms_machine_id
                ON public.plc_alarms(machine_id);
                """,
                """
                CREATE INDEX IF NOT EXISTS idx_plc_alarms_created_at
                ON public.plc_alarms(created_at DESC);
                """,
                """
                CREATE TABLE IF NOT EXISTS public.ai_actions (
                  id SERIAL PRIMARY KEY,
                  alarm_id INTEGER,
                  action_type TEXT NOT NULL,
                  diagnosis TEXT,
                  recommendation TEXT,
                  confidence FLOAT DEFAULT 0.0,
                  is_hardware BOOLEAN DEFAULT false,
                  repair_steps JSONB DEFAULT '[]'::jsonb,
                  sources JSONB DEFAULT '[]'::jsonb,
                  executed_at TIMESTAMPTZ,
                  created_at TIMESTAMPTZ DEFAULT now()
                );
                """,
                """
                ALTER TABLE public.ai_actions
                ADD COLUMN IF NOT EXISTS action_reason TEXT;
                """,
                """
                ALTER TABLE public.ai_actions
                ADD COLUMN IF NOT EXISTS action_payload JSONB DEFAULT '{}'::jsonb;
                """,
                """
                ALTER TABLE public.ai_actions
                ADD COLUMN IF NOT EXISTS approval_info JSONB DEFAULT '{}'::jsonb;
                """,
                """
                ALTER TABLE public.ai_actions
                ADD COLUMN IF NOT EXISTS execution_status TEXT DEFAULT 'planned';
                """,
                """
                ALTER TABLE public.ai_actions
                ADD COLUMN IF NOT EXISTS execution_result JSONB DEFAULT '{}'::jsonb;
                """,
                """
                ALTER TABLE public.ai_actions
                ADD COLUMN IF NOT EXISTS before_state JSONB DEFAULT '{}'::jsonb;
                """,
                """
                ALTER TABLE public.ai_actions
                ADD COLUMN IF NOT EXISTS after_state JSONB DEFAULT '{}'::jsonb;
                """,
                """
                ALTER TABLE public.ai_actions
                ADD COLUMN IF NOT EXISTS policy_version TEXT DEFAULT 'v1-safe-actions';
                """,
                """
                ALTER TABLE public.ai_actions
                ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
                """,
                """
                UPDATE public.ai_actions
                SET action_payload = '{}'::jsonb
                WHERE action_payload IS NULL;
                """,
                """
                UPDATE public.ai_actions
                SET approval_info = '{}'::jsonb
                WHERE approval_info IS NULL;
                """,
                """
                UPDATE public.ai_actions
                SET execution_result = '{}'::jsonb
                WHERE execution_result IS NULL;
                """,
                """
                UPDATE public.ai_actions
                SET before_state = '{}'::jsonb
                WHERE before_state IS NULL;
                """,
                """
                UPDATE public.ai_actions
                SET after_state = '{}'::jsonb
                WHERE after_state IS NULL;
                """,
                """
                CREATE INDEX IF NOT EXISTS idx_ai_actions_alarm_id
                ON public.ai_actions(alarm_id);
                """,
                """
                CREATE INDEX IF NOT EXISTS idx_ai_actions_created_at
                ON public.ai_actions(created_at DESC);
                """,
                """
                CREATE INDEX IF NOT EXISTS idx_ai_actions_execution_status
                ON public.ai_actions(execution_status);
                """,
                """
                CREATE TABLE IF NOT EXISTS public.sensor_data (
                  id SERIAL PRIMARY KEY,
                  machine_id INTEGER,
                  data JSONB NOT NULL,
                  created_at TIMESTAMPTZ DEFAULT now()
                );
                """,
                """
                CREATE INDEX IF NOT EXISTS idx_sensor_data_machine_id
                ON public.sensor_data(machine_id);
                """,
            ]

            for statement in statements:
                cur.execute(statement)

        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        db_pool.putconn(conn)
