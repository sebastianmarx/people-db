"""Relationships are stored twice, once per direction. The pairing and the
cleanup on delete are the parts that go wrong silently, so they are pinned here.
"""

import pytest

from app.models import PersonInput

SUB = "owner-sub"


def _pair(repo):
    alex = repo.create_person(SUB, PersonInput(given_name="Alex", family_name="Meyer"))
    mila = repo.create_person(SUB, PersonInput(given_name="Mila", family_name="Meyer"))
    return alex, mila


def test_relationship_is_mirrored_with_the_inverse_role(aws):
    repo = aws
    alex, mila = _pair(repo)

    # "Mila is Alex's child"
    repo.set_relationship(alex.id, mila.id, "child")

    from_alex = repo.list_relationships(alex.id)
    from_mila = repo.list_relationships(mila.id)

    assert [(r["other_id"], r["type"]) for r in from_alex] == [(mila.id, "child")]
    assert [(r["other_id"], r["type"]) for r in from_mila] == [(alex.id, "parent")]


def test_symmetric_types_mirror_themselves(aws):
    repo = aws
    a, b = _pair(repo)
    repo.set_relationship(a.id, b.id, "spouse")
    assert repo.list_relationships(b.id)[0]["type"] == "spouse"


def test_delete_removes_both_directions(aws):
    repo = aws
    a, b = _pair(repo)
    repo.set_relationship(a.id, b.id, "sibling")
    repo.delete_relationship(a.id, b.id)

    assert repo.list_relationships(a.id) == []
    assert repo.list_relationships(b.id) == []


def test_deleting_a_person_clears_the_mirror_on_the_other_side(aws):
    repo = aws
    alex, mila = _pair(repo)
    repo.set_relationship(alex.id, mila.id, "child")

    repo.delete_person(SUB, alex.id)

    # Mila must not be left pointing at a person who no longer exists.
    assert repo.list_relationships(mila.id) == []


def test_self_relationship_is_rejected(aws):
    repo = aws
    alex, _ = _pair(repo)
    with pytest.raises(ValueError):
        repo.set_relationship(alex.id, alex.id, "friend")


def test_unknown_type_is_rejected(aws):
    repo = aws
    a, b = _pair(repo)
    with pytest.raises(ValueError):
        repo.set_relationship(a.id, b.id, "nemesis")


def test_relationships_do_not_leak_into_notes(aws):
    repo = aws
    a, b = _pair(repo)
    repo.set_relationship(a.id, b.id, "friend")
    assert repo.list_notes(a.id) == []
