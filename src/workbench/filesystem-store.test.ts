import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@/lib/chat-contract";
import { StorageCorruptionError } from "@/storage";
import {
  WorkbenchConflictError,
  WorkbenchNotFoundError,
  WorkbenchPersistenceError,
  WorkbenchValidationError,
} from "@/workbench/errors";
import { FileWorkbenchStore } from "@/workbench/filesystem-store";
import {
  parseWorkbenchListQuery,
  STANDALONE_PROJECT_SLUG,
  type WorkbenchListQuery,
} from "@/workbench/types";

const INSTALLATION_ID = "synthetic-lab";
const USER_A = "0198b9f0-6631-7000-8000-000000000101";
const USER_B = "0198b9f0-6631-7000-8000-000000000102";
const roots: string[] = [];
const ACTIVE_QUERY: WorkbenchListQuery = { status: "active", limit: 20 };

vi.mock("server-only", () => ({}));

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "aibrain-workbench-"));
  roots.push(root);
  const usersRoot = path.join(root, "users");
  await mkdir(path.join(usersRoot, USER_A), { recursive: true, mode: 0o700 });
  await mkdir(path.join(usersRoot, USER_B), { recursive: true, mode: 0o700 });
  return {
    root,
    usersRoot,
    store: new FileWorkbenchStore({ installationId: INSTALLATION_ID, usersRoot }),
  };
}

