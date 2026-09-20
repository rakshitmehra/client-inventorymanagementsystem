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

    async def app(scope, receive, send):  # type: ignore[misc]
        if scope["type"] != "http":
            return
        body = (
            "KitchenStock API failed to start.\n\n"
            f"{_summary}\n\n"
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


__all__ = ["app"]
