"""
LLM interaction — system prompt and direct (Fast mode) queries.
"""

import time
import logging
from typing import Any, Dict, List

logger = logging.getLogger("PLCAssistant")

SYSTEM_PROMPT = """You are a knowledgeable PLC & Industrial Automation Assistant.

EXPERTISE AREAS:
• PLC Programming: Ladder Logic, Structured Text, Function Block Diagram, Instruction List, Sequential Function Chart
• Industrial Protocols: Modbus (RTU/TCP), PROFINET, EtherNet/IP, OPC UA, PROFIBUS, CANopen, BACnet
• Automation Systems: SCADA, HMI, DCS, MES integration
• Motion Control: Servo drives, VFDs, stepper motors, positioning
• Safety Systems: Safety PLCs, emergency stops, light curtains, IEC 61508/62443
• Troubleshooting: Diagnostic techniques, error analysis, preventive maintenance

RESPONSE GUIDELINES:
1. Always respond in English, regardless of the input language
2. Be precise and technical when discussing automation topics
3. Include relevant specifications, standards, or protocols when applicable
4. Provide step-by-step guidance for troubleshooting questions
5. Mention safety considerations where relevant
6. If you don't know something, say so clearly"""


def build_system_prompt() -> str:
    return SYSTEM_PROMPT


def ask_llm_directly(
    llm,
    question: str,
    file_content: str = "",
    filename: str = "",
    mode: str = "fast",
    chat_history: List[Dict] = None,
    web_context: str = "",
    fast_mode_chars: int = 8000,
    deep_mode_chars: int = 60000,
) -> Dict[str, Any]:
    """Send question directly to LLM without RAG (Fast mode)."""
    start_time = time.perf_counter()

    history_str = ""
    if chat_history:
        for msg in chat_history[-10:]:
            role = "User" if msg.get("sender") == "user" else "Assistant"
            text = msg.get("text", "")[:500]
            history_str += f"{role}: {text}\n"

    file_section = ""
    if file_content:
        max_chars = deep_mode_chars if mode == "deep" else fast_mode_chars
        truncated = len(file_content) > max_chars
        content = file_content[:max_chars] if truncated else file_content
        file_section = f"""
=== UPLOADED FILE: {filename} ===
{content}
{"[... content truncated ...]" if truncated else ""}
==="""

    web_section = ""
    if web_context:
        web_section = f"""
=== WEB SEARCH RESULTS ===
{web_context}
==="""

    prompt = f"""{SYSTEM_PROMPT}

{"=== CONVERSATION HISTORY ===" + chr(10) + history_str + "===" if history_str else ""}
{file_section}
{web_section}

USER QUESTION: {question}

Provide a helpful, detailed response in English:"""

    try:
        response = llm.invoke(prompt)
        elapsed = time.perf_counter() - start_time
        return {"reply": response, "processing_time": elapsed, "mode": mode}
    except Exception as e:
        logger.error(f"🔥 LLM error: {e}")
        return {
            "reply": f"I encountered an error processing your request: {str(e)}",
            "processing_time": time.perf_counter() - start_time,
            "mode": mode,
        }
