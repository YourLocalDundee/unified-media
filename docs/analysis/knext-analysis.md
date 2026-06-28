# knext Analysis

Source: `sources/knext/`
Stack: Next.js 14 App Router, Auth.js v5 (next-auth), Knex.js, better-sqlite3, shadcn/ui, Tailwind

---

## Overview

knext is a minimal starter template demonstrating Auth.js v5 + Knex + SQLite. It is intentionally small — GitHub OAuth only, no profile/settings pages, no password management. Its value is the exact pattern for wiring Knex with Auth.js v5 using better-sqlite3, which matches the unified-frontend stack exactly.

---

## SQLite + Knex Configuration (`src/lib/db.ts`)

```ts
const config = {
  client: "better-sqlite3",
  connection: {
    filename: process.env.DATABASE_PATH || "./db.sqlite",
  },
  useNullAsDefault: true,
  migrations: {
    directory: "./src/migrations",
    loadExtensions: [".ts", ".js"],
  },
};

export default knex(config);
```

Key points:
- `useNullAsDefault: true` is required for SQLite — Knex inserts `NULL` for missing values instead of erroring.
- The `db` singleton is exported and used in `src/services/user.ts` directly.
- `DATABASE_PATH` env var controls the DB file path — mirrors the `DB_PATH` pattern in unified-frontend.

---

## User Schema (Migration: `src/migrations/20240425141133_users.js`)

```js
table.string("id").primary()      // Auth.js provider user ID (e.g., GitHub user ID as string)
table.string("name").notNullable()
table.string("email").notNullable()
table.string("image")             // Avatar URL from OAuth provider
```

No `password`, `role`, `sessions`, or settings columns — this is OAuth-only. The `id` is set by the OAuth provider, not auto-generated.

---

## NextAuth Session Model (`src/auth.ts`)

Auth.js v5 with GitHub provider only. No database adapter is configured — it uses the default JWT session strategy.

The `signIn` callback pattern:
1. Validates that `user.id`, `user.name`, and `user.email` all exist.
2. Maps the OAuth user to an `AppUser` type (just `{ id, name, email, image }`).
3. Calls `findOrCreateUser(appUser)` — upsert pattern.
4. Returns `true` to allow sign-in, `false` to block it.

No custom `session` or `jwt` callbacks — session data is whatever Auth.js provides by default (email, name, image from the provider).

The route handler is a thin re-export: `src/app/api/auth/[...nextauth]/route.ts` just does `export const { GET, POST } = handlers`.

---

## findOrCreateUser Pattern (`src/services/user.ts`)

```ts
export async function findOrCreateUser(user: User) {
  const existingUser = await db("users").where({ email: user.email }).first()
  if (existingUser) {
    return existingUser
  }
  await db("users").insert({ ...user })
  const newUser = await db("users").where({ email: user.email }).first()
  return newUser
}
```

This is a race-condition-prone pattern (no `INSERT OR IGNORE` / `upsert`). For unified-frontend, use better-sqlite3 directly with `INSERT OR IGNORE INTO users ... ON CONFLICT(email) DO NOTHING` or Knex's `.onConflict('email').ignore()`.

---

## Profile / Settings Patterns

knext has NO profile or settings pages. The home page (`src/app/page.tsx`) shows the session user via a server component calling `auth()`. No settings, no password change, no profile edit.

---

## Reuse Notes for unified-frontend

### What to take from knext

1. **Knex + better-sqlite3 config pattern** — exact template for `src/lib/db.ts` if you decide to use Knex as a query builder instead of raw better-sqlite3. The `useNullAsDefault: true` requirement is a gotcha that knext documents in practice.

2. **Migration directory convention** — `src/migrations/` with `.js` files is the standard Knex pattern. The unified-frontend already uses a custom migration system in `src/lib/db/migrations.ts`, but Knex's migration runner is worth considering for future schema changes since it tracks migration state automatically.

3. **signIn callback upsert** — The `findOrCreateUser` pattern in the Auth.js `signIn` callback is the standard approach for OAuth providers. The unified-frontend uses invite-code registration instead of OAuth, so this is less relevant, but the pattern would apply if OAuth is ever added.

### What knext lacks (and unified-frontend has)

- Password-based auth (unified-frontend has `hashPassword`/`verifyPassword` in `src/lib/password.ts`)
- Role system
- Session management (unified-frontend has 30-day TTL, 24h rotation)
- Invite codes
- Profile/settings pages
- Any notion of admin vs user

knext is strictly a reference for the Knex+SQLite+Auth.js v5 wiring pattern, not for feature completeness.
