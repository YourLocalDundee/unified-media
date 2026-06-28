# next-authjs-starterkit Analysis

Source: `sources/next-authjs-starterkit/`
Stack: Next.js 15 App Router, Auth.js v5 (next-auth), Prisma, PostgreSQL, shadcn/ui, Tailwind, Zod, react-hook-form, bcryptjs, Sonner (toasts)

---

## Password Change Flow

### Action (`src/actions/user.ts`)

`changePassword(values)` is a server action:

1. Calls `auth()` to get the current session — returns error if unauthenticated.
2. Validates input against `ChangePasswordSchema` (zod).
3. Fetches the user record by `session.user.id`.
4. `bcrypt.compare(currentPassword, user.password)` — wrong password returns early.
5. `bcrypt.hash(newPassword, 10)` — cost factor 10.
6. `db.user.update({ data: { password: hashedPassword } })`.
7. Returns `{ success: "..." }` or `{ error: "..." }`.

### Session Invalidation

There is NO explicit session invalidation after a password change. The existing Auth.js JWT session remains valid until it expires naturally. The JWT callback re-reads `user.role` from the DB on every token refresh, but does not check a password-change timestamp. If you need to invalidate sessions on password change, you would need to either:
- Store a `passwordChangedAt` timestamp on the User model and check it in the JWT callback
- Delete all Session records for the user (only relevant if using the database session strategy)
- Rotate `AUTH_SECRET` (nuclear option, kills everyone)

The repo uses `session: { strategy: 'jwt' }` so sessions are in the cookie, not the DB — the `Session` model exists for the PrismaAdapter but JWTs bypass it.

### ChangePasswordSchema

```ts
ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6),
  confirmPassword: z.string(),
}).refine(data => data.newPassword === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
})
```

### ChangePasswordForm component (`src/components/settings/change-password-form.tsx`)

- Three fields: `currentPassword`, `newPassword`, `confirmPassword` — all `type="password"`.
- Uses `useTransition()` for pending state.
- Shows inline `<FormError>` and `<FormSuccess>` components inside the form (not toast).
- Lives in a shadcn `<Dialog>` triggered from the Settings page (not a separate page).

---

## Avatar / Initials Pattern

The repo does NOT use initials-based avatars. It uses an `ImageUpload` component (`src/components/ui/image-upload.tsx`):

- Wraps a hidden `<input type="file" accept="image/*">`.
- On file select, uses `FileReader.readAsDataURL` to produce a base64 preview.
- Shows a `<Image fill>` (Next.js) inside a 160×160 rounded circle if preview exists, otherwise shows a `<UserCircle>` icon (lucide) as placeholder.
- Upload is handled separately via `/api/avatar/upload` route — the component just produces a preview locally; the parent (`ProfilePage`) calls `updateProfileImage(imageUrl)` server action on `onUploadComplete`.

For initials-based avatar fallback, the pattern used is:
- When `user.image` is null, show `<UserCircle className="w-24 h-24 text-gray-400" />` icon.
- No letter-initial generation exists in this repo. To add one, you'd derive initials from `user.name?.split(' ').map(w => w[0]).join('')` and render in a styled `<div>`.

---

## Settings Page Structure (`src/components/settings/settings-page.tsx`)

Four cards in a `space-y-6` stack:

### 1. Security card
- Two-Factor Authentication row: shows `<Badge>Enabled</Badge>` when active, links to `/auth/2fa-setup` either as "Manage" or "Enable 2FA" button
- Change Password row: opens `<Dialog>` with `<ChangePasswordForm />` inline

### 2. Notifications card
- `emailNotifications` — `<Switch>` with immediate `updateSettings()` on change
- `pushNotifications` — `<Switch>` with immediate `updateSettings()` on change

### 3. Privacy card
- `profileVisibility` — `<Switch>` with immediate `updateSettings()` on change

### 4. Danger Zone card (`border-destructive`)
- Delete Account — `<AlertDialog>` confirm → `deleteAccount()` → `signOut({ callbackUrl: "/" })`

Settings are saved immediately per toggle (no Save button). Uses `useTransition()` for pending state on all switches.

---

## Profile Page Structure (`src/components/profile/profile-page.tsx`)

3-column grid at md breakpoint:

### Left column (1/3): Profile Picture card
- `<ImageUpload>` component
- `onUploadComplete` re-fetches user to update displayed image

### Right column (2/3): Personal Information card
- react-hook-form with zodResolver, fields:
  - `name` (min 2 chars)
  - `username` (3–30 chars, `[a-zA-Z0-9._-]+`, raw SQL for uniqueness check)
  - `email` (email format)
  - `bio` (textarea, max 160 chars)
  - `location` (freeform)
  - `website` (URL or empty string)
- Submit: calls `updateProfile(data)` server action, shows Sonner toast on result

### Below the grid: Account Information card
- Member since (from `emailVerified`)
- Email verified status (green/red text)
- Last login (from latest session record's `expires` field)

---

## Auth.js Configuration (`auth.ts`)

- Providers: Google, GitHub, Credentials
- Credentials: accepts email OR username (`LoginSchema.identifier` field), raw SQL query to handle username lookup
- `signIn` callback: blocks unauthenticated users, checks `emailVerified`, checks 2FA confirmation and deletes it after use (one-time code consumption)
- `jwt` callback: embeds `user.role` in the token from DB lookup on every jwt cycle
- `session` callback: copies `token.sub` → `session.user.id`, `token.role` → `session.user.role`
- Adapter: `PrismaAdapter(db)` with `session: { strategy: 'jwt' }`

---

## Prisma Schema User Model

```prisma
model User {
  id                    String   @id @default(cuid())
  name                  String?
  username              String?  @unique
  email                 String?  @unique
  emailVerified         DateTime?
  image                 String?
  password              String?
  role                  UserRole @default(USER)
  isTwoFactorEnabled    Boolean  @default(false)
  twoFactorSecret       String?
  twoFactorConfirmation TwoFactorConfirmation?
  bio                   String?  @db.Text
  location              String?
  website               String?
  emailNotifications    Boolean  @default(true)
  pushNotifications     Boolean  @default(false)
  profileVisibility     Boolean  @default(true)
}
```

---

## Reuse Notes for unified-frontend

- The `changePassword` action pattern (verify → hash → update) can be lifted verbatim for the unified-frontend user settings (swap Prisma for better-sqlite3 calls).
- The Settings page card layout (Security / Notifications / Privacy / Danger Zone) is a clean pattern adaptable to Next.js shadcn projects.
- The `<ImageUpload>` component approach (FileReader preview + separate upload endpoint) is straightforward to port.
- The `ChangePasswordForm` in a Dialog (not a separate route) is good UX — no page navigation needed.
- Note that this repo targets Postgres + Prisma; unified-frontend uses SQLite + better-sqlite3 directly, so queries need translation.
