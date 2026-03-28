from typing import Any, List, Optional

from psycopg2 import sql

from .plc.contracts import _normalize_alarm_status


def build_alarm_where_clause(
    status: Optional[str],
    severity: Optional[str],
) -> tuple[sql.SQL, List[Any]]:
    clauses: List[sql.SQL] = []
    params: List[Any] = []

    if status:
        clauses.append(sql.SQL("status = %s"))
        params.append(_normalize_alarm_status(status))

    if severity:
        clauses.append(sql.SQL("LOWER(severity) = %s"))
        params.append(str(severity).strip().lower())

    if not clauses:
        return sql.SQL(""), params

    return sql.SQL(" WHERE ") + sql.SQL(" AND ").join(clauses), params
