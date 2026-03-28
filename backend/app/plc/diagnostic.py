"""
AI Diagnostic Engine for PLC alarms.

Uses the existing RAG pipeline (retriever + LLM) to:
1. Look up error codes in the Mitsubishi knowledge base
2. Classify the issue as software vs hardware
3. Generate diagnosis + repair recommendations
"""

import logging
import time
import os
import re
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# Keywords that strongly signal a hardware issue
_HARDWARE_SIGNALS = {
    "fuse", "blown", "motor", "bearing", "wiring", "cable", "connector",
    "overload", "overheat", "sensor", "inverter", "servo", "mechanical",
    "replace", "physical", "hardware", "broken", "damage", "vibration",
    "wear", "belt", "coupling", "relay", "contact", "terminal",
}

# Keywords that signal a software/config issue
_SOFTWARE_SIGNALS = {
    "parameter", "setting", "configuration", "program", "ladder", "scan",
    "timeout", "communication", "protocol", "address", "assignment",
    "reset", "clear", "restart", "register", "memory", "software",
    "download", "upload", "firmware", "update", "initialize",
}

_DIAG_SECTION_LABELS = (
    "Prerequisites / Notes",
    "Prerequisites/Notes",
    "Steps",
    "Troubleshooting",
    "Common failure patterns",
    "Likely diagnostic checks",
    "Relevant LEDs",
    "Root Cause Analysis",
    "Issue Type",
    "Recommended Actions",
    "Safety Warnings",
    "Estimated Repair Time",
)


