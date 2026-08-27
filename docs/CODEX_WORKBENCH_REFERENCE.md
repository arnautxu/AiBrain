# AiBrain Codex workbench reference brief

## Outcome

- User-visible result: a Codex-powered workbench with a fully owned shell, real threads, streamed agent activity, plans, diffs, stops, and explicit command/file approvals.
- Explicit non-goals for V1: billing, native app, voice, video and scheduled automations.
- No external RAG platform is required by the architecture.

## Evidence

| Source | Authority | Constraints it establishes | Gaps |
| --- | --- | --- | --- |
| User direction, 25 Aug 2026 | Authoritative | Own the product surface; match the quality of Codex; make it replicable and fully customizable; remove the previous RAG dependency | Final brand and tenant model remain open |
| Official Codex App Server documentation | Authoritative protocol reference | Use App Server for rich clients, auth, history, approvals and streamed events; generate schemas from the pinned binary | The protocol changes with Codex versions |
| Generated App Server schema from the installed Codex binary | Authoritative local contract | Stable method names and payloads for threads, turns, plans, diffs, activity, and approvals | Experimental fields must not become required product contracts |
| Existing AiBrain implementation | Strong evidence | Next.js shell, NDJSON streaming, durable project threads, stop behavior, and an isolated runtime workspace already work | Review history, files, terminal and worktrees remain future surfaces |
| Codex desktop interaction model | Strong visual and behavioral reference | Quiet hierarchy, thread-first navigation, compact tool activity, a persistent composer, and contextual inspection | We do not copy private assets or depend on undocumented desktop internals |

## Invariants

- Codex remains the agent runtime; the UI does not imitate agent behavior with fabricated states.
- The browser never receives Codex credentials or direct access to App Server.
- App Server runs in a persistent per-employee worker; an authenticated private WebSocket adapter carries the versioned protocol to Next.js and the web client sees only AiBrain's application contract.
- Approvals are always explicit and remain pending until the user accepts or declines them.
- The default Codex workspace is dedicated to the runtime, not the AiBrain source tree.
- Product customization is configuration-driven and does not require tenant forks.
- The UI works in demo mode without implying a real Codex connection.

## States and boundaries

- Inputs: user text, AiBrain project/thread IDs, display preferences, and approval decisions.
- Outputs: response deltas, activity updates, plan updates, diff updates, approval requests, completion, and errors. Runtime IDs never cross the server boundary.
- Required UI states: empty, checking runtime, demo, streaming, waiting for approval, stopped, failed, and complete.
- Responsive target: full workbench at desktop widths; drawer navigation and inspector on mobile.
- External boundary: the installed and version-pinned Codex binary plus the user's own Codex authentication.

## Dependency graph

| Node | Depends on | Proof |
| --- | --- | --- |
| Typed workbench contract | Generated App Server schema | Typecheck and boundary parser checks |
| Codex runtime adapter | Typed contract, private WebSocket and user worker | Real local turn streams with Codex as the only required engine |
| Approval route | Runtime approval registry | A pending App Server request resolves after a user decision |
| Workbench state | Stream contract and tenant repository | Demo and real events produce the same visible states and reload durable messages |
| Workbench UI | Workbench state and design tokens | Browser verification at desktop and mobile widths |
| Installation boundary | Signed local session, versioned installation config and runtime roots | Cross-installation API and browser checks |

## Reference slice

- Smallest end-to-end path: open AiBrain, observe the runtime state, start or resume a Codex thread, stream plan/activity/answer events, stop the turn, and resolve a command or file approval when requested.
- Main risk: preserving App Server's bidirectional semantics through a web route without exposing the runtime to the browser.
- Acceptance check: a local Codex turn completes with no external knowledge service; demo mode exercises the same visual activity contract; typecheck and production build pass.

## Unknowns and deferrals

- Filesystem provisioning of employee-specific `CODEX_HOME` roots is implemented; the first real Codex login still requires a dedicated subscription and human authentication in isolated QA.
- Company context and explicit memory are file-backed. Future external knowledge sources may use reviewed plugins or MCP servers, never a hard-coded provider or product Postgres.
- Native desktop packaging is outside V1; the workbench contract remains independent of a native shell.
