import { useEffect, useState } from 'react';

/** Phase 01 proof: the shared physics harness executed in the browser runtime. */
export function SpikePage() {
  const [result, setResult] = useState<string>('running…');
  const [ms, setMs] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const t0 = performance.now();
      const { runPhysicsHarness } = await import('@ff/sim');
      const r = await runPhysicsHarness();
      if (!cancelled) {
        setMs(performance.now() - t0);
        setResult(JSON.stringify(r));
      }
    })().catch((e: unknown) => setResult(`error: ${String(e)}`));
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <main className="page spike">
      <h1>Physics harness — browser runtime</h1>
      <p>Rapier WASM initialised in this page; 100 fixed ticks of the shared simulation package.</p>
      <pre id="harness" data-ms={ms.toFixed(1)}>
        {result}
      </pre>
    </main>
  );
}
