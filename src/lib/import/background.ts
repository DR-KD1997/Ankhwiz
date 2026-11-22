// The app's side of the import worker (import.worker.ts). Reading a package
// and building its deck happen there; if a worker cannot be started, the
// same work is done here instead, as before.

import { coreModule } from '../core';
import type { AnkiPackage } from './apkg';
import { readPackage } from './apkg';
import { sqlWasm } from './sql';
import type { FromWorker, ToWorker } from './import.worker';
import ImportWorker from './import.worker?worker&inline';
import { t } from '../i18n';

/** Packages read by a worker, with the worker that holds their media. */
const workers = new WeakMap<AnkiPackage, Worker>();

export function workerOf(pkg: AnkiPackage): Worker | undefined {
  return workers.get(pkg);
}

/** Read an .apkg in the background when possible. */
export async function readPackageAway(bytes: Uint8Array, fileName: string): Promise<AnkiPackage> {
  const core = coreModule();
  let worker: Worker | null = null;
  /** Set when the worker read the file and found it wrong: that is the file's fault, not the worker's. */
  let fileProblem: Error | null = null;
  try {
    if (!core || typeof Worker === 'undefined') throw new Error('no worker');
    worker = new ImportWorker();
    const w = worker;
    const sql = await sqlWasm();
    const pkg = await new Promise<AnkiPackage>((resolve, reject) => {
      w.onmessage = (e: MessageEvent<FromWorker>) => {
        if (e.data.type === 'read') resolve(e.data.pkg);
        else if (e.data.type === 'error') reject((fileProblem = new Error(e.data.message)));
      };
      w.onerror = (e) => reject(new Error(e.message || 'no worker'));
      const msg: ToWorker = { type: 'read', core, sql: sql.slice(0), bytes: bytes.slice(0), fileName };
      // A device that cannot hand the core to a worker throws here; the file is then read in the window.
      w.postMessage(msg);
    });
    workers.set(pkg, w);
    return pkg;
  } catch (e) {
    worker?.terminate();
    if (fileProblem) throw fileProblem;
    void e;
    return readPackage(bytes, fileName);
  }
}

/** Run a step on the worker and wait for its result, passing on its progress. */
export function runInWorker(
  worker: Worker,
  msg: ToWorker,
  onStep: (s: { stage: 'notes' | 'lessons' | 'media' | 'saving'; done: number; total: number }) => void,
): Promise<Extract<FromWorker, { type: 'done' }>> {
  return new Promise((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<FromWorker>) => {
      const m = e.data;
      if (m.type === 'step') onStep(m);
      else if (m.type === 'done') resolve(m);
      else if (m.type === 'error') reject(new Error(m.message));
    };
    worker.onerror = (e) => reject(new Error(e.message || t('The import stopped.')));
    worker.postMessage(msg);
  });
}

/** Let a package's worker go (the import finished or was cancelled). */
export function release(pkg: AnkiPackage): void {
  workers.get(pkg)?.terminate();
  workers.delete(pkg);
}
