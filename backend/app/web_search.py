"""
DuckDuckGo web search integration.
"""

import re
import logging

import requests

logger = logging.getLogger("PLCAssistant")


def web_search(query: str, max_results: int = 5, timeout: int = 10) -> str:
    """Search the web using DuckDuckGo HTML interface."""
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }

        from urllib.parse import quote_plus
        search_url = f"https://html.duckduckgo.com/html/?q={quote_plus(query)}"

        response = requests.get(search_url, headers=headers, timeout=timeout)

        if response.status_code != 200:
            logger.warning(f"Web search returned status {response.status_code}")
            return ""

        html = response.text
        results = []

        snippet_pattern = r'<a class="result__snippet"[^>]*>(.*?)</a>'
        snippets = re.findall(snippet_pattern, html, re.DOTALL)

        for snippet in snippets[:max_results]:
            clean_snippet = re.sub(r'<[^>]+>', '', snippet).strip()
            if clean_snippet:
                results.append(f"• {clean_snippet}")

        if results:
            logger.info(f"🌐 Web search found {len(results)} results for: {query[:50]}...")
            return "\n".join(results)

        title_pattern = r'<a class="result__a"[^>]*>(.*?)</a>'
        titles = re.findall(title_pattern, html, re.DOTALL)

        for title in titles[:max_results]:
            clean_title = re.sub(r'<[^>]+>', '', title).strip()
            if clean_title:
                results.append(f"• {clean_title}")

        return "\n".join(results) if results else ""

    except requests.exceptions.Timeout:
        logger.warning("Web search timed out")
        return ""
    except Exception as e:
        logger.error(f"Web search error: {e}")
        return ""
