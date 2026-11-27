"""SGEC grammar provider wired to the strict offline adapter.

This module keeps the pure adapter free of transport concerns. The provider
accepts a trusted :class:`AssessmentMetadata`, a caller-supplied allowed skill
tag collection, and an injectable synchronous or asynchronous payload source.
``evaluate`` reuses :func:`services.sgec_adapter.build_grammar_evaluation` and
never silently drops a bad batch, returns an empty result for a rejected batch,
or fabricates a successful placeholder.
"""

from __future__ import annotations

import inspect
from collections.abc import Awaitable, Callable, Collection
from typing import Any

from services.assessment_providers import (
    AssessmentMetadata,
    GrammarEvaluation,
    TranscriptAssessmentInput,
)
from services.sgec_adapter import SGECAdapterError, build_grammar_evaluation
from services.sgec_llm import SGECLLMError


class SGECProviderError(RuntimeError):
    """A stable, non-sensitive SGEC provider rejection."""

    def __init__(self, code: str) -> None:
        super().__init__(f"SGEC provider failed: code={code}")
        self.code = code

    def __str__(self) -> str:
        return self.code


PayloadSource = Callable[
    [TranscriptAssessmentInput], dict[str, Any] | Awaitable[dict[str, Any]]
]


class SGECGrammarProvider:
    """A ``GrammarProvider`` that evaluates one strict SGEC payload."""

    def __init__(
        self,
        metadata: AssessmentMetadata,
        allowed_skill_tags: Collection[str],
        payload_source: PayloadSource,
    ) -> None:
        self.metadata = metadata
        self._allowed_skill_tags = allowed_skill_tags
        self._payload_source = payload_source

    async def evaluate(self, value: TranscriptAssessmentInput) -> GrammarEvaluation:
        try:
            payload = self._payload_source(value)
            if inspect.isawaitable(payload):
                payload = await payload
        except SGECLLMError as exc:
            raise SGECProviderError(exc.code) from exc

        try:
            return build_grammar_evaluation(
                payload,
                self._allowed_skill_tags,
                self.metadata,
            )
        except SGECAdapterError as exc:
            raise SGECProviderError(exc.code) from exc

    async def close(self) -> None:
        """Close the payload source when it owns a transport client."""
        closer = getattr(self._payload_source, "close", None)
        if closer is None:
            return
        try:
            result = closer()
        except Exception:
            return
        if inspect.isawaitable(result):
            try:
                await result
            except Exception:
                return
