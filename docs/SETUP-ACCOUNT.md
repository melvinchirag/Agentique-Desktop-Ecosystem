# ADE account setup

Melvin or Chanuth completes these steps in the Supabase dashboard:

1. Create a new Supabase project named `ade` with the team email.
2. Under **Authentication > Providers > Email**, turn **Confirm email** off and enable email one-time codes. Set the email template to send a six-digit OTP, rather than a confirmation link.
3. Copy the **Project URL** and **anon public key** into `src/main/account/account.config.ts`. Keep the service key out of the app and repository. Until both values are present, account setup is skipped; `ADE_ACCOUNT=off` also disables it.
4. Run `scripts/account-schema.sql` once in the Supabase SQL editor. Check that the three count views are readable only with the service role.
5. Launch ADE with a fresh Windows profile. Enter an email, receive the six-digit code, verify it, and then complete the Backboard step. In Settings > Account, confirm the address and try Sign out; sign-in should return on the next launch.
6. To print counts locally, set `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` in the process environment and run `node scripts/account-counts.mjs`. Keep the service key in the dashboard or a private environment only. The command prints total installs, one-day active users, and seven-day active users.

The account service receives identity and usage timestamps only. Each installation gets a random identifier that remains locally after sign-out so signing in again does not double-count it. Sign out clears `account.json` and stops future heartbeats; the server retains past install rows.
