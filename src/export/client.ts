import type { ExportRequest, ExportResult } from './exportPdf';
import type { ParseResult } from './importPdf';

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (v: never) => void; reject: (e: Error) => void }>();

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const { id, result, error } = e.data;
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      if (error) p.reject(new Error(error));
      else p.resolve(result as never);
    };
    worker.onerror = (e) => {
      for (const p of pending.values()) p.reject(new Error(e.message || 'Errore del worker'));
      pending.clear();
    };
  }
  return worker;
}

function call<T>(message: object): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve: resolve as (v: never) => void, reject });
    getWorker().postMessage({ ...message, id });
  });
}

export const parsePdf = (bytes: Uint8Array) => call<ParseResult>({ op: 'parse', bytes });
export const exportPdf = (request: ExportRequest) => call<ExportResult>({ op: 'export', request });
