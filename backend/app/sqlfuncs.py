"""
SQL functions that are spelled differently by different databases.

Production runs on PostgreSQL, but the project keeps a SQLite fallback for
working locally without a server. The two disagree on the name of the
row-wise maximum: PostgreSQL calls it ``greatest``, SQLite calls it ``max``
and has no ``greatest`` at all. Calling ``func.greatest`` directly worked in
production and failed on the fallback with "no such function: greatest",
which made half the reports unusable locally for no reason to do with the
reports.

Naming the difference once, here, is what keeps that out of the query code.
"""

from __future__ import annotations

from sqlalchemy.ext.compiler import compiles
from sqlalchemy.sql.expression import FunctionElement


class greatest(FunctionElement):  # noqa: N801 - reads as the SQL function
    """The largest of its arguments, row by row."""

    name = "greatest"
    inherit_cache = True


@compiles(greatest)
def _default(element, compiler, **kwargs):
    return "greatest(%s)" % compiler.process(element.clauses, **kwargs)


@compiles(greatest, "sqlite")
def _sqlite(element, compiler, **kwargs):
    # SQLite's `max` is the row-wise one when given more than one argument;
    # with a single argument it is the aggregate, which is a different thing.
    return "max(%s)" % compiler.process(element.clauses, **kwargs)
