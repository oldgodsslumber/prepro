# prepro ticket ingestion (Google Apps Script)

Watches a Gmail inbox for Pega ticket emails and creates a corresponding project in the prepro Firebase RTDB.

## Setup

1. Go to https://script.google.com → **New project**.
2. Replace `Code.gs` with the contents of `ingest-tickets.gs`.
3. **Project Settings → Script Properties**, add:
   - `SENDER` — the From: address that ticket emails come from (e.g. `tickets@pega.example`). Multiple senders: use Gmail search syntax, e.g. `from:a@x.com OR from:b@y.com`.
   - `RTDB_SECRET` — a Firebase legacy database secret. Get one from Firebase Console → ⚙ Project Settings → Service accounts → Database secrets → *Show* (or *Add secret*).
4. **Editor → Run → `ingestTickets`**. Approve the Gmail + external request scopes the first time.
5. **Triggers (clock icon) → Add Trigger**:
   - Function: `ingestTickets`
   - Event source: Time-driven
   - Type: Minutes timer → Every 5 minutes
6. Send a test ticket to the watched mailbox from `SENDER`. Within 5 min, the thread should get the `prepro-imported` label and a new project should appear in prepro.

## How it works

- Searches `from:$SENDER -label:prepro-imported` (max 25 threads per run).
- For each match: parses subject + body, builds a project record, appends to `prepro/state/projects` via REST PUT, labels the thread.
- Skips threads whose `V-NNNNNN` ticket ID already exists in any project's `ticketId`.
- Logs to **Executions** in the Apps Script editor.

## Rotating the database secret

If `RTDB_SECRET` is exposed: revoke it in Firebase Console (Database secrets → trash icon), generate a new one, update the Script Property. The script picks it up on the next run.

## Troubleshooting

- **`SENDER script property not set`**: add it under Script Properties.
- **`HTTP 401`** from RTDB: secret is wrong or revoked.
- **Thread processed but no project**: open Executions, expand the run, read the `Logger.log` lines — the parse step prints why it skipped.
- **Wrong `leadProducer`**: subject must end with `assigned to <Name>`. If Pega ever changes the subject format, update the regex in `parseTicket`.
