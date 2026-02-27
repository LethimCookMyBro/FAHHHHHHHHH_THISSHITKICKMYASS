import threading
from collections import defaultdict
from typing import DefaultDict, Dict

_COUNTERS: DefaultDict[str, int] = defaultdict(int)
_LOCK = threading.Lock()


def inc_counter(name: str, value: int = 1) -> None:
    if value <= 0:
        return
    with _LOCK:
        _COUNTERS[name] += value


def snapshot_counters() -> Dict[str, int]:
    with _LOCK:
        return dict(_COUNTERS)


def render_prometheus_metrics() -> str:
    lines = []
    counters = snapshot_counters()
    for name, value in sorted(counters.items()):
        metric_name = name.replace(".", "_").replace("-", "_")
        lines.append(f"# TYPE panya_{metric_name} counter")
        lines.append(f"panya_{metric_name} {int(value)}")
    lines.append("")
    return "\n".join(lines)

