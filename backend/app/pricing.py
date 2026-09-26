"""
Keeping costs and values away from kitchen managers.

A kitchen manager runs a kitchen; what the business pays for flour is not
their business, and putting it on their screens invites questions nobody
wants asked on the kitchen floor. So every money figure is removed from what
they are sent.

It is done in one place, on the way out, rather than field by field in the
forty-odd serialisers that build these responses. That is the whole point: a
rule applied in forty places is a rule that gets forgotten on the forty-first,
and the failure is silent - a price simply appears on a screen that should not
have one. Here there is one list and one function, and a new endpoint is
covered by it the day it is written without anybody remembering to.

Only the response is filtered. The figures are still computed, still stored
and still correct; an administrator sees them all. Nothing about stock
control changes.
"""

from __future__ import annotations

from typing import Any

#: Every key in this API that carries money. Enumerated rather than matched by
#: pattern, because "total" is a row count in half the responses and stripping
#: it would quietly break paging.
MONEY_KEYS = frozenset(
    {
        "consumption_cost",
        "cost",
        "cost_per_unit",
        "estimated_cost",
        "kitchen_stock_value",
        "kitchen_value",
        "line_cost",
        "main_value",
        "net_value_impact",
        "selling_price",
        "stock_value",
        "total_cost",
        "total_stock_value",
        "total_value",
        "unit_cost",
        "value",
        "value_impact",
        "wastage_cost",
        "wasted_value",
    }
)


def strip_money(payload: Any) -> Any:
    """
    Return `payload` with every money field removed, however deeply nested.

    Keys are dropped outright rather than zeroed. A zero is a fact - it means
    something cost nothing - and a screen that prints Rs 0.00 for every line is
    worse than one that prints nothing, because it looks like an answer.
    """
    if isinstance(payload, dict):
        return {
            key: strip_money(value)
            for key, value in payload.items()
            if key not in MONEY_KEYS
        }
    if isinstance(payload, list):
        return [strip_money(item) for item in payload]
    return payload
