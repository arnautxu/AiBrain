# WebKit release gate restored — 2026-10-01

David revoked the one-release exception and authorized complete CI for the Arnall repair. WebKit now runs on every candidate and the aggregate rejects skipped, cancelled or failed browser checks. System dependency installation uses the official Ubuntu HTTPS archive with bounded retries and a separate bounded browser download. The earlier exception below is historical and no longer executable.

# Single-release WebKit exception — 2026-10-01

WebKit installation on GitHub runners exhausted the job deadline while downloading Ubuntu system packages, before browser tests or recovery checks ran. The owner authorized omitting WebKit for this XLS release only. WebKit remains **NOT_VERIFIED**, including Safari/iPhone compatibility; a skipped job is not a passing browser test.

The workflow limits the exception to the immediate release child of frozen main `e64b18556ea4d0d6ca57967b9d50cf6e129f18ae`, or its byte-identical merge onto that base. Product files must still equal reviewed revision `9eb3fa6d4183e4aea11fe03a4cc456d65e6ac061`; only the workflow, its contract test and this note may differ. It also expires after 2026-10-01 UTC. A later commit automatically requires WebKit. There is no repository-wide override, new credential, or permanent disabled test.

All remaining tests, Chromium recovery, build, container and real-document gates remain required. Publication and deployment still require the successful main workflow and immutable release identity. Live XLS upload acceptance remains a separate gate.

The workflow contract explicitly checks all four browser/backend commands across the matrix and the separate WebKit job. Its aggregate accepts a skipped WebKit only with the exact scope result, and rejects failures or omissions of every other dependency. The earlier workflow-only integration was not published: its old structural test still expected WebKit in the matrix.

The scope checkout reads full Git history so the approved product revision is available after merge commits; missing history fails closed and never grants an exception. Test execution checkouts and permissions are unchanged.
