export type SaveState = "saved" | "saving" | "dirty" | "error";

/** Coalesce edits and serialize writes so a slow request cannot overwrite a newer edit. */
export class Autosave<T extends object> {
  private pending: T | null = null;
  private running: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly write: (patch: T) => Promise<unknown>,
    private readonly onState: (state: SaveState) => void,
    private readonly delay = 1000,
  ) {}

  get isDirty(): boolean {
    return this.pending !== null || this.running !== null;
  }

  schedule(patch: T): void {
    this.pending = { ...this.pending, ...patch };
    this.onState("dirty");
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.flush().catch(() => {}); }, this.delay);
  }

  async flush(): Promise<void> {
    clearTimeout(this.timer);
    if (this.running) {
      await this.running;
      if (this.pending) await this.flush();
      return;
    }
    if (!this.pending) return;
    // Assign before calling write, including when it throws synchronously.
    this.running = Promise.resolve().then(async () => {
      while (this.pending) {
        const patch = this.pending;
        this.pending = null;
        this.onState("saving");
        try {
          await this.write(patch);
        } catch (error) {
          // Newer values win, including edits made while this write failed.
          this.pending = { ...patch, ...(this.pending as T | null) };
          this.onState("error");
          throw error;
        }
      }
      this.onState("saved");
    });
    try {
      await this.running;
    } finally {
      this.running = null;
    }
  }
}
