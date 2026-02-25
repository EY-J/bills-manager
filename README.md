# Pocket Ledger (Bills Manager)

Pocket Ledger is an offline-first bills tracker built with React + Vite.
It is optimized for mobile app-like use, while still working well on desktop.

## Core features

- Track bills with recurring cadence:
  - monthly
  - bi-weekly
  - weekly
- Mark bills as paid and auto-advance due dates by cadence.
- Add/edit/delete payment history entries.
- Dynamic status states (Paid, Upcoming, Overdue, Due soon window).
- Backup and restore data (JSON) with integrity validation.
- Undo support for important actions.
- Settings for notification mode, compact mode, and table density.
- Optional account login (email/password) with email-code verification and auto-sync across devices.
- Installable as a PWA on supported mobile browsers.

## Tech stack

- React 19
- Vite 7
- Playwright (responsive smoke testing)
- Vercel (deployment target)

## Local development

1. Install dependencies:
   `npm install`
2. Start dev server:
   `npm run dev`
3. Open the URL shown in terminal.

## Environment variables

Use `.env.example` as reference.

- `VITE_APP_VERSION`
  - Example: `1.0.0`
  - Shown in Settings for support/debug identification.
- `VITE_ERROR_REPORT_ENDPOINT` (optional)
  - Recommended on Vercel: `/api/runtime-errors`
  - If empty, runtime errors are stored locally only.
- `KV_REST_API_URL` and `KV_REST_API_TOKEN`
  - Required in Vercel production for account sync storage.
- `AUTH_SESSION_SECRET`
  - Required in Vercel production for secure login session cookies.
- `RESEND_API_KEY` and `ACCOUNT_EMAIL_FROM`
  - Required in Vercel production for email verification code delivery.
- `AUTH_VERIFICATION_SECRET` (optional)
  - Separate hashing secret for signup verification codes.

## Runtime monitoring

The app captures:
- uncaught runtime errors
- unhandled promise rejections
- React error boundary crashes

Behavior:
- Stores recent errors locally (`bills_runtime_errors_v1`)
- Optionally posts errors to `VITE_ERROR_REPORT_ENDPOINT`

Included serverless endpoint:
- `api/runtime-errors.js` (Vercel function)
- Works with strict CSP `connect-src 'self'`

## Data storage and privacy

- App data is stored locally in browser/device storage by default.
- If user signs in, bills are synced to remote storage using account session cookies.
- Backup/Restore still works for manual portability.

## Testing and quality checks

Run before deployment:

- Lint:
  `npm run lint`
- Unit tests:
  `npm run test`
- Production build:
  `npm run build`

Responsive smoke test:

1. Install Playwright browser once:
   `npm run test:responsive:install`
2. Run responsive checks:
   `npm run test:responsive`
3. Faster rerun (skip build):
   - Windows PowerShell: `$env:SKIP_BUILD='1'; npm run test:responsive`
   - macOS/Linux: `SKIP_BUILD=1 npm run test:responsive`

The responsive suite checks:
- no horizontal overflow
- modal width fit (settings/details/editor)
- settings toggles
- key flows (mark paid, add payment, edit, undo)

Critical flow E2E (deployed/local):

- Run locally against preview:
  `npm run test:e2e:critical`
- Run against deployed URL:
  - Windows PowerShell: `$env:E2E_BASE_URL='https://your-preview-url.vercel.app'; npm run test:e2e:critical`
  - macOS/Linux: `E2E_BASE_URL=https://your-preview-url.vercel.app npm run test:e2e:critical`

Critical flow checks include:
- create bill
- mark paid
- edit payment
- backup + restore
- clear all + undo

## Deploy to Vercel

1. Import this repo into Vercel.
2. Set environment variables in:
   `Project -> Settings -> Environment Variables`
   - `VITE_APP_VERSION`
   - `VITE_ERROR_REPORT_ENDPOINT` (optional, recommended: `/api/runtime-errors`)
   - `KV_REST_API_URL`
   - `KV_REST_API_TOKEN`
   - `AUTH_SESSION_SECRET`
   - `RESEND_API_KEY`
   - `ACCOUNT_EMAIL_FROM`
3. Deploy.

Security headers are configured in `vercel.json`, including:
- CSP
- HSTS
- X-Frame-Options
- X-Content-Type-Options
- COOP/CORP

If you use an external monitoring endpoint (not `/api/runtime-errors`):
- add that domain to CSP `connect-src` in `vercel.json`

## Mobile validation checklist

Before releasing:

1. Install app:
   - Android Chrome: menu -> Install app
   - iPhone Safari: Share -> Add to Home Screen
2. Add one test bill and one payment.
3. Close/reopen app and verify data persists.
4. Turn on airplane mode and reopen app; verify data still loads.
5. Run Backup data, then Restore data, and verify records match.
