import { useEffect, useState } from 'react';

/** Result of an async lookup for rendering (cover URLs, path checks); stale results are dropped. */
export function useAsync<T>(load: () => Promise<T>, deps: readonly unknown[], initial: T): T {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    let alive = true;
    load().then(
      (v) => alive && setValue(v),
      () => alive && setValue(initial),
    );
    return () => {
      alive = false;
    };
    // The caller lists the dependencies of `load`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return value;
}
