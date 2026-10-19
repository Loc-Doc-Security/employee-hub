# Go-live checklist

Everything that must change when the Employee Hub moves from Levi's laptop to production. Work
through it before cutover; add to it whenever something is "fine locally, different in production".

## ⚠️ Secrets

- [ ] **Google service account key → AWS Secrets Manager.** Locally the key is the file
      `google-service-account.json` (git-ignored), pointed to by `GOOGLE_SERVICE_ACCOUNT_FILE` in
      `.env.local`. **Never ship that file to the server.** In production, store the file's contents
      in AWS Secrets Manager (alongside the other OMST secrets) and pass them to the app as
      `GOOGLE_SERVICE_ACCOUNT_JSON`; leave `GOOGLE_SERVICE_ACCOUNT_FILE` unset. The hub already
      reads either. (Later option: Workload Identity Federation, so no key exists at all.)
      If a key is ever exposed, delete it in Google Cloud → Service Accounts → Keys and make a new one.
- [ ] **`FILE_LINK_SECRET`**: a long random value in Secrets Manager. It signs the PDF/video links on
      Resources. Without it, links break whenever the server restarts or runs on more than one machine.
- [ ] **`N8N_INTEGRATION_KEY`**: only if the n8n expense endpoint is kept as a fallback; otherwise leave unset.
- [ ] **Delete the Wix API key** once the final import is done.

## Sign-in and data

- [ ] OMST sign-in on (`HUB_AUTH_ENABLED=1`) and `LAB_DEV_SIMPLE_AUTH` **off**. That also turns off the
      local "View as" picker, which must never work in production.
- [ ] Production Postgres (`PRODUCT_DATABASE_URL`) from Secrets Manager; run the migrations.
- [ ] Final Wix export, then the imports in order: employees → weekly-reports → peer-assessments →
      cleanliness-and-pto → one-on-ones → weekly-meetings → tech-spotlights → driver-scores →
      expense-tracking → shop (with a fresh Loyalty export) → resources.
- [ ] Uploads (photos, Resources PDFs/videos) on S3 instead of the local `uploads/` folder.

## Google and n8n

- [ ] Re-connect the Resources Drive folder and accounting's Sheet in production (Resources → Manage,
      Credit Card → Connect Sheet). Same service account, so the sharing already done carries over.
- [ ] Turn off the retired n8n workflows: Drive → Resources, Driver Scorecard PDF, Expense Tracking.
- [ ] Point the Monday/Tuesday Twilio reminders at the hub instead of Wix.
- [ ] Run the full end-to-end test list (every role × action, allowed and refused, across companies).
