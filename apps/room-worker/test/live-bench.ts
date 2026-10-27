/**
 * In-Worker benchmark driver (D01 work package 7): real-time 30 Hz simulation of 20 dynamic bodies
 * + 20 regions inside the Durable Object runtime with two connected WebSocket clients, for >= 60 s.
 * BENCH_SCENARIO=elements runs the D04 worst-case element load (ElementStress) instead.
 * Run: `pnpm benchmark:worker` (spawns local wrangler dev). Results are written to docs/benchmarks.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { TestSocket, startWorker, workerDir } from './wrangler-harness.js';

const seconds = Number(process.env.BENCH_SECONDS ?? 60);
const bodies = Number(process.env.BENCH_BODIES ?? 20);
const regions = Number(process.env.BENCH_REGIONS ?? 20);
const scenario = process.env.BENCH_SCENARIO === 'elements' ? 'elements' : 'base';
const port = Number(process.env.WORKER_PORT ?? 8792);
const worker = await startWorker(port);

try {
  const clients = [
    await TestSocket.open(`${worker.wsBase}/spike/bench/ws`),
    await TestSocket.open(`${worker.wsBase}/spike/bench/ws`),
  ];
  const start = await fetch(
    `${worker.base}/spike/bench/start?seconds=${seconds}&bodies=${bodies}&regions=${regions}&scenario=${scenario}`,
    { method: 'POST' },
  );
  console.log('start:', await start.text());
  let seq = 0;
  const pump = setInterval(() => {
    for (const c of clients) {
      c.send({
        t: 'intent',
        i: {
          seq: seq++,
          clientTime: Date.now(),
          action: 'aim',
          phase: 'hold',
          aim: [Math.random() * 2 - 1, Math.random() * 2 - 1],
          intensity: 1,
          source: 'bot',
        },
      });
    }
  }, 100);
  const t0 = Date.now();
  let report: Record<string, unknown> = {};
  while (Date.now() - t0 < (seconds + 30) * 1000) {
    await new Promise((r) => setTimeout(r, 2000));
    report = (await (await fetch(`${worker.base}/spike/bench/report`)).json()) as Record<
      string,
      unknown
    >;
    process.stdout.write(`\r  ticks ${String(report.ticks)} / ${seconds * 30}   `);
    if (report.status === 'done') break;
  }
  clearInterval(pump);
  console.log();
  const received = clients.map((c) => c.of('snap').length);
  const out = {
    measuredAt: new Date().toISOString(),
    host: {
      platform: os.platform(),
      arch: os.arch(),
      cpus: os.cpus()[0]?.model ?? 'unknown',
      cpuCount: os.cpus().length,
      node: process.version,
    },
    clientSnapshotsReceived: received,
    clientBytesReceived: clients.map((c) => c.bytesIn),
    report,
  };
  const { batchMeanMs, ...summary } = report;
  console.log(JSON.stringify({ ...out, report: summary }, null, 2));
  const batches = Array.isArray(batchMeanMs) ? (batchMeanMs as number[]) : [];
  if (batches.length) {
    const sorted = [...batches].sort((a, b) => a - b);
    console.log(
      `30-tick batch means: min ${sorted[0]} ms, median ${sorted[Math.floor(sorted.length / 2)]} ms, max ${sorted.at(-1)} ms`,
    );
  }
  const dir = path.resolve(workerDir, '../../docs/benchmarks');
  mkdirSync(dir, { recursive: true });
  const file = path.join(
    dir,
    scenario === 'elements'
      ? `worker-bench-elements-${bodies}b-${seconds}s.json`
      : `worker-bench-${bodies}b-${regions}r-${seconds}s.json`,
  );
  writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
  console.log(`saved ${path.relative(process.cwd(), file)}`);
  for (const c of clients) c.close();
} finally {
  await worker.stop();
}
