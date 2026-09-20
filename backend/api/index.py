"""
Vercel entry point.

Vercel turns every file under ``api/`` into a serverless function and, for
Python, looks for a module-level ASGI application called ``app``. That is all
this file provides - the real application is ``app.main``, unchanged, and it is
the same object uvicorn serves locally.

Serverless changes three things about how this app should be configured. None
of them need a code change, but getting them wrong produces failures that look
like bugs:

1. Every cold start is a fresh Python process with its own database
   connections. Use Supabase's TRANSACTION pooler (port 6543); app/database.py
   detects that port and switches off prepared statements and client-side
   pooling, which that mode requires.

2. Set SEED_ON_STARTUP=false. The seed is idempotent, so leaving it on is not
   destructive - it just adds a round trip to Supabase on every single cold
   start, to confirm something you already know.

3. Set DEBUG=false, which also hides /docs, /redoc and /openapi.json.

See DEPLOYMENT.md for the full list of environment variables.
"""

import os
import re
import sys
import traceback

# Vercel runs this file with its own directory on sys.path, not the project
# root, so `import app` fails with a bare ModuleNotFoundError and the request
# dies as an opaque FUNCTION_INVOCATION_FAILED. Put backend/ on the path first.
_BACKEND_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _BACKEND_ROOT not in sys.path:
    sys.path.insert(0, _BACKEND_ROOT)

try:
    from app.main import app

except Exception:  # noqa: BLE001 - reported through the fallback app below
    # A serverless function that raises on import returns a generic 500 with no
    # clue what went wrong, and the real reason is buried in a dashboard. Serve
    # the reason instead, so `curl` is enough to diagnose a broken deploy.
    _DETAIL = traceback.format_exc()
    print(_DETAIL, file=sys.stderr)  # full trace still goes to the Vercel log

    _error = sys.exc_info()[1]
    _summary = f"{type(_error).__name__}: {_error}"[:300]
    # Credentials can appear in a connection error. Never put them in a response.
    _summary = re.sub(r"://[^@/\s]+@", "://<redacted>@", _summary)

    # The facts that separate the handful of things that actually go wrong
    # here, gathered once at import rather than on every request.
    _app_dir = os.path.join(_BACKEND_ROOT, "app")
    _diagnosis = (
        f"python       : {sys.version.split()[0]}   (this app needs 3.11 or newer)\n"
        f"app/ bundled : {os.path.isdir(_app_dir)}\n"
        f"app/main.py  : {os.path.isfile(os.path.join(_app_dir, 'main.py'))}\n"
        f"backend root : {_BACKEND_ROOT}\n"
        f"on sys.path  : {_BACKEND_ROOT in sys.path}\n"
    )

    async def app(scope, receive, send):  # type: ignore[misc]
        if scope["type"] != "http":
            return
        body = (
            "KitchenStock API failed to start.\n\n"
            f"{_summary}\n\n"
            f"{_diagnosis}\n"
            "The full traceback is in the Vercel function logs "
            "(Deployments > the deployment > Logs).\n"
        ).encode()
        await send(
            {
                "type": "http.response.start",
                "status": 500,
                "headers": [
                    (b"content-type", b"text/plain; charset=utf-8"),
                    (b"cache-control", b"no-store"),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})


# ---------------------------------------------------------------------------
# Path probe.
#
# Routing on a serverless host is the one thing that cannot be tested from a
# laptop, and when it is wrong every route returns 404 with nothing to say why.
# Adding ?__whoami=1 to any URL reports the path this app was actually handed,
# which is the single fact needed to tell "wrong routing" from "wrong app".
#
# Deliberately narrow: the request path and nothing else. No headers, no
# environment, so it cannot leak a token or a connection string.
# ---------------------------------------------------------------------------
_application = app


async def app(scope, receive, send):  # type: ignore[misc]
    if scope["type"] == "http" and b"__whoami" in scope.get("query_string", b""):
        body = (
            f"path       : {scope.get('path')}\n"
            f"root_path  : {scope.get('root_path', '')}\n"
            f"query      : {scope.get('query_string', b'').decode('utf-8', 'replace')}\n"
            "\n"
            "If 'path' is not the URL you requested, the host is rewriting it\n"
            "and no route can match. See the routing note in vercel.json.\n"
        ).encode()
        await send(
            {
                "type": "http.response.start",
                "status": 200,
                "headers": [
                    (b"content-type", b"text/plain; charset=utf-8"),
                    (b"cache-control", b"no-store"),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})
        return

    await _application(scope, receive, send)


__all__ = ["app"]
