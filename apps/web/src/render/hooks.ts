import { useEffect, useMemo } from 'react';
import * as THREE from 'three';

/** Memoised standard material keyed by its (plain-data) parameters; disposed on unmount. */
export function useStandardMaterial(
  params: THREE.MeshStandardMaterialParameters,
): THREE.MeshStandardMaterial {
  const key = JSON.stringify(params);
  const m = useMemo(
    () => new THREE.MeshStandardMaterial(JSON.parse(key) as THREE.MeshStandardMaterialParameters),
    [key],
  );
  useEffect(() => () => m.dispose(), [m]);
  return m;
}

/** Creates a disposable resource once per dependency set and disposes it on change/unmount. */
export function useDisposable<T extends { dispose(): void }>(
  factory: () => T,
  deps: readonly unknown[],
): T {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- deps are supplied by the caller
  const value = useMemo(factory, deps);
  useEffect(() => () => value.dispose(), [value]);
  return value;
}
