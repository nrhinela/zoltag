import pytest

from zoltag.job_profiles import (
    RUN_PROFILE_LIGHT,
    RUN_PROFILE_ML,
    infer_run_profile_for_definition_key,
    normalize_run_profile,
)


def test_normalize_run_profile_defaults_to_light():
    assert normalize_run_profile(None) == RUN_PROFILE_LIGHT
    assert normalize_run_profile("") == RUN_PROFILE_LIGHT


def test_normalize_run_profile_strict_validation():
    assert normalize_run_profile("ML", strict=True) == RUN_PROFILE_ML
    with pytest.raises(ValueError):
        normalize_run_profile("unknown", strict=True)


def test_infer_run_profile_for_ml_definitions():
    assert infer_run_profile_for_definition_key("build-embeddings") == RUN_PROFILE_ML
    assert infer_run_profile_for_definition_key("sync-dropbox") == RUN_PROFILE_LIGHT
