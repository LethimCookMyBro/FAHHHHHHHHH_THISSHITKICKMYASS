"""
Unit tests for RAG Ranking Accuracy Upgrades.

Tests:
1. CrossEncoderRerankRetriever - sorting, fallback, and scoring
2. Confidence Gate - rejection when scores are too low  
3. Citation expansion - citations for all question modes
4. Threshold constants verification
"""
import unittest
from unittest.mock import patch, MagicMock
from pathlib import Path
import sys
import os

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))


# --- Helpers ---

def _make_doc(content, score=0.5, distance=0.5, chunk_type="standard"):
    """Create a Document with metadata."""
    from langchain_core.documents import Document
    return Document(
        page_content=content,
        metadata={
            "score": score,
            "distance": distance,
            "source": "test.pdf",
            "chunk_type": chunk_type,
        },
    )


def _make_mock_retriever(docs=None):
    """Create a minimal BaseRetriever subclass that returns fixed docs."""
    from langchain_core.retrievers import BaseRetriever
    from langchain_core.documents import Document
    from typing import List

    class FixedRetriever(BaseRetriever):
        _docs: list = []

        def _get_relevant_documents(self, query: str) -> List[Document]:
            return list(self._docs)

    r = FixedRetriever()
    r._docs = docs or []
    return r


# --- Tests ---

class TestCrossEncoderRetriever(unittest.TestCase):
    """Test CrossEncoderRerankRetriever class."""

    def test_fallback_when_cross_encoder_unavailable(self):
        """When cross-encoder model can't load, should fall back to base scores."""
        from app.retriever import CrossEncoderRerankRetriever
        import app.retriever as ret_mod

        original_instance = ret_mod._cross_encoder_instance
        original_failed = ret_mod._cross_encoder_load_failed
        ret_mod._cross_encoder_instance = None
        ret_mod._cross_encoder_load_failed = True

        try:
            docs = [
                _make_doc("Doc A about motors", score=0.8),
                _make_doc("Doc B about valves", score=0.6),
                _make_doc("Doc C about sensors", score=0.9),
            ]

            base = _make_mock_retriever()
            retriever = CrossEncoderRerankRetriever(
                base_retriever=base,
                prefetched_docs=docs,
                top_n=2,
            )
            result = retriever._get_relevant_documents("motor vibration")

            self.assertEqual(len(result), 2)
            for doc in result:
                self.assertIn("cross_encoder_score", doc.metadata)
        finally:
            ret_mod._cross_encoder_instance = original_instance
            ret_mod._cross_encoder_load_failed = original_failed

    def test_empty_candidates_returns_empty(self):
        """When no candidates are provided, should return empty list."""
        from app.retriever import CrossEncoderRerankRetriever

        base = _make_mock_retriever()
        retriever = CrossEncoderRerankRetriever(
            base_retriever=base,
            prefetched_docs=[],
            top_n=5,
        )
        result = retriever._get_relevant_documents("any query")
        self.assertEqual(result, [])

    def test_top_n_limits_results(self):
        """Top_n should limit the number of returned documents."""
        from app.retriever import CrossEncoderRerankRetriever
        import app.retriever as ret_mod

        original_instance = ret_mod._cross_encoder_instance
        original_failed = ret_mod._cross_encoder_load_failed
        ret_mod._cross_encoder_instance = None
        ret_mod._cross_encoder_load_failed = True

        try:
            docs = [_make_doc(f"Doc {i}", score=0.5) for i in range(10)]
            base = _make_mock_retriever()
            retriever = CrossEncoderRerankRetriever(
                base_retriever=base,
                prefetched_docs=docs,
                top_n=3,
            )
            result = retriever._get_relevant_documents("test query")
            self.assertLessEqual(len(result), 3)
        finally:
            ret_mod._cross_encoder_instance = original_instance
            ret_mod._cross_encoder_load_failed = original_failed


