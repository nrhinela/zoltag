import pytest

import zoltag.tagging as tagging
from zoltag.tagging import calculate_tags

def test_calculate_tags():
    # Scenario 1: No permatags
    machine_tags = [{"keyword": "dog", "category": "animal"}, {"keyword": "park", "category": "location"}]
    permatags = []
    calculated = calculate_tags(machine_tags, permatags)
    assert len(calculated) == 2
    assert {"keyword": "dog", "category": "animal"} in calculated
    assert {"keyword": "park", "category": "location"} in calculated

    # Scenario 2: Negative permatag
    machine_tags = [{"keyword": "dog", "category": "animal"}, {"keyword": "park", "category": "location"}]
    permatags = [{"keyword": "dog", "signum": -1, "category": "animal"}]
    calculated = calculate_tags(machine_tags, permatags)
    assert len(calculated) == 1
    assert {"keyword": "park", "category": "location"} in calculated
    assert {"keyword": "dog", "category": "animal"} not in [tag for tag in calculated]


    # Scenario 3: Positive permatag
    machine_tags = [{"keyword": "dog", "category": "animal"}]
    permatags = [{"keyword": "beach", "signum": 1, "category": "location"}]
    calculated = calculate_tags(machine_tags, permatags)
    assert len(calculated) == 2
    assert any(tag['keyword'] == 'dog' for tag in calculated)
    assert any(tag['keyword'] == 'beach' for tag in calculated)


    # Scenario 4: Keyword in both machine and positive permatag
    machine_tags = [{"keyword": "dog", "category": "animal"}]
    permatags = [{"keyword": "dog", "signum": 1, "category": "animal"}]
    calculated = calculate_tags(machine_tags, permatags)
    assert len(calculated) == 1
    assert any(tag['keyword'] == 'dog' for tag in calculated)

    # Scenario 5: Negative permatag for a non-existent machine tag
    machine_tags = [{"keyword": "dog", "category": "animal"}]
    permatags = [{"keyword": "cat", "signum": -1, "category": "animal"}]
    calculated = calculate_tags(machine_tags, permatags)
    assert len(calculated) == 1
    assert any(tag['keyword'] == 'dog' for tag in calculated)

    # Scenario 6: Empty machine tags
    machine_tags = []
    permatags = [{"keyword": "beach", "signum": 1, "category": "location"}]
    calculated = calculate_tags(machine_tags, permatags)
    assert len(calculated) == 1
    assert any(tag['keyword'] == 'beach' for tag in calculated)


def test_get_tagger_raises_on_cache_miss_when_auto_download_disabled(monkeypatch):
    monkeypatch.setenv("TAGGING_MODEL_AUTO_DOWNLOAD", "false")
    monkeypatch.setattr(tagging, "is_model_cached", lambda model_type="siglip": False)

    class _ShouldNotInstantiate:
        def __init__(self, *args, **kwargs):
            raise AssertionError("SigLIPTagger should not be instantiated")

    monkeypatch.setattr(tagging, "SigLIPTagger", _ShouldNotInstantiate)
    monkeypatch.setattr(tagging, "_tagger_instances", {})

    with pytest.raises(RuntimeError, match="AI model not downloaded yet"):
        tagging.get_tagger("siglip")


def test_get_tagger_auto_downloads_on_cache_miss_when_enabled(monkeypatch):
    monkeypatch.setenv("TAGGING_MODEL_AUTO_DOWNLOAD", "true")
    monkeypatch.setattr(tagging, "is_model_cached", lambda model_type="siglip": False)

    class _FakeTagger:
        pass

    monkeypatch.setattr(tagging, "SigLIPTagger", _FakeTagger)
    monkeypatch.setattr(tagging, "_tagger_instances", {})

    tagger = tagging.get_tagger("siglip")
    assert isinstance(tagger, _FakeTagger)
