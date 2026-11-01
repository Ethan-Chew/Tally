# Contributing

Thanks for looking. Tally is a small personal-finance app, kept deliberately slim, so the best contributions are focused ones: a bug fix, a clearer page, a better import. For anything bigger, open an issue first so we can agree on the shape before you spend time on it.

## Ground rules

- **The database is the original Maybe schema, used as is.** No migrations, no new tables. Features are computed from existing data (see how `server/src/recurring.ts` and `routes/cashflow.ts` do it).
- **Sign convention:** an entry `amount > 0` is an outflow. Transfers and excluded entries stay out of spending and income queries. Conversion to the home currency goes through `fxJoin` / `fxRate`.
- **No login and no third-party services** (bank sync, billing, AI). See "Deliberately left out" in the [README](README.md).
- **Amounts go through `money()`** in the web app, so privacy mode can mask them.
- Match the surrounding code: comment density, naming, plain SQL with `pg`, Zod on every route body.

## Set up

```bash
npm install
npm run db:local:init       # a private Postgres in ~/.maybe-lite (needs: brew install postgresql@17)
npm run dev                 # API on :3001, web on :5173
```

You need a database in the Maybe schema. Either restore a Maybe dump (`npm run db:import -- <file>`, see [docs/DATABASE.md](docs/DATABASE.md)) or use the demo data below.

### Demo data (no real finances needed)

`scripts/demo-seed.mjs` fills an empty database with a made-up household: twelve months of transactions, five accounts, recurring bills, budgets.

```bash
createdb maybe_demo && pg_dump -s --no-owner "$SCHEMA_SOURCE_URL" | psql maybe_demo   # schema only, from any Maybe-schema database
npm run build
DATABASE_URL=postgres:///maybe_demo PORT=3003 npm start &
DATABASE_URL=postgres:///maybe_demo API_URL=http://localhost:3003 node scripts/demo-seed.mjs
```

The seed refuses to run if the database already has users, so it can't be pointed at real data by accident.

## Checks

Run these before opening a pull request:

```bash
npm run typecheck
npx tsx scripts/csv.test.ts
npx tsx scripts/recurring.test.ts
```

`scripts/itest.mjs` and `scripts/import.itest.mjs` exercise the API and **write to the database**. Only run them against a copy (`createdb -T <db> maybe_test`), never your real data.

## Screenshots

The images in `docs/screenshots` come from the demo data, never from real accounts. To refresh them after a UI change, start the demo server as above and run:

```bash
API_URL=http://localhost:3003 node scripts/screenshots.mjs          # light
API_URL=http://localhost:3003 node scripts/screenshots.mjs dark     # dark (only dashboard and budget are kept)
```

It needs Google Chrome (set `CHROME=` if it is installed elsewhere).

## Pull requests

- One change per pull request, with a commit message that says what and why.
- Say how you checked it (the commands above, plus what you clicked through for UI changes).
- Merging to `main` publishes a new Docker image (see [docs/SELF-HOSTING.md](docs/SELF-HOSTING.md)), so `main` should always build.

By contributing you agree that your work is released under the [MIT License](LICENSE).