function message(role: ChatMessage["role"], status: ChatMessage["status"]): ChatMessage {
  return {
    id: randomUUID(),
    role,
    content: role === "user" ? "Synthetic request" : "",
    createdAt: new Date().toISOString(),
    status,
    activity: [],
    plan: [],
    approvals: [],
    diff: "",
    attachments: [],
    artifacts: [],
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("FileWorkbenchStore", () => {
  it("persists project instructions, sources, memory and local sharing in runtime context", async () => {
    const { usersRoot, store } = await fixture();
    const project = await store.createProject(USER_A, "Company handbook");
    const sourceId = randomUUID();
    const memberId = randomUUID();
    const updatedAt = new Date().toISOString();
    await store.updateProject(USER_A, project.id, {
      instructions: "Responde en español y cita las fuentes del proyecto.",
      sources: [{
        id: sourceId,
        kind: "note",
        name: "Política comercial",
        url: null,
        mimeType: "text/plain",
        size: 26,
        excerpt: "Descuento máximo autorizado: 10%.",
        status: "ready",
        createdAt: updatedAt,
      }],
      memory: { enabled: true, notes: "El cliente prefiere entregas los viernes.", updatedAt },
      sharing: {
        visibility: "shared",
        members: [{
          id: memberId,
          email: "ana@example.com",
          name: null,
          role: "editor",
          status: "invited-local",
          addedAt: updatedAt,
        }],
      },
    });

    const restarted = new FileWorkbenchStore({ installationId: INSTALLATION_ID, usersRoot });
    await expect(restarted.getProjectRuntimeContext(USER_A, project.id)).resolves.toMatchObject({
      projectInstructions: "Responde en español y cita las fuentes del proyecto.",
      projectMemory: "El cliente prefiere entregas los viernes.",
      projectSources: [{ name: "Política comercial", status: "ready" }],
    });
    await expect(restarted.getProject(USER_A, project.id)).resolves.toMatchObject({
      sharing: { visibility: "shared", members: [{ email: "ana@example.com", role: "editor" }] },
    });
  });

  it("treats an identical retried turn as idempotent and rejects divergent reuse", async () => {
    const { store } = await fixture();
    const project = await store.createProject(USER_A, "Retry project");
    const thread = await store.createThread(USER_A, project.id, "Retry thread");
    const userMessage = message("user", "complete");
    const assistantMessage = message("assistant", "streaming");
    await expect(store.beginThreadTurn(USER_A, thread.id, userMessage, assistantMessage))
      .resolves.toMatchObject({ outcome: "created" });
    await expect(store.beginThreadTurn(
      USER_A,
      thread.id,
      { ...userMessage, createdAt: new Date(Date.now() + 1_000).toISOString() },
      { ...assistantMessage, createdAt: new Date(Date.now() + 1_001).toISOString() },
    )).resolves.toMatchObject({ outcome: "existing", assistantMessage: { id: assistantMessage.id } });
    await expect(store.beginThreadTurn(
      USER_A,
      thread.id,
      { ...userMessage, content: "Different payload" },
      assistantMessage,
    )).rejects.toBeInstanceOf(WorkbenchConflictError);
    await expect(store.beginThreadTurn(
      USER_A,
      thread.id,
      message("user", "complete"),
      message("assistant", "streaming"),
    )).rejects.toBeInstanceOf(WorkbenchConflictError);
  });

  it("persists approval fingerprints produced by projected runtime events", async () => {
    const { usersRoot, store } = await fixture();
    const project = await store.createProject(USER_A, "Approval project");
    const thread = await store.createThread(USER_A, project.id, "Approval thread");
    const userMessage = message("user", "complete");
    const assistantMessage: ChatMessage = {
      ...message("assistant", "streaming"),
      artifacts: [{
        id: randomUUID(),
        type: "browser",
        name: "Private browser",
        status: "ready",
        control: "agent",
        viewerUrl: null,
        captureUrl: null,
        downloadUrl: null,
        error: null,
      }],
      approvals: [{
        id: "approval-1",
        threadId: "runtime-thread-1",
        turnId: "runtime-turn-1",
        itemId: "runtime-item-1",
        kind: "browser",
        title: "Open page",
        detail: "Open an external page in the isolated browser.",
        permissionFingerprint: "a".repeat(64),
        status: "accepted",
      }],
    };

    await store.beginThreadTurn(USER_A, thread.id, userMessage, assistantMessage);
    const restarted = new FileWorkbenchStore({ installationId: INSTALLATION_ID, usersRoot });
    await expect(restarted.load(USER_A)).resolves.toMatchObject({
      threads: [expect.objectContaining({
        id: thread.id,
        messages: [userMessage, assistantMessage],
      })],
    });
  });

  it("creates durable conversation branches with exact lineage and complete prior context", async () => {
    const { usersRoot, store } = await fixture();
    const project = await store.createProject(USER_A, "Branch project");
    const parent = await store.createThread(USER_A, project.id, "Original conversation");
    const firstUser = { ...message("user", "complete"), content: "First request" };
    const longResult = `${"A".repeat(13_500)}-END-OF-FULL-RESULT`;
    const firstAssistant = { ...message("assistant", "complete"), content: longResult };
    const secondUser = { ...message("user", "complete"), content: "Second request" };
    const secondAssistant = { ...message("assistant", "complete"), content: "Second result" };
    await store.beginThreadTurn(USER_A, parent.id, firstUser, firstAssistant);
    await store.beginThreadTurn(USER_A, parent.id, secondUser, secondAssistant);

    const edited = await store.branchThread(USER_A, parent.id, {
      kind: "edit", messageId: secondUser.id, editedContent: "Edited second request",
    });
    expect(edited).toMatchObject({
      draftMessage: "Edited second request",
      thread: {
        lineage: { parentThreadId: parent.id, branchedFromMessageId: secondUser.id, kind: "edit" },
        messages: [{ id: firstUser.id }, { id: firstAssistant.id }],
      },
    });
    const context = await store.getThreadRuntimeContext(USER_A, edited.thread.id);
    expect(context.branchHistory).toContain("-END-OF-FULL-RESULT");
    expect(context.branchHistory?.length).toBeGreaterThan(13_500);

    const retried = await store.branchThread(USER_A, parent.id, {
      kind: "retry", messageId: secondAssistant.id,
    });
    expect(retried.draftMessage).toBe("Second request");
    expect(retried.thread.messages.map((item) => item.id)).toEqual([firstUser.id, firstAssistant.id]);

    const continued = await store.branchThread(USER_A, parent.id, {
      kind: "branch", messageId: firstAssistant.id,
    });
    expect(continued.draftMessage).toBeNull();
    expect(continued.thread.messages.map((item) => item.id)).toEqual([firstUser.id, firstAssistant.id]);
    expect((await store.getThread(USER_A, parent.id)).messages).toHaveLength(4);

    const restarted = new FileWorkbenchStore({ installationId: INSTALLATION_ID, usersRoot });
    await expect(restarted.getThread(USER_A, edited.thread.id)).resolves.toMatchObject({
      lineage: { parentThreadId: parent.id, branchedFromMessageId: secondUser.id, kind: "edit" },
    });
    await expect(restarted.getThread(USER_B, edited.thread.id)).rejects.toBeInstanceOf(WorkbenchNotFoundError);
  });

  it("provisions the hidden standalone-chat workspace and persists projects, threads, turns, activity and runtime token across restart", async () => {
    const { usersRoot, store } = await fixture();
    const initial = await store.load(USER_A);
    expect(initial).toMatchObject({ persistence: "filesystem", threads: [] });
    expect(initial.projects).toEqual([
      expect.objectContaining({ name: "Conversaciones", slug: STANDALONE_PROJECT_SLUG }),
    ]);
    await expect(store.listProjects(USER_A, ACTIVE_QUERY)).resolves.toMatchObject({ items: [] });

    const project = await store.createProject(USER_A, "Client Operations");
    const thread = await store.createThread(USER_A, project.id, "First delivery");
    const userMessage = message("user", "complete");
    const assistantMessage = message("assistant", "streaming");
    await store.beginThreadTurn(USER_A, thread.id, userMessage, assistantMessage);
    const activity = {
      id: randomUUID(),
      kind: "tool" as const,
      label: "Checked source",
      status: "complete" as const,
    };
    await store.updateMessageActivity(USER_A, thread.id, assistantMessage.id, activity);
    await store.finishThreadTurn(
      USER_A,
      thread.id,
      {
        ...assistantMessage,
        content: "Synthetic result",
        status: "complete",
        activity: [activity],
      },
      "runtime-thread-synthetic-001",
    );
    await store.updateProject(USER_A, project.id, { name: "Client Ops", pinned: true, status: "archived" });
    expect((await store.load(USER_A)).projects.find((item) => item.id === project.id)?.status).toBe("archived");
    await store.updateProject(USER_A, project.id, { status: "active" });
    await store.updateThread(USER_A, thread.id, { title: "Delivered", pinned: true, status: "archived" });

    const restarted = new FileWorkbenchStore({ installationId: INSTALLATION_ID, usersRoot });
    const snapshot = await restarted.load(USER_A);
    expect(snapshot.projects).toEqual(expect.arrayContaining([
      expect.objectContaining({ slug: STANDALONE_PROJECT_SLUG }),
      expect.objectContaining({ id: project.id, name: "Client Ops", pinned: true }),
    ]));
    expect(snapshot.threads).toEqual([
      expect.objectContaining({
        id: thread.id,
        title: "Delivered",
        status: "archived",
        pinned: true,
        messages: [userMessage, expect.objectContaining({ content: "Synthetic result" })],
      }),
    ]);
    expect(JSON.stringify(snapshot)).not.toContain("runtime-thread-synthetic-001");
    await restarted.updateThread(USER_A, thread.id, { status: "active" });
    await expect(restarted.getThreadRuntimeContext(USER_A, thread.id)).resolves.toMatchObject({
      projectId: project.id,
      runtimeThreadToken: "runtime-thread-synthetic-001",
    });
  });

  it("keeps two users isolated even when ids, names and operations are supplied across boundaries", async () => {
    const { store } = await fixture();
    const projectA = await store.createProject(USER_A, "Shared name");
    const projectB = await store.createProject(USER_B, "Shared name");
    const threadB = await store.createThread(USER_B, projectB.id, "Private B");

    await expect(store.updateProject(USER_A, projectB.id, { name: "stolen" }))
      .rejects.toBeInstanceOf(WorkbenchNotFoundError);
    await expect(store.getThreadRuntimeContext(USER_A, threadB.id))
      .rejects.toBeInstanceOf(WorkbenchNotFoundError);
    await expect(store.getProject(USER_A, projectB.id))
      .rejects.toBeInstanceOf(WorkbenchNotFoundError);
    await expect(store.getThread(USER_A, threadB.id))
      .rejects.toBeInstanceOf(WorkbenchNotFoundError);
    await expect(store.listThreads(USER_A, projectB.id, ACTIVE_QUERY))
      .rejects.toBeInstanceOf(WorkbenchNotFoundError);
    expect((await store.load(USER_A)).projects).toEqual(expect.arrayContaining([
      expect.objectContaining({ slug: STANDALONE_PROJECT_SLUG }),
      expect.objectContaining({ id: projectA.id }),
    ]));
    expect((await store.load(USER_A)).threads).toEqual([]);
    expect((await store.load(USER_B)).projects).toEqual(expect.arrayContaining([
      expect.objectContaining({ slug: STANDALONE_PROJECT_SLUG }),
      expect.objectContaining({ id: projectB.id }),
    ]));
    expect((await store.load(USER_B)).threads).toEqual([expect.objectContaining({ id: threadB.id })]);
  });

  it("serializes concurrent mutations across independent store instances", async () => {
    const { usersRoot } = await fixture();
    const stores = Array.from({ length: 4 }, () =>
      new FileWorkbenchStore({ installationId: INSTALLATION_ID, usersRoot }));
    const projects = await Promise.all(Array.from({ length: 32 }, (_, index) =>
      stores[index % stores.length].createProject(USER_A, "Concurrent project")));

    expect(new Set(projects.map((project) => project.id))).toHaveLength(32);
    expect(new Set(projects.map((project) => project.slug))).toHaveLength(32);
    const snapshot = await stores[0].load(USER_A);
    expect(snapshot.projects).toHaveLength(33);
    const raw = JSON.parse(await readFile(
      path.join(usersRoot, USER_A, "state", "workbench.json"),
      "utf8",
    )) as { revision: number };
    expect(raw.revision).toBe(33);
  });

  it("fails closed on foreign, corrupt and symbolic-link state instead of reseeding", async () => {
    const { root, usersRoot, store } = await fixture();
    await store.load(USER_A);
    await store.load(USER_B);
    const statePath = path.join(usersRoot, USER_A, "state", "workbench.json");
    const foreignState = await readFile(
      path.join(usersRoot, USER_B, "state", "workbench.json"),
      "utf8",
    );
    await writeFile(statePath, foreignState, "utf8");
    await expect(store.load(USER_A)).rejects.toBeInstanceOf(WorkbenchPersistenceError);

    await writeFile(statePath, "{not-json}\n", "utf8");
    await expect(store.load(USER_A)).rejects.toBeInstanceOf(StorageCorruptionError);

    await rm(path.join(usersRoot, USER_A, "state"), { recursive: true, force: true });
    const outside = path.join(root, "outside");
    await mkdir(outside);
    await symlink(outside, path.join(usersRoot, USER_A, "state"));
    await expect(store.load(USER_A)).rejects.toBeInstanceOf(WorkbenchPersistenceError);
  });

  it("rejects unprovisioned and non-canonical user roots", async () => {
    const { store } = await fixture();
    await expect(store.load("../../escape")).rejects.toBeInstanceOf(WorkbenchNotFoundError);
    await expect(store.load("0198B9F0-6631-7000-8000-000000000101"))
      .rejects.toBeInstanceOf(WorkbenchNotFoundError);
    await expect(store.load("0198b9f0-6631-7000-8000-000000000999"))
      .rejects.toBeInstanceOf(WorkbenchNotFoundError);
  });

  it("lists and searches projects with bounded opaque keyset pagination", async () => {
    const { store } = await fixture();
    const alpha = await store.createProject(USER_A, "Alpha Operations");
    const beta = await store.createProject(USER_A, "Beta Finance");
    const gamma = await store.createProject(USER_A, "Gamma Delivery");
    await store.updateProject(USER_A, gamma.id, { pinned: true });
    await store.updateProject(USER_A, beta.id, { status: "archived" });

    const first = await store.listProjects(USER_A, { status: "active", limit: 1 });
    expect(first.items).toEqual([expect.objectContaining({ id: gamma.id, pinned: true })]);
    expect(first.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/);
    const second = await store.listProjects(USER_A, {
      status: "active",
      limit: 1,
      cursor: first.nextCursor!,
    });
    expect(second.items).toEqual([expect.objectContaining({ id: alpha.id })]);
    expect(second.nextCursor).toBeNull();

    await expect(store.listProjects(USER_A, {
      status: "archived",
      limit: 1,
      cursor: first.nextCursor!,
    })).rejects.toBeInstanceOf(WorkbenchValidationError);
    await expect(store.listProjects(USER_A, { status: "active", limit: 51 }))
      .rejects.toBeInstanceOf(WorkbenchValidationError);
    await expect(store.listProjects(USER_A, { status: "active", limit: 20, cursor: "not-a-cursor" }))
      .rejects.toBeInstanceOf(WorkbenchValidationError);

    expect((await store.listProjects(USER_A, {
      status: "all",
      limit: 20,
      query: "FINANCE",
    })).items).toEqual([expect.objectContaining({ id: beta.id, status: "archived" })]);
  });

  it("returns thread summaries for lists, full history only on read, and supports lifecycle transitions", async () => {
    const { store } = await fixture();
    const project = await store.createProject(USER_A, "Lifecycle Project");
    const thread = await store.createThread(USER_A, project.id, "Quarterly planning");
    const userMessage = message("user", "complete");
    const assistantMessage = message("assistant", "complete");
    await store.beginThreadTurn(USER_A, thread.id, userMessage, assistantMessage);

    const page = await store.listThreads(USER_A, project.id, {
      status: "active",
      limit: 20,
      query: "PLANNING",
    });
    expect(page).toEqual({
      items: [expect.objectContaining({
        id: thread.id,
        messageCount: 2,
        lastMessageAt: assistantMessage.createdAt,
      })],
      nextCursor: null,
    });
    expect(page.items[0]).not.toHaveProperty("messages");
    expect((await store.getThread(USER_A, thread.id)).messages).toEqual([userMessage, assistantMessage]);

    const renamed = await store.updateProject(USER_A, project.id, { name: "Renamed Project", pinned: true });
    expect(renamed).toMatchObject({ name: "Renamed Project", pinned: true });
    expect(renamed.workspace.label).toBe("Renamed Project");
    expect(await store.updateThread(USER_A, thread.id, {
      title: "Renamed thread",
      pinned: true,
      status: "archived",
    })).toMatchObject({ title: "Renamed thread", pinned: true, status: "archived" });

    await store.updateProject(USER_A, project.id, { status: "archived" });
    await expect(store.updateThread(USER_A, thread.id, { status: "active" }))
      .rejects.toBeInstanceOf(WorkbenchConflictError);
    await store.updateProject(USER_A, project.id, { status: "active" });
    await expect(store.updateThread(USER_A, thread.id, { status: "active" }))
      .resolves.toMatchObject({ status: "active" });
  });

  it("strictly parses bounded list queries", () => {
    expect(parseWorkbenchListQuery(new URLSearchParams())).toEqual({ status: "active", limit: 20 });
    expect(parseWorkbenchListQuery(new URLSearchParams("status=all&limit=50&q=%20alpha%20")))
      .toEqual({ status: "all", limit: 50, query: "alpha" });
    expect(parseWorkbenchListQuery(new URLSearchParams("limit=51"))).toBeNull();
    expect(parseWorkbenchListQuery(new URLSearchParams("limit=01"))).toBeNull();
    expect(parseWorkbenchListQuery(new URLSearchParams("q="))).toBeNull();
    expect(parseWorkbenchListQuery(new URLSearchParams("q=a&q=b"))).toBeNull();
    expect(parseWorkbenchListQuery(new URLSearchParams("unknown=value"))).toBeNull();
  });
});
