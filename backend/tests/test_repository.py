import pytest

from app.models import Address, Job, Kid, NoteInput, PersonInput, PersonPatch, Salary

SUB = "owner-sub"


def _alex() -> PersonInput:
    return PersonInput(
        given_name="Alex",
        family_name="Meyer",
        address=Address(city="Berlin", country="DE"),
        salary=Salary(amount=62000, currency="EUR", period="year"),
        job=Job(title="Product Manager", company="Acme"),
        kids=[Kid(name="Mila", birth_year=2019)],
        tags=["climbing"],
    )


def test_create_and_read(aws):
    repo = aws
    created = repo.create_person(SUB, _alex())
    assert created.version == 1

    fetched = repo.get_person(SUB, created.id)
    assert fetched.given_name == "Alex"
    assert fetched.salary.amount == 62000
    assert fetched.kids[0].birth_year == 2019  # not 2019.0


def test_list_is_sorted_by_family_name(aws):
    repo = aws
    repo.create_person(SUB, PersonInput(given_name="Zoe", family_name="Adler"))
    repo.create_person(SUB, _alex())
    names = [p.family_name for p in repo.list_people(SUB)]
    assert names == ["Adler", "Meyer"]


def test_optimistic_locking(aws):
    repo = aws
    person = repo.create_person(SUB, _alex())
    repo.update_person(SUB, person.id, PersonPatch(given_name="Alexander", version=1))

    with pytest.raises(repo.ConflictError):
        repo.update_person(SUB, person.id, PersonPatch(given_name="Al", version=1))


def test_delete_cascades_notes(aws):
    repo = aws
    person = repo.create_person(SUB, _alex())
    repo.add_note(person.id, NoteInput(body="Moving to Munich in October."))
    assert len(repo.list_notes(person.id)) == 1

    repo.delete_person(SUB, person.id)
    assert repo.list_notes(person.id) == []
    with pytest.raises(repo.NotFoundError):
        repo.get_person(SUB, person.id)


def test_person_of_another_user_is_invisible(aws):
    repo = aws
    person = repo.create_person(SUB, _alex())
    with pytest.raises(repo.NotFoundError):
        repo.get_person("someone-else", person.id)
