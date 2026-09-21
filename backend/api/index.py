"""
Vercel entry point.

Vercel turns every file under ``api/`` into a serverless function and, for
Python, looks for a module-level ASGI application called ``app``. That is all
this file provides - the real application is ``app.main``, unchanged, and it is
the same object uvicorn serves locally.

``app`` is assigned by a plain top-level statement at the bottom of this file,
and it has to stay that way. The builder finds the application by reading the
source, not by importing it, so a name defined only inside ``try``/``except``
is invisible to it and the deploy fails with "Could not find a top-level 'app',
'application', or 'handler'". Everything conditional therefore happens inside
``_load_app()``, which returns the application, rather than binding the name in
a branch.

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


def _failure_app(detail: str):
    """
    Stand in for the real application when it could not be imported.

    A serverless function that raises on import returns a generic 500 with no
    clue what went wrong, and the real reason is buried in a dashboard. Serve
    the reason instead, so `curl` is enough to diagnose a broken deploy.
    """
    print(detail, file=sys.stderr)  # full trace still goes to the Vercel log

    error = sys.exc_info()[1]
    summary = f"{type(error).__name__}: {error}"[:300]
    # Credentials can appear in a connection error. Never put them in a response.
    summary = re.sub(r"://[^@/\s]+@", "://<redacted>@", summary)

    # The facts that separate the handful of things that actually go wrong
    # here, gathered once at import rather than on every request.
    app_dir = os.path.join(_BACKEND_ROOT, "app")
    diagnosis = (
        f"python       : {sys.version.split()[0]}   (this app needs 3.11 or newer)\n"
        f"app/ bundled : {os.path.isdir(app_dir)}\n"
        f"app/main.py  : {os.path.isfile(os.path.join(app_dir, 'main.py'))}\n"
        f"backend root : {_BACKEND_ROOT}\n"
        f"on sys.path  : {_BACKEND_ROOT in sys.path}\n"
    )

    async def broken(scope, receive, send):
        if scope["type"] != "http":
            return
        body = (
            "KitchenStock API failed to start.\n\n"
            f"{summary}\n\n"
            f"{diagnosis}\n"
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

    return broken


def _load_app():
    """Return the real application, or something that explains why it is not."""
    try:
        from app.main import app as fastapi_app
    except Exception:  # noqa: BLE001 - reported through the fallback app
        return _failure_app(traceback.format_exc())
    return fastapi_app


# Top-level and unconditional, so the builder can see it. Do not move this
# into a branch - see the note at the top of the file.
app = _load_app()

__all__ = ["app"]
