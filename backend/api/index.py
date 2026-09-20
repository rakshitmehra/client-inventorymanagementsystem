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

from app.main import app

__all__ = ["app"]
