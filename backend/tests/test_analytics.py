"""
Analytics — untrusted-input sanitisation, owner-only summary gate, retention.

/analytics/event is a public write endpoint the browser calls with no
credentials, so its body is fully untrusted. These tests lock in the caps that
stop a single request writing an arbitrarily large row.
"""

import json

import pytest

from routers import analytics as an


# ── Prop sanitisation (untrusted input) ──────────────────────────────────────

def test_rejects_non_dict_props():
    assert an._sanitise_props(None) == {}
    assert an._sanitise_props("not a dict") == {}
    assert an._sanitise_props([1, 2, 3]) == {}


def test_caps_number_of_keys():
    raw = {f"k{i}": i for i in range(200)}
    assert len(an._sanitise_props(raw)) <= an.MAX_PROPS


def test_truncates_long_keys_and_values():
    out = an._sanitise_props({"k" * 500: "v" * 5000})
    key = next(iter(out))
    assert len(key) <= an.MAX_KEY_LEN
    assert len(out[key]) <= an.MAX_VALUE_LEN


def test_nested_structures_are_discarded_not_stored():
    """JSONB would happily persist an arbitrarily deep tree."""
    out = an._sanitise_props({"deep": {"a": {"b": {"c": [1] * 1000}}}, "arr": [1, 2, 3]})
    assert out["deep"] == "<dict>"
    assert out["arr"] == "<list>"


def test_total_serialised_size_is_bounded():
    """Many individually-legal keys must not add up to a large row."""
    raw = {f"key_{i}": "v" * an.MAX_VALUE_LEN for i in range(an.MAX_PROPS)}
    out = an._sanitise_props(raw)
    assert len(json.dumps(out).encode("utf-8")) <= an.MAX_PROPS_BYTES


def test_scalar_types_survive():
    out = an._sanitise_props({"s": "x", "i": 5, "f": 1.5, "b": True, "n": None})
    assert out == {"s": "x", "i": 5, "f": 1.5, "b": True, "n": None}


def test_non_finite_floats_are_nulled():
    """NaN/Infinity are not valid strict JSON and would break JSONB encoding."""
    out = an._sanitise_props({"nan": float("nan"), "inf": float("inf")})
    assert out["nan"] is None
    assert out["inf"] is None


def test_blank_keys_dropped():
    assert an._sanitise_props({"   ": "x", "": "y"}) == {}


# ── Visitor hashing ──────────────────────────────────────────────────────────

class _Req:
    def __init__(self, ip="1.2.3.4", ua="agent", fwd=None):
        self.headers = {"user-agent": ua}
        if fwd:
            self.headers["x-forwarded-for"] = fwd
        self.client = type("C", (), {"host": ip})()


def test_visitor_hash_is_stable_and_opaque():
    r = _Req()
    h = an._visitor_hash(r)
    assert h == an._visitor_hash(r)
    assert len(h) == 32
    assert "1.2.3.4" not in h


def test_visitor_hash_differs_by_client():
    assert an._visitor_hash(_Req(ip="1.1.1.1")) != an._visitor_hash(_Req(ip="2.2.2.2"))
    assert an._visitor_hash(_Req(ua="a")) != an._visitor_hash(_Req(ua="b"))


def test_forwarded_for_takes_leftmost_client():
    """Behind Railway's proxy the real client is the first XFF entry."""
    a = an._visitor_hash(_Req(ip="10.0.0.1", fwd="203.0.113.9, 10.0.0.1"))
    b = an._visitor_hash(_Req(ip="203.0.113.9"))
    assert a == b


def test_production_never_uses_a_publicly_known_salt():
    """
    The repo is public. A hardcoded default salt would let anyone reverse
    visitor hashes by enumerating IPs against a known salt/date/UA.
    """
    assert an._SECRET_SALT != "project-hype-default-salt"
    assert "project-hype" not in an._SECRET_SALT
