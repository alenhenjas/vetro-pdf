import { exportProject, type ExportRequest } from './exportPdf';
import { parseProject } from './importPdf';

/** Worker: lettura e scrittura del PDF non bloccano mai l'interfaccia. */
type Message =
  | { id: number; op: 'parse'; bytes: Uint8Array }
  | { id: number; op: 'export'; request: ExportRequest };

self.onmessage = async (e: MessageEvent<Message>) => {
  const m = e.data;
  try {
    if (m.op === 'parse') {
      const result = await parseProject(m.bytes);
      self.postMessage({ id: m.id, result });
    } else {
      const result = await exportProject(m.request);
      self.postMessage({ id: m.id, result });
    }
  } catch (err) {
    self.postMessage({ id: m.id, error: err instanceof Error ? err.message : String(err) });
  }
};
