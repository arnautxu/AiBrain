# Per-user worker runtime boundary

This directory owns durable provisioning and process-local lifecycle for one hot
worker per employee. A canonical user UUID maps to a versioned `worker.json`
manifest and private roots below `InstallationConfig.paths.usersRoot`.

The launch context deliberately contains no `publishWriteRoot`. It gives the
runtime read-only company/source mounts, private worker write mounts, and a
separate browser profile/download pair. The concrete process or container
factory must enforce those mount modes; this registry does not spawn processes
or change host mount permissions itself.

`WorkerRuntimeRegistry` has only instance-local handlers and ownership maps. It
deduplicates concurrent starts for a user, bounds concurrent/pending starts,
and refuses a runtime or transport object ever returned for another start.
Durable roots survive a Node restart; the injected factory is responsible for
reattaching or starting the pinned Codex App Server and browser services.

Before reusing a cached handle, the registry checks its controller generation.
A confirmed `failed` or `stopped` controller is retired and replaced for that
employee only, after both process and transport cleanup succeed. Concurrent
requests join the same recovery; explicit stop, close and maintenance fencing
prevent a replacement from starting. Transient transport reconnects, nonterminal
degradation and unavailable health checks never justify replacing an active
generation. Cleanup failure retains ownership until explicit cleanup succeeds.
Recovery reuses the employee's durable roots and journals; it does not replay
accepted RPCs or approve a pending connector effect. Local regression includes
a killed child process with another employee still active. Publication,
installation rollout and authenticated live acceptance are separate gates.

Security boundaries:

- User IDs are canonical lowercase UUIDs; worker-owned relative paths reject
  traversal, backslashes, control characters, and existing symlink components.
- Provisioned directories are real directories with mode `0700`; manifests are
  regular files with mode `0600`.
- Provisioning is locked and idempotent. A changed/corrupt manifest fails closed.
- The worker and browser receive different writable mount lists.
- Backpressure is technical capacity protection, not a user or commercial quota.

Known boundary: filesystem checks prevent persistent symlink substitution at
provision/resolve time, but the launcher must keep the directories private and
use OS/container isolation to prevent a malicious same-host process from racing
path use after validation.
