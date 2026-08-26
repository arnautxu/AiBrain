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
import { parseWorkbenchListQuery, type WorkbenchListQuery } from "@/workbench/types";

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
  it("starts empty and persists projects, threads, turns, activity and runtime token across restart", async () => {
    const { usersRoot, store } = await fixture();
    await expect(store.load(USER_A)).resolves.toEqual({
      persistence: "filesystem",
      projects: [],
      threads: [],
    });

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
    expect((await store.load(USER_A)).projects[0].status).toBe("archived");
    await store.updateProject(USER_A, project.id, { status: "active" });
    await store.updateThread(USER_A, thread.id, { title: "Delivered", pinned: true, status: "archived" });

    const restarted = new FileWorkbenchStore({ installationId: INSTALLATION_ID, usersRoot });
    const snapshot = await restarted.load(USER_A);
    expect(snapshot.projects).toEqual([
      expect.objectContaining({ id: project.id, name: "Client Ops", pinned: true }),
    ]);
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
    expect(await store.load(USER_A)).toMatchObject({
      projects: [{ id: projectA.id }],
      threads: [],
    });
    expect(await store.load(USER_B)).toMatchObject({
      projects: [{ id: projectB.id }],
      threads: [{ id: threadB.id }],
    });
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
    expect(snapshot.projects).toHaveLength(32);
    const raw = JSON.parse(await readFile(
      path.join(usersRoot, USER_A, "state", "workbench.json"),
      "utf8",
    )) as { revision: number };
    expect(raw.revision).toBe(32);
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
