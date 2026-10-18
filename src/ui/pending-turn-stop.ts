export function stopControlAccepted(value: unknown) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) &&
    "ok" in value && value.ok === true && "action" in value && value.action === "stop" &&
    "idempotent" in value && typeof value.idempotent === "boolean");
}

/** Client intent only. Only a server stream/snapshot can establish a terminal result. */
export class PendingTurnStop {
  private accepted = false;
  private requested = false;
  private controlAccepted = false;
  private followup = false;
  private flight: Promise<void> | null = null;
  private disposed = false;
  private terminal = false;

  constructor(private readonly options: {
    sendControl: (context: { admissionConfirmed: boolean }) => Promise<boolean>;
    onPause: () => void;
    onBusy: (busy: boolean) => void;
  }) {}

  get retriesPaused() { return this.requested && !this.accepted && !this.terminal; }
  get terminalObserved() { return this.terminal; }

  requestStop() {
    if (this.disposed || this.terminal) return Promise.resolve();
    this.requested = true;
    if (!this.accepted) this.options.onPause();
    return this.dispatch();
  }

  confirmAdmission() {
    if (this.disposed || this.terminal || this.accepted) return;
    this.accepted = true;
    if (!this.requested || this.controlAccepted) return;
    if (this.flight) this.followup = true;
    else void this.dispatch();
  }

  observeTerminal() { this.terminal = true; this.followup = false; }
  dispose() { this.disposed = true; this.followup = false; }

  private dispatch(): Promise<void> {
    if (this.flight) return this.flight;
    this.options.onBusy(true);
    this.flight = Promise.resolve().then(() => this.disposed || this.terminal ? false : this.options.sendControl({ admissionConfirmed: this.accepted })).then(
      accepted => { if (!this.disposed) this.controlAccepted = accepted; },
      () => { /* Unavailable control is not a stopped turn. The UI sender reports it. */ },
    ).finally(() => {
      this.flight = null;
      if (this.disposed) return;
      this.options.onBusy(false);
      if (this.followup) {
        this.followup = false;
        if (!this.terminal && !this.controlAccepted) void this.dispatch();
      }
    });
    return this.flight;
  }
}
