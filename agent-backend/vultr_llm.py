"""CrewAI LLM adapter for Vultr Serverless Inference.

All agent reasoning goes through the OpenAI-compatible endpoint at
api.vultrinference.com, as required by the hackathon track.
"""

from __future__ import annotations

import os
import time
from typing import Any, List, Optional, Union

import requests
from crewai import BaseLLM

VULTR_INFERENCE_URL = "https://api.vultrinference.com/v1/chat/completions"
# DeepSeek V4 Flash: flagship-quality output, ~5s latency on agent prompts.
# (GLM-5.2 stalls on long prompts; Kimi-K2.6 returns reasoning-only output.)
DEFAULT_MODEL = os.environ.get("VULTR_INFERENCE_MODEL", "deepseek-ai/DeepSeek-V4-Flash")


class VultrInferenceLLM(BaseLLM):
    """Routes CrewAI agent calls to Vultr Serverless Inference."""

    def __init__(self, model: str = DEFAULT_MODEL, temperature: float = 0.2,
                 max_tokens: int = 4096, timeout_seconds: float = 180.0,
                 max_attempts: int = 3):
        super().__init__(model=model, temperature=temperature)
        self.max_tokens = max_tokens
        self.timeout_seconds = timeout_seconds
        self.max_attempts = max_attempts
        self.api_key = os.environ.get("VULTR_INFERENCE_API_KEY", "")
        if not self.api_key:
            raise RuntimeError("VULTR_INFERENCE_API_KEY is not set")

    def call(
        self,
        messages: Union[str, List[dict]],
        tools: Optional[List[dict]] = None,
        callbacks: Optional[List[Any]] = None,
        available_functions: Optional[dict] = None,
        **kwargs: Any,
    ) -> str:
        normalized = self._normalize(messages)
        payload = {
            "model": self.model,
            "messages": normalized,
            "temperature": self.temperature,
            "max_tokens": self.max_tokens,
        }
        last_error: Optional[Exception] = None
        response = None
        for attempt in range(1, self.max_attempts + 1):
            try:
                response = requests.post(
                    VULTR_INFERENCE_URL,
                    timeout=self.timeout_seconds,
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    },
                    json=payload,
                )
                if response.status_code == 200:
                    break
                last_error = RuntimeError(
                    f"Vultr inference failed: {response.status_code} {response.text[:400]}"
                )
                # Only retry throttling / transient server errors.
                if response.status_code not in (429, 500, 502, 503, 504):
                    raise last_error
                response = None
            except (requests.Timeout, requests.ConnectionError) as exc:
                last_error = exc
                response = None
            if attempt < self.max_attempts:
                time.sleep(2 * attempt)
        if response is None:
            raise RuntimeError(f"Vultr inference failed after retries: {last_error}")
        body = response.json()
        message = body["choices"][0]["message"]
        content = message.get("content")
        # Reasoning models may put text in `reasoning` when content is empty.
        if not content:
            content = message.get("reasoning") or ""
        return content

    def supports_function_calling(self) -> bool:
        return False

    def get_context_window_size(self) -> int:
        return 200_000

    @staticmethod
    def _normalize(messages: Union[str, List[dict]]) -> List[dict]:
        if isinstance(messages, str):
            return [{"role": "user", "content": messages}]
        normalized = []
        for message in messages or []:
            role = str(message.get("role") or "user")
            content = message.get("content") or ""
            if isinstance(content, list):
                content = "\n".join(str(part) for part in content)
            normalized.append({"role": role, "content": str(content)})
        return normalized
