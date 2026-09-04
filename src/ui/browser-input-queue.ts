/** A viewer's ordered, bounded input lane. Failed/closed lanes never replay work. */
export class BrowserInputQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private generation = 0;
  private pending = 0;
  private closed = false;
  private coalescible: {
    key: string;
    generation: number;
    operation: (assertCurrent: () => void) => Promise<unknown>;
    result: Promise<unknown>;
  } | null = null;

  cancel() {
    this.closed = true;
    this.generation += 1;
    this.coalescible = null;
  }

  enqueue<T>(operation: (assertCurrent: () => void) => Promise<T>, coalesceKey?: string): Promise<T> {
    if (!this.closed && coalesceKey && this.coalescible?.key === coalesceKey &&
      this.coalescible.generation === this.generation) {
      this.coalescible.operation = operation;
      return this.coalescible.result as Promise<T>;
    }
    if (this.closed || this.pending >= 128) {
      return Promise.reject(new Error("La entrada del navegador no está disponible. Revisa la página antes de continuar."));
    }
    const entry = { key: coalesceKey ?? "", generation: this.generation, operation, result: Promise.resolve() as Promise<unknown> };
    this.coalescible = coalesceKey ? entry : null;
    const generation = this.generation;
    const assertCurrent = () => {
      if (this.closed || generation !== this.generation) {
        throw new Error("Entrada pendiente cancelada. Revisa la página antes de continuar.");
      }
    };
    this.pending += 1;
    const result = this.tail.then(async () => {
      if (this.coalescible === entry) this.coalescible = null;
      assertCurrent();
      try {
        return await entry.operation(assertCurrent) as T;
      } catch (error) {
        // Later inputs may depend on an uncertain focus/navigation. Cancel them.
        if (this.generation === generation) this.generation += 1;
        throw error;
      }
    });
    this.tail = result.catch(() => undefined).finally(() => { this.pending -= 1; });
    entry.result = result;
    return result;
  }
}
