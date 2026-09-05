import { afterEach, expect, it, vi } from "vitest";
import { Autosave } from "./autosave";

afterEach(() => vi.useRealTimers());

it("coalesces typing and saves title and content together", async () => {
  vi.useFakeTimers();
  const write = vi.fn().mockResolvedValue(undefined);
  const save = new Autosave<{ title?: string; content?: string }>(write, () => {});
  save.schedule({ title: "Draft" });
  save.schedule({ content: "a" });
  save.schedule({ content: "ab" });
  await vi.advanceTimersByTimeAsync(1000);
  expect(write).toHaveBeenCalledExactlyOnceWith({ title: "Draft", content: "ab" });
  expect(save.isDirty).toBe(false);
});

it("waits for in-flight writes before saving newer edits or finishing a flush", async () => {
  vi.useFakeTimers();
  let finish!: () => void;
  const write = vi.fn().mockImplementationOnce(() => new Promise<void>(r => { finish = r; }))
    .mockResolvedValue(undefined);
  const state = vi.fn();
  const save = new Autosave<{ content: string }>(write, state);
  save.schedule({ content: "old" });
  const first = save.flush();
  await Promise.resolve();
  save.schedule({ content: "new" });
  const second = save.flush();
  expect(write).toHaveBeenCalledTimes(1);
  expect(save.isDirty).toBe(true);
  finish();
  await Promise.all([first, second]);
  expect(write.mock.calls.map(([patch]) => patch.content)).toEqual(["old", "new"]);
  expect(state).toHaveBeenLastCalledWith("saved");
  expect(save.isDirty).toBe(false);
});

it("retains the newest edit and other fields when a write fails, then retries", async () => {
  vi.useFakeTimers();
  let fail!: (error: Error) => void;
  const write = vi.fn().mockImplementationOnce(() => new Promise((_, r) => { fail = r; }))
    .mockResolvedValue(undefined);
  const save = new Autosave<{ title?: string; content?: string }>(write, () => {});
  save.schedule({ title: "Title", content: "old" });
  const first = save.flush();
  await Promise.resolve();
  save.schedule({ content: "new" });
  fail(new Error("offline"));
  await expect(first).rejects.toThrow("offline");
  expect(save.isDirty).toBe(true);
  await save.flush();
  expect(write).toHaveBeenLastCalledWith({ title: "Title", content: "new" });
  expect(save.isDirty).toBe(false);
});
