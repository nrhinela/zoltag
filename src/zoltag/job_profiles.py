"""Job run-profile helpers for routing to light vs ML workers."""

from __future__ import annotations

from typing import Any

RUN_PROFILE_LIGHT = "light"
RUN_PROFILE_ML = "ml"
VALID_RUN_PROFILES = (RUN_PROFILE_LIGHT, RUN_PROFILE_ML)


# Commands that require the SigLIP model at runtime.
ML_JOB_DEFINITION_KEYS = frozenset(
    {
        "build-embeddings",
        "train-keyword-models",
        "recompute-trained-tags",
        "recompute-zeroshot-tags",
        "rebuild-asset-text-index",
        # sync-providers runs build-embeddings in-process when new items are added.
        "sync-providers",
    }
)


def normalize_run_profile(
    value: Any,
    *,
    default: str = RUN_PROFILE_LIGHT,
    strict: bool = False,
) -> str:
    """Normalize a run profile to one of the supported values."""
    text = str(value or "").strip().lower()
    if not text:
        return default
    if text in VALID_RUN_PROFILES:
        return text
    if strict:
        valid = ", ".join(VALID_RUN_PROFILES)
        raise ValueError(f"Invalid run_profile '{text}'. Expected one of: {valid}")
    return default


def infer_run_profile_for_definition_key(definition_key: str | None) -> str:
    """Infer run profile from job definition key."""
    key = str(definition_key or "").strip()
    if key in ML_JOB_DEFINITION_KEYS:
        return RUN_PROFILE_ML
    return RUN_PROFILE_LIGHT


def resolve_definition_run_profile(definition: Any) -> str:
    """Resolve effective run profile for a JobDefinition row/object."""
    key = str(getattr(definition, "key", "") or "").strip()
    default = infer_run_profile_for_definition_key(key)
    return normalize_run_profile(getattr(definition, "run_profile", None), default=default, strict=False)
