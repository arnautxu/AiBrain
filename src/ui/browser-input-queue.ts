/** A viewer's ordered, bounded input lane. Failed/closed lanes never replay work. */
export class BrowserInputQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private generation = 0;
  private pending = 0;
  private closed = false;

  cancel() {
    this.closed = true;
    this.generation += 1;
  }

  enqueue<T>(operation: (assertCurrent: () => void) => Promise<T>): Promise<T> {
    if (this.closed || this.pending >= 128) {
      return Promise.reject(new Error("La entrada del navegador no está disponible. Revisa la página antes de continuar."));
    }
    const generation = this.generation;
    const assertCurrent = () => {
      if (this.closed || generation !== this.generation) {
        throw new Error("Entrada pendiente cancelada. Revisa la página antes de continuar.");
      }
    };
    this.pending += 1;
    const result = this.tail.then(async () => {
      assertCurrent();
      try {
        return await operation(assertCurrent);
      } catch (error) {
        // Later inputs may depend on an uncertain focus/navigation. Cancel them.
        if (this.generation === generation) this.generation += 1;
        throw error;
      }
    });
    this.tail = result.catch(() => undefined).finally(() => { this.pending -= 1; });
    return result;
  }
}
