import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
export const workerDir = path.resolve(here, '..');

export interface RunningWorker {
  readonly base: string;
  readonly wsBase: string;
  readonly proc: ChildProcess | null;
  stop(): Promise<void>;
}

/**
 * Starts `wrangler dev` (local workerd) on the given port unless WORKER_URL points at an already
 * running instance. Returns once /health answers.
 */
export async function startWorker(port: number): Promise<RunningWorker> {
  const external = process.env.WORKER_URL;
  if (external) {
    return {
      base: external,
      wsBase: external.replace(/^http/, 'ws'),
      proc: null,
      stop: async () => {},
    };
  }
  const proc = spawn('npx', ['wrangler', 'dev', '--ip', '127.0.0.1', '--port', String(port)], {
    cwd: workerDir,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  proc.stdout?.on('data', (d: Buffer) => (log += d.toString()));
  proc.stderr?.on('data', (d: Buffer) => (log += d.toString()));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 120; i++) {
    await sleep(500);
    try {
      const r = await fetch(`${base}/health`);
      if (r.ok) {
        return {
          base,
          wsBase: base.replace(/^http/, 'ws'),
          proc,
          stop: async () => {
            proc.kill('SIGTERM');
            await sleep(300);
          },
        };
      }
    } catch {
      // not ready yet
    }
    if (proc.exitCode !== null) break;
  }
  proc.kill('SIGKILL');
  throw new Error(`wrangler dev failed to start:\n${log.slice(-3000)}`);
}

/** Minimal promise-based WebSocket client over Node 22's built-in WebSocket. */
export class TestSocket {
  readonly messages: Record<string, unknown>[] = [];
  closed: { code: number; reason: string } | null = null;
  private waiters: {
    pred: (m: Record<string, unknown>) => boolean;
    resolve: (m: Record<string, unknown>) => void;
  }[] = [];
  bytesIn = 0;

  private constructor(readonly ws: WebSocket) {
    ws.addEventListener('message', (ev) => {
      const text = String(ev.data);
      this.bytesIn += text.length;
      const msg = JSON.parse(text) as Record<string, unknown>;
      this.messages.push(msg);
      this.waiters = this.waiters.filter((w) => {
        if (w.pred(msg)) {
          w.resolve(msg);
          return false;
        }
        return true;
      });
    });
    ws.addEventListener('close', (ev) => {
      this.closed = { code: ev.code, reason: ev.reason };
    });
  }

  static open(url: string): Promise<TestSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const s = new TestSocket(ws);
      ws.addEventListener('open', () => resolve(s), { once: true });
      ws.addEventListener('error', () => reject(new Error(`websocket error ${url}`)), {
        once: true,
      });
    });
  }

  send(obj: unknown): void {
    this.ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj));
  }

  waitFor(
    pred: (m: Record<string, unknown>) => boolean,
    timeoutMs = 5000,
  ): Promise<Record<string, unknown>> {
    const existing = this.messages.find(pred);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout waiting for message')), timeoutMs);
      this.waiters.push({
        pred,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m);
        },
      });
    });
  }

  waitType(t: string, timeoutMs = 5000): Promise<Record<string, unknown>> {
    return this.waitFor((m) => m.t === t, timeoutMs);
  }

  async waitClosed(timeoutMs = 5000): Promise<{ code: number; reason: string }> {
    const start = Date.now();
    while (!this.closed && Date.now() - start < timeoutMs) await sleep(20);
    if (!this.closed) throw new Error('socket did not close');
    return this.closed;
  }

  of(t: string): Record<string, unknown>[] {
    return this.messages.filter((m) => m.t === t);
  }

  close(): void {
    this.ws.close(1000, 'done');
  }
}

let failures = 0;
export function check(cond: boolean, label: string, detail?: unknown): void {
  if (cond) console.log(`  PASS ${label}`);
  else {
    failures++;
    console.log(
      `  FAIL ${label}${detail !== undefined ? ` :: ${JSON.stringify(detail).slice(0, 400)}` : ''}`,
    );
  }
}

export function failureCount(): number {
  return failures;
}
