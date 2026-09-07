# Installation interface language

Each company has a durable interface preference, independent of browser language
and company context. Missing preference means English. Workspace owners and
administrators can select English or Spanish in Administration. Changing it
refreshes the current interface; other sessions receive the preference on their
next page load. No existing installation is silently switched to Spanish.

The public root layout reads the preference before rendering sign-in and the
application and provides the same locale to client components. The document lang
attribute, interface copy, built-in editable templates and UI date formatting use
that locale. Customer names, messages, saved templates, document text and tool
output retain their original content. Translation values are inserted as opaque
text, never markup or recursively translated content.

PATCH /api/admin/language checks origin, authentication, exact installation and
workspace admin role before accepting a strict one-field language command.
settings/language.json is installation-bound, schema-validated, bounded, privately
written and atomically replaced under a lock; updatedBy records the authenticated
actor. Linked directories and foreign/corrupt records fail closed. It contains
no credentials and is included in the installation's existing data backup.

Historical component and browser behavior fixtures now explicitly choose Spanish.
Their expected language does not define the product default. Dedicated locale
coverage checks the English default, Spanish refresh/server rendering, preserved
customer text, built-in prompts, admin permissions, corrupt/foreign records and
restart persistence. CI, deployment and authenticated browser acceptance remain
separate release gates.
