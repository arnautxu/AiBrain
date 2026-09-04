# Help and feedback requests

Authenticated local employees can submit `Bug`, `Request`, or `Ayuda` from the
account menu. The server validates a bounded description and safe context,
persists the record first under that employee's private user root, and then
attempts an optional notification. Provider failure never rolls back or
duplicates the durable request.

Safe context contains only pathname (no query or fragment), project/thread UUIDs
and mobile/desktop viewport. Chat content, files, cookies, tokens, URL parameters
and browser diagnostics are not collected.

Configure one of:

- `AIBRAIN_SUPPORT_WEBHOOK_URL`: HTTPS JSON endpoint; or
- `AIBRAIN_SUPPORT_TELEGRAM_BOT_TOKEN` plus
  `AIBRAIN_SUPPORT_TELEGRAM_CHAT_ID`.

The webhook takes precedence when both are present. Secrets belong in the host
secret manager. Submission is limited to ten requests per employee per hour.