def _normalize_diagnosis_markdown(text: str) -> str:
    """Best-effort cleanup when the LLM collapses headings/list items into one line."""
    s = str(text or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    if not s:
        return s

    s = re.sub(r"([^\n])\s*(###\s+)", r"\1\n\n\2", s)

    for label in _DIAG_SECTION_LABELS:
        s = re.sub(
            rf"(###\s*{re.escape(label)})\s+(?=\S)",
            r"\1\n",
            s,
            flags=re.IGNORECASE,
        )

    s = re.sub(r"^(Prerequisites\s*/?\s*Notes)\s*:?\s*$", "### Prerequisites / Notes", s, flags=re.IGNORECASE | re.MULTILINE)
    s = re.sub(r"^Steps\s*:?\s*$", "### Steps", s, flags=re.IGNORECASE | re.MULTILINE)
    s = re.sub(r"^Troubleshooting\s*:?\s*$", "### Troubleshooting", s, flags=re.IGNORECASE | re.MULTILINE)
    s = re.sub(r"^Common failure patterns\s*:?\s*$", "#### Common failure patterns", s, flags=re.IGNORECASE | re.MULTILINE)
    s = re.sub(r"^Likely diagnostic checks\s*:?\s*$", "#### Likely diagnostic checks", s, flags=re.IGNORECASE | re.MULTILINE)
    s = re.sub(r"^Relevant LEDs\s*:?\s*$", "#### Relevant LEDs", s, flags=re.IGNORECASE | re.MULTILINE)

    s = re.sub(r"(###\s*(?:Steps|Recommended Actions))\s*(\d+\.\s+)", r"\1\n\2", s, flags=re.IGNORECASE)
    s = re.sub(r"([.!?])\s+([1-9]\.\s+)", r"\1\n\2", s)
    s = re.sub(r"\s*•\s+", "\n- ", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()


def _classify_issue(diagnosis_text: str, error_info: dict) -> bool:
    """
    Returns True if the issue is likely hardware-related.
    Uses keyword matching on the diagnosis text + error category.
    """
    category = (error_info.get("category") or "").lower()
    if category == "hardware":
        return True
    if category == "software":
        return False

    text_lower = diagnosis_text.lower()
    hw_score = sum(1 for k in _HARDWARE_SIGNALS if k in text_lower)
    sw_score = sum(1 for k in _SOFTWARE_SIGNALS if k in text_lower)
    return hw_score > sw_score


def _build_diagnostic_prompt(error_code: str, error_message: str,
                              context_data: dict, rag_context: str) -> str:
    """Build the prompt for the LLM to diagnose the error."""
    machine_name = context_data.get("machine_name", "Unknown")
    model = context_data.get("model", "Unknown")
    sensors = context_data.get("sensors", {})

    sensor_str = ""
    if sensors:
        sensor_str = (
            f"\n  - Temperature: {sensors.get('temperature', 'N/A')}°C"
            f"\n  - Current: {sensors.get('current', 'N/A')}A"
            f"\n  - Vibration: {sensors.get('vibration', 'N/A')}mm/s"
            f"\n  - Pressure: {sensors.get('pressure', 'N/A')}bar"
        )

    return f"""You are an expert Mitsubishi PLC technician and industrial automation engineer.
Analyze the following PLC error and provide a diagnosis.

## Error Information
- **Error Code**: {error_code}
- **Error Message**: {error_message}
- **Machine**: {machine_name}
- **PLC Model**: {model}
- **Sensor Readings at time of error**:{sensor_str}

## Related Documentation
{rag_context if rag_context else "No specific documentation found for this error code."}

## Your Task
Provide a structured field-tech response in this exact markdown format (and nothing else):

### Prerequisites / Notes
- First bullet: concise root-cause summary for this error
- Include safety precautions (lockout/tagout, power isolation) when relevant
- Include model-specific caveats or missing info if needed
- Do NOT add placeholder bullets with no details

### Steps
1. Step-by-step recovery / verification procedure
2. Use explicit checks (parameters, wiring, LEDs, module state)
3. Keep numbering sequential and actionable

### Troubleshooting
- Common failure patterns:
- Relevant LEDs: RUN/ERR/LINK (or module LEDs if more relevant)
- Likely diagnostic checks:
- Add concrete checks/items under each bullet (no empty placeholders)

Do not include separate sections named "Issue Type" or "Recommended Actions" because the UI shows issue type separately.
Answer in English only, even when source documentation includes other languages. Be specific to Mitsubishi {model} series.
"""


async def diagnose_error(
    error_code: str,
    error_message: str,
    context_data: dict,
    retriever: Any = None,
    llm: Any = None,
) -> Dict[str, Any]:
    """
    Run AI diagnosis on a PLC error.

    Args:
        error_code: The PLC error code (e.g., "6207")
        error_message: Human-readable error message
        context_data: Dict with machine_name, model, sensors, etc.
        retriever: LangChain retriever (pgvector) — optional
        llm: LangChain LLM instance — optional

    Returns:
        Dict with diagnosis, recommendation, is_hardware, confidence, sources
    """
    start = time.time()
    rag_context = ""
    sources: List[dict] = []

    # Step 1: RAG lookup for error code in knowledge base
    if retriever is not None:
        try:
            query = f"Mitsubishi PLC error code {error_code} {error_message}"
            docs = retriever.invoke(query)
            if docs:
                rag_parts = []
                for i, doc in enumerate(docs[:5]):
                    meta = doc.metadata or {}
                    source = meta.get("source", "Unknown")
                    page = meta.get("page", "?")
                    rag_parts.append(
                        f"[Source {i+1}: {source} p.{page}]\n{doc.page_content[:600]}"
                    )
                    sources.append({
                        "source": source,
                        "page": str(page),
                        "score": round(float(meta.get("score", 0)), 3),
                        "preview": doc.page_content[:200],
                    })
                rag_context = "\n\n".join(rag_parts)
        except Exception as e:
            logger.warning("[Diagnostic] RAG retrieval failed: %s", e)

    # Step 2: LLM diagnosis
    diagnosis_text = ""
    confidence = 0.0

    if llm is not None:
        try:
            prompt = _build_diagnostic_prompt(
                error_code, error_message, context_data, rag_context
            )
            # Try langchain invoke first
            try:
                from langchain_core.messages import HumanMessage
                result = llm.invoke([HumanMessage(content=prompt)])
                diagnosis_text = (
                    result.content if hasattr(result, "content") else str(result)
                )
            except Exception:
                # Fallback: treat llm as callable
                diagnosis_text = str(llm.invoke(prompt))

            # Confidence based on whether RAG found relevant docs
            if sources:
                top_score = max(s.get("score", 0) for s in sources)
                confidence = min(0.95, 0.5 + top_score * 0.3)
            else:
                confidence = 0.4  # LLM-only, no documentation backing

        except Exception as e:
            logger.error("[Diagnostic] LLM diagnosis failed: %s", e)
            diagnosis_text = _fallback_diagnosis(error_code, error_message, context_data)
            confidence = 0.3
    else:
        # No LLM available — use rule-based fallback
        diagnosis_text = _fallback_diagnosis(error_code, error_message, context_data)
        confidence = 0.3

    diagnosis_text = _normalize_diagnosis_markdown(diagnosis_text)

    # Step 3: Classify hardware vs software
    error_info = {"category": context_data.get("category", "unknown")}
    is_hardware = _classify_issue(diagnosis_text, error_info)

    elapsed = round(time.time() - start, 2)
    logger.info(
        "[Diagnostic] Diagnosed %s (%s) in %.2fs — %s issue, confidence=%.0f%%",
        error_code, error_message, elapsed,
        "HARDWARE" if is_hardware else "SOFTWARE",
        confidence * 100,
    )

    return {
        "error_code": error_code,
        "error_message": error_message,
        "diagnosis": diagnosis_text,
        "recommendation": _extract_recommendations(diagnosis_text),
        "is_hardware": is_hardware,
        "issue_type": "hardware" if is_hardware else "software",
        "confidence": round(confidence, 2),
        "sources": sources,
        "processing_time": elapsed,
        "machine": context_data.get("machine_name", "Unknown"),
        "model": context_data.get("model", "Unknown"),
    }


def _build_structured_fallback(
    root_cause: str,
    steps: List[str],
    troubleshooting_items: List[str],
    notes: Optional[List[str]] = None,
) -> str:
    notes = [n for n in (notes or []) if str(n).strip()]
    steps = [s for s in (steps or []) if str(s).strip()]
    troubleshooting_items = [t for t in (troubleshooting_items or []) if str(t).strip()]

    note_lines = [f"- {root_cause}"] + [f"- {n}" for n in notes]
    step_lines = [f"{idx}. {step}" for idx, step in enumerate(steps, start=1)]
    troubleshooting_lines = [f"- {item}" for item in troubleshooting_items]

    return (
        "### Prerequisites / Notes\n"
        f"{chr(10).join(note_lines)}\n\n"
        "### Steps\n"
        f"{chr(10).join(step_lines)}\n\n"
        "### Troubleshooting\n"
        f"{chr(10).join(troubleshooting_lines)}"
    )


def _fallback_diagnosis(error_code: str, error_message: str, context: dict) -> str:
    """Rule-based fallback when LLM is not available."""
    from .simulator import MITSUBISHI_ERRORS

    model = context.get("model", "PLC")

    match = None
    for err in MITSUBISHI_ERRORS:
        if err["code"] == error_code:
            match = err
            break

    if match:
        cat = match["category"]
        if cat == "hardware":
            return _build_structured_fallback(
                root_cause=(
                    f"Error {error_code} ({error_message}) indicates a hardware-level fault "
                    f"in the {model} module."
                ),
                notes=[
                    "Isolate power and follow lockout/tagout before touching hardware.",
                    "Record RUN/ERR/LINK LED state before replacing any module.",
                ],
                steps=[
                    "Power off the PLC module safely.",
                    "Inspect the affected component, connector, and terminal condition.",
                    "Check for loose connections, overheating marks, or physical damage.",
                    "Replace faulty hardware if necessary and reseat all connectors.",
                    "Power on and verify the error does not reoccur.",
                ],
                troubleshooting_items=[
                    "Common failure patterns: intermittent trip, heat-related trip, loose terminal, damaged module.",
                    "Relevant LEDs: RUN/ERR (module-specific fault LEDs may also be present).",
                    "Likely diagnostic checks: compare before/after LEDs, inspect supply voltage stability, verify module seating.",
                ],
            )
        if cat == "communication":
            return _build_structured_fallback(
                root_cause=(
                    f"Error {error_code} ({error_message}) indicates a communication fault. "
                    "Network wiring, parameters, or station settings are likely mismatched."
                ),
                notes=[
                    "Confirm the exact network type and module model before changing parameters.",
                    "Capture current communication parameter screenshots for rollback.",
                ],
                steps=[
                    "Check physical network cable connections and connector integrity.",
                    "Verify communication parameters in GX Works match the installed module and network design.",
                    "Confirm station numbers and channel settings are correct.",
                    "Restart the communication module or PLC after applying parameter changes.",
                    "Retest communication and verify alarms clear without new network errors.",
                ],
                troubleshooting_items=[
                    "Common failure patterns: station not detected, timeout, link scan fail.",
                    "Relevant LEDs: RUN/ERR/LINK.",
                    "Likely diagnostic checks: compare parameter set vs module type, verify network topology and terminating rules, inspect channel number settings.",
                ],
            )
        return _build_structured_fallback(
            root_cause=(
                f"Error {error_code} ({error_message}) is likely a software/parameter issue "
                f"in the {model} configuration."
            ),
            notes=[
                "Back up the current project before changing parameters.",
                "Verify the target PLC model and module configuration match the project file.",
            ],
            steps=[
                "Open the GX Works project used for this PLC.",
                "Review parameter settings related to the affected module/function.",
                "Correct the configuration mismatch or invalid assignment.",
                "Download the corrected configuration to the PLC.",
                "Reset the error and verify the system returns to normal operation.",
            ],
            troubleshooting_items=[
                "Common failure patterns: parameter mismatch after replacement, invalid I/O assignment, startup timeout.",
                "Relevant LEDs: RUN/ERR (and module LEDs for the affected slot).",
                "Likely diagnostic checks: compare online vs project parameters, review recent changes, verify device type selection.",
            ],
        )

    return _build_structured_fallback(
        root_cause=f"Error {error_code} ({error_message}) has no direct documentation match and requires manual verification.",
        notes=[
            "Confirm the exact PLC model, module type, and full error context before making changes.",
            "Capture LEDs, timestamps, and recent modifications for troubleshooting history.",
        ],
        steps=[
            f"Check the Mitsubishi PLC manual for error code {error_code}.",
            "Inspect PLC and module LED indicators and record their state.",
            "Review recent program/parameter changes or hardware replacements.",
            "Escalate to Mitsubishi support or the OEM integrator if the fault persists.",
        ],
        troubleshooting_items=[
            "Common failure patterns: repeated fault after reset, fault appears after configuration change, intermittent startup error.",
            "Relevant LEDs: RUN/ERR/LINK (or module-specific error LED).",
            "Likely diagnostic checks: collect event logs, compare previous working configuration, isolate affected module/channel.",
        ],
    )


def _extract_recommendations(diagnosis: str) -> str:
    """Extract the actionable 'Steps' or legacy 'Recommended Actions' section."""
    lines = diagnosis.split("\n")
    in_section = False
    result = []
    for line in lines:
        line_lower = line.lower()
        if (
            "recommended actions" in line_lower
            or "recommended action" in line_lower
            or re.match(r"^\s*#{2,}\s*steps\b", line_lower)
        ):
            in_section = True
            continue
        if in_section:
            if re.match(r"^\s*#{2,}\s+", line):
                break
            if line.strip():
                result.append(line)
    if result:
        return "\n".join(result)
    return "Review the full diagnosis for step-by-step recovery actions."