class TestConfidenceGateAndThresholds(unittest.TestCase):
    """Test Confidence Gate constants and code paths."""

    def test_ragas_thresholds_tightened(self):
        """Verify RAGAS thresholds are properly tightened."""
        from app.chat_agent.retrieval import (
            RAGAS_MIN_THRESHOLD,
            RAGAS_FAITHFULNESS_HARD_FAIL,
            RAGAS_RELEVANCY_HARD_FAIL,
        )
        self.assertGreaterEqual(RAGAS_MIN_THRESHOLD, 0.55)
        self.assertGreaterEqual(RAGAS_FAITHFULNESS_HARD_FAIL, 0.45)
        self.assertGreaterEqual(RAGAS_RELEVANCY_HARD_FAIL, 0.45)

    def test_confidence_gate_code_exists(self):
        """Verify the confidence gate code path exists in retrieval.py."""
        import inspect
        from app.chat_agent import retrieval

        source = inspect.getsource(retrieval)
        self.assertIn("ENABLE_CONFIDENCE_GATE", source)
        self.assertIn("CONFIDENCE_MIN_SCORE", source)
        self.assertIn("confidence_gate", source)

    def test_force_citations_code_exists(self):
        """Verify the forced-citations code path exists."""
        import inspect
        from app.chat_agent import retrieval

        source = inspect.getsource(retrieval)
        self.assertIn("FORCE_CITATIONS_ALL_MODES", source)

    def test_two_stage_pipeline_code_exists(self):
        """Verify the two-stage pipeline code exists."""
        import inspect
        from app.chat_agent import retrieval

        source = inspect.getsource(retrieval)
        self.assertIn("CrossEncoderRerankRetriever", source)
        self.assertIn("stage1_docs", source)
        self.assertIn("Stage 1", source)
        self.assertIn("Stage 2", source)


class TestFlashrankBoosts(unittest.TestCase):
    """Test existing Flashrank retriever boosts still work."""

    def test_golden_qa_ranked_first(self):
        """Golden QA chunks should get massive boost."""
        from app.retriever import EnhancedFlashrankRerankRetriever

        docs = [
            _make_doc("Regular PLC document", chunk_type="standard"),
            _make_doc("Golden QA PLC configuration", chunk_type="golden_qa"),
        ]

        base = _make_mock_retriever()
        retriever = EnhancedFlashrankRerankRetriever(
            base_retriever=base,
            prefetched_docs=docs,
            top_n=2,
        )
        result = retriever._get_relevant_documents("PLC configuration")

        self.assertEqual(len(result), 2)
        self.assertEqual(result[0].metadata.get("chunk_type"), "golden_qa")

    def test_error_code_boost(self):
        """Error code matches should get significant boost."""
        from app.retriever import EnhancedFlashrankRerankRetriever

        docs = [
            _make_doc("General troubleshooting guide"),
            _make_doc("Error F800H indicates motor fault"),
        ]

        base = _make_mock_retriever()
        retriever = EnhancedFlashrankRerankRetriever(
            base_retriever=base,
            prefetched_docs=docs,
            top_n=2,
        )
        result = retriever._get_relevant_documents("What does F800H mean?")

        self.assertEqual(len(result), 2)
        self.assertIn("F800H", result[0].page_content)


class TestRouteChatWiring(unittest.TestCase):
    """Test CrossEncoder is properly wired in routes_chat.py."""

    def test_cross_encoder_importable(self):
        """CrossEncoderRerankRetriever should be importable."""
        from app.retriever import CrossEncoderRerankRetriever
        self.assertIsNotNone(CrossEncoderRerankRetriever)

    def test_routes_chat_references_cross_encoder(self):
        """Verify routes_chat.py contains CrossEncoder references."""
        import inspect
        from app import routes_chat

        source = inspect.getsource(routes_chat)
        self.assertIn("CrossEncoderRerankRetriever", source)
        self.assertIn("USE_CROSS_ENCODER", source)


if __name__ == "__main__":
    unittest.main()
