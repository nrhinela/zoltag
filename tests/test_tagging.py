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
