// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskCenterPanel } from "@/components/task-center-panel";
import type { TaskCenterItem } from "@/task-center/contracts";

const task: TaskCenterItem = {
  id: "0198b9f0-6631-7000-8000-000000000401.0198b9f0-6631-7000-8000-000000000402",
  threadId: "0198b9f0-6631-7000-8000-000000000401",
  projectId: "0198b9f0-6631-7000-8000-000000000403",
  threadTitle: "Informe semanal",
  projectName: "Operaciones",
  status: "completed",
  title: "Informe preparado",
  detail: "El resultado ya está disponible en la conversación.",
  createdAt: "2026-08-28T08:00:00.000Z",
  updatedAt: "2026-08-28T08:00:00.000Z",
  unread: true,
};

afterEach(cleanup);

describe("TaskCenterPanel", () => {
  it("shows durable history, filters and read actions", () => {
    const markRead = vi.fn();
    render(<TaskCenterPanel open tasks={[task]} preferences={{ inApp: true, desktop: false }} notificationPermission="default" busy={false} onClose={() => undefined} onOpenConversation={() => undefined} onMarkRead={markRead} onMarkAllRead={() => undefined} onPreferencesChange={() => undefined} onRequestDesktopNotifications={() => undefined} />);
    expect(screen.getByText("Informe preparado")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Marcar como leída" }));
    expect(markRead).toHaveBeenCalledWith(task.id);
    fireEvent.click(screen.getByRole("button", { name: /En curso/ }));
    expect(screen.getByText("Todo al día")).toBeInTheDocument();
  });

  it("requests browser permission only after the employee explicitly enables it", () => {
    const requestPermission = vi.fn();
    render(<TaskCenterPanel open tasks={[]} preferences={{ inApp: true, desktop: false }} notificationPermission="default" busy={false} onClose={() => undefined} onOpenConversation={() => undefined} onMarkRead={() => undefined} onMarkAllRead={() => undefined} onPreferencesChange={() => undefined} onRequestDesktopNotifications={requestPermission} />);
    expect(requestPermission).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Preferencias de notificaciones" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Avisos del navegador/ }));
    expect(requestPermission).toHaveBeenCalledTimes(1);
  });
});
