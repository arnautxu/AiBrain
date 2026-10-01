# Single-release WebKit exception — 2026-10-01

WebKit installation on GitHub runners exhausted the job deadline while downloading Ubuntu system packages, before browser tests or recovery checks ran. The owner authorized omitting WebKit for this XLS release only. WebKit remains **NOT_VERIFIED**, including Safari/iPhone compatibility; a skipped job is not a passing browser test.

The workflow limits the exception to the immediate release child of product revision `9eb3fa6d4183e4aea11fe03a4cc456d65e6ac061`, with no changes except the workflow and this note, or its byte-identical merge onto frozen main `ab0809c7cdc2c44502813935f4f364356a71f92f`. It also expires after 2026-10-01 UTC. A later commit automatically requires WebKit. There is no repository-wide override, new credential, or permanent disabled test.

All remaining tests, Chromium recovery, build, container and real-document gates remain required. Publication and deployment still require the successful main workflow and immutable release identity. Live XLS upload acceptance remains a separate gate.
