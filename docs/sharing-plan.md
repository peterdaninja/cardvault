# SLOWTCG: sign-in, cloud backup and read-only sharing — plan

Status: **proposal, waiting for approval.** Nothing in the app changes until you say go.

## In one paragraph

Your phone stays the master copy. If you choose to sign in, the app keeps a *mirror* of your vault in the cloud. You can then invite people (by email or by a link); they sign in and see your vault in the same app, **view-only**. The database itself refuses any change from anyone but you, so even a tampered app could not edit your vault. If you never sign in, the app behaves exactly as it does today and nothing leaves the phone.

## Backend choice (two lines)

**Supabase.** It is Postgres with "row-level security" built in (the database enforces who may read or write each row, which is exactly the viewer-can't-edit rule), it has email / Apple / Google sign-in, a free tier, and it works from a static site like GitHub Pages.
Firebase would also work but its security rules are a separate language, and its data is harder to export/delete cleanly — worse fit for a possible App Store release.

## What gets stored in the cloud

Only what is already in your backup file: collections, cards you own (name, set, number, rarity, image link, price, quantity), and the value-history points. No photos from the camera, no scan data, no settings.

### Tables (all have row-level security switched on)

| Table | Columns | Purpose |
|---|---|---|
| `collections` | `id`, `owner_id`, `data` (JSON), `updated_at`, `deleted` | one row per collection |
| `cards` | `id`, `owner_id`, `collection_id`, `data` (JSON), `updated_at`, `deleted` | one row per owned card |
| `snapshots` | `owner_id`, `t`, `value`, `count` | value-history points |
| `shares` | `id`, `owner_id`, `viewer_email` (nullable), `viewer_id` (nullable), `token` (random, for links), `role` (always `viewer`), `created_at`, `revoked` | who may look at whose vault |

`data` holds the same JSON the app already uses, so the cloud shape can't drift from the phone's.
Deleted items are kept as `deleted = true` for a while so a second device learns about the deletion; they are purged later.

## Security rules (enforced by the database, not the app)

1. **Write**: on `collections`, `cards`, `snapshots` only `owner_id = auth.uid()` may insert, update or delete. There is no viewer write policy at all, so viewers are refused by default.
2. **Read**: you may read your own rows. Someone else may read rows only if a non-revoked `shares` row exists with `owner_id` = that row's owner and `viewer_id = auth.uid()` (or `viewer_email` equal to their verified sign-in email).
3. **Shares**: only the owner can create, list or revoke their shares. A viewer can see only the shares addressed to them. Link invites are redeemed through one small database function (`accept_invite(token)`) that attaches the signed-in person as the viewer; the token is long and random and can be revoked.
4. `role` is fixed to `viewer`; there is no "editor" in this version.
5. **Delete account**: one function removes all your rows and shares and then your sign-in account (needed for App Store rules).

The SQL for all of this will live in `supabase/schema.sql`; you paste it into Supabase once.

## Sync strategy

- The phone keeps working from IndexedDB exactly as now. Sync is a background extra.
- Every collection/card row carries `updated_at`. After a change (and on app start / when coming back online) the app pushes rows changed since the last successful sync, in batches, and sends deletions as `deleted = true`.
- **Last write wins.** Only you write, so there are no real conflicts. If you use two devices, the newer `updated_at` wins per row. First sign-in on a new device: you choose "restore from cloud" or "upload this phone"; it never silently merges or overwrites.
- Failures (offline, server error) are just retried later; the app never blocks on the network.
- Viewers download the owner's rows read-only into memory (not into their own vault) and see them in the normal Home/Collection screens with all edit buttons hidden. The Share screen lists who can see your vault and lets you revoke.
- Card images stay as links to the public card-image sites; we don't upload images.

## What you must do by hand (I can't and won't do these, and never need your passwords)

1. Create a free project at supabase.com (sign in with your own account).
2. In *SQL Editor*, paste and run `supabase/schema.sql` (I will write it).
3. In *Authentication → Providers*, enable Email (and later Apple / Google, which need their own developer setup; email alone is enough to start).
4. In *Authentication → URL Configuration*, set the site URL to `https://peterdaninja.github.io/cardvault/`.
5. In *Project Settings → API* copy the **Project URL** and the **anon (public) key** into a local file `.env` (`VITE_SUPABASE_URL=…`, `VITE_SUPABASE_ANON_KEY=…`), and add the same two as GitHub repo *Actions variables* so the deployed site has them. `.env` is git-ignored.
6. **Never** put the `service_role` key anywhere in this app or repo. The anon key is public by design; safety comes from the row-level rules above.

Until step 1–5 are done, the app shows no sign-in option, because it has no server to talk to.

## Privacy change

- Today the app says nothing leaves the phone. That stays true **by default**. The Settings text will change to: "Nothing leaves your phone unless you sign in. If you do, a copy of your collection (cards, quantities, prices, value history) is stored on our server so you can back up and share it."
- Sharing is opt-in twice: you sign in, and then you separately invite each person. Invitees see only what you share; you can revoke at any time, and sign-out / delete-account is in Settings. Deleting the account erases the cloud copy; the phone copy is untouched.
- Collected data: email address (sign-in), your vault. No analytics, no ads. A short privacy policy page will be needed before an App Store release; I'll draft it.

## Build order after approval

1. `supabase/schema.sql` + `.env.example`.
2. `src/lib/sync.ts` (client + sign-in), `syncPush.ts` / `syncPull.ts` (mirror logic), small `@supabase/supabase-js` dependency.
3. Settings: "Account & sharing" section (sign in, sign out, delete cloud data/account).
4. `src/screens/Share.tsx`: invite by email or link, list/revoke viewers; "Shared with me" list.
5. Read-only mode for Home/CollectionView (a `readOnly` prop that hides add/edit/delete).
6. Minimal wiring in `App.tsx`.

## Honest limits

I can write and type-check all of it, but I can't create your Supabase project, so sign-in, sync and the security rules will be **untested against a real server** until you do the steps above. I will say clearly what has and hasn't been exercised.

## Decisions I need from you

- OK to use Supabase? (Recommended.)
- Email-only sign-in first, adding Apple/Google later? (Recommended; Apple sign-in becomes mandatory only if you add Google and ship to the App Store.)
- Invite by email *and* link, or just link to begin with? (Plan above does both.)
