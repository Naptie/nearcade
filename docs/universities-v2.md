# Universities V2

Nearcade keeps the legacy `universities` collection as the default. The V2 integration is enabled
only when the runtime environment explicitly selects it:

```env
UNIVERSITIES_COLLECTION=universities_v2
MEILISEARCH_UNIVERSITIES_INDEX=universities_v2
```

For local development, put these values in `.env.local`. Environment files are ignored by Git.

The application does not run a MongoDB migration at startup. Data preparation is performed
separately against `nearcade-prep`, and the migration tool refuses any other database name or the
legacy `universities` target. The production deployment therefore continues to read the legacy
collection until its environment is deliberately changed.

## Local dependencies

Local development uses the existing MongoDB URI and runs only Redis and Meilisearch in Docker:

```powershell
pnpm services:up
pnpm dev
```

The dependency compose file binds Redis and Meilisearch to `127.0.0.1` and does not start a local
MongoDB or the Nearcade application. Inspect or stop the services with:

```powershell
pnpm services:logs
pnpm services:down
```

The V2 model is converted to the existing page/API view model in
`src/lib/db/universities.server.ts`. This keeps current routes, memberships, clubs, posts, slugs,
permissions, profile editing, avatar uploads, and campus operations working while the stored model
uses global addresses and Region ID paths.
