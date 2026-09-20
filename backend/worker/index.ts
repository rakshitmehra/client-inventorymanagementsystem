/**
 * Front door for the KitchenStock API.
 *
 * Everything this Worker does is hand the request to the container running the
 * FastAPI image and hand the response back. The routing, auth and database work
 * all happen in Python, exactly as they do locally - this exists because a
 * container needs a Worker in front of it on Cloudflare, not because there is
 * logic to put here.
 */
import { Container, getContainer } from '@cloudflare/containers';

interface Env {
  API: DurableObjectNamespace<KitchenStockApi>;

  // Set with `wrangler secret put <NAME>` - never in wrangler.jsonc.
  DATABASE_URL: string;
  JWT_SECRET: string;
  CORS_ORIGINS: string;
}

export class KitchenStockApi extends Container<Env> {
  /** Matches EXPOSE in backend/Dockerfile. */
  defaultPort = 8000;

  /**
   * How long an idle container stays warm.
   *
   * A cold start pays for the Python image plus the first Supabase connection,
   * which is several seconds - long enough that someone tapping "Sign in"
   * assumes it is broken. Fifteen minutes keeps it warm across a working
   * session without holding an instance up overnight.
   */
  sleepAfter = '15m';

  envVars: Record<string, string>;

  constructor(ctx: ConstructorParameters<typeof Container<Env>>[0], env: Env) {
    super(ctx, env);

    // Assigned here rather than as a field initialiser: `this.env` is only
    // populated once super() has run, so a field would capture undefined.
    // Secrets reach the container as ordinary environment variables, which is
    // what pydantic-settings already reads.
    this.envVars = {
      DATABASE_URL: env.DATABASE_URL,
      JWT_SECRET: env.JWT_SECRET,
      CORS_ORIGINS: env.CORS_ORIGINS,

      APP_ENV: 'production',
      DEBUG: 'false',

      // The schema is created if it is missing, which is what makes the very
      // first deploy work against an empty Supabase database. It is idempotent,
      // so leaving it on costs one cheap check per cold start.
      SEED_ON_STARTUP: 'true',

      // The demo dataset only loads into a database with no items in it, so
      // this never overwrites real stock. Set it to false once the client
      // starts entering their own.
      SEED_DEMO_DATA: 'true',
    };
  }

  override onError(error: unknown): Response {
    console.error('container error', error);
    return Response.json(
      { detail: 'The API is starting up or unavailable. Try again in a moment.' },
      { status: 503 },
    );
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // One container, addressed by a fixed name, so every request lands on the
    // same warm instance instead of starting a new one per visitor.
    return getContainer(env.API, 'kitchenstock-api').fetch(request);
  },
} satisfies ExportedHandler<Env>;
