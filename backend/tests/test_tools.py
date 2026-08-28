"""The aggregation path is the one the chat must never get wrong."""

import json

from app.llm.tools import ToolRunner, _field_value, _matches
from app.models import Address, Job, Kid, Person, Salary, utcnow


def _person(**kwargs) -> Person:
    now = utcnow()
    defaults = dict(id=kwargs.pop("id", "1"), created_at=now, updated_at=now)
    return Person(**defaults, **kwargs)


def test_salary_is_annualised_before_comparison():
    monthly = _person(given_name="M", salary=Salary(amount=5000, period="month"))
    assert _field_value(monthly, "salary_annual") == 60000
    assert _matches(_field_value(monthly, "salary_annual"), "gt", 50000)


def test_filter_counts_exactly():
    people = [
        _person(id="1", given_name="A", salary=Salary(amount=62000)),
        _person(id="2", given_name="B", salary=Salary(amount=48000)),
        _person(id="3", given_name="C", salary=Salary(amount=None)),
    ]
    result = json.loads(ToolRunner("sub", people).run("filter_people", {
        "field": "salary_annual", "op": "gt", "value": 50000,
    }))
    assert result["count"] == 1
    assert result["total_people"] == 3


def test_opted_out_people_are_never_exposed():
    people = [
        _person(id="1", given_name="Visible"),
        _person(id="2", given_name="Hidden", ai_optout=True),
    ]
    runner = ToolRunner("sub", people)
    assert "Hidden" not in runner.index_for_prompt()
    assert json.loads(runner.run("get_person", {"person_id": "2"})).get("error")


def test_birth_month_handles_unknown_year():
    p = _person(given_name="X", birthday="--04-12")
    assert _field_value(p, "birth_month") == 4
    assert _field_value(p, "birth_year") is None


def test_text_match_is_case_insensitive():
    p = _person(given_name="X", address=Address(city="München"))
    assert _matches(_field_value(p, "city"), "eq", "münchen")
    assert _matches(_field_value(p, "job_title"), "exists", None) is False
    assert _matches(_field_value(_person(given_name="Y", job=Job(title="PM")), "job_title"),
                    "contains", "pm")


def test_kids_count():
    p = _person(given_name="X", kids=[Kid(name="A"), Kid(name="B")])
    assert _field_value(p, "kids_count") == 2
