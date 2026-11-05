import type { Bundle } from "./domain";
import type { ParsedBackup, PreparedBackup } from "./backup";
function job<T>(message: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./backup.worker.ts", import.meta.url), {
      type: "module",
    });
    const timer = setTimeout(() => {
      worker.terminate();
      reject(
        new Error(
          "Backup operation timed out. Existing records were not changed.",
        ),
      );
    }, 120000);
    const stop = () => {
      clearTimeout(timer);
      worker.terminate();
    };
    worker.onmessage = (e) => {
      stop();
      e.data.error ? reject(new Error(e.data.error)) : resolve(e.data.result);
    };
    worker.onerror = (e) => {
      stop();
      reject(new Error(e.message || "Backup worker could not run."));
    };
    worker.postMessage(message);
  });
}
export const prepareBackup = (bundle: Bundle, password: string) =>
  job<PreparedBackup>({ action: "make", bundle, password });
export const inspectBackup = (bytes: Uint8Array, password: string) =>
  job<ParsedBackup>({ action: "read", bytes, password });
