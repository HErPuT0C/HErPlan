import { useSyncExternalStore } from 'react';
import type { Atom } from './atom';
import type { Store } from './store';

/** Subscribes a component to a slice of the store; re-renders only when the selected value changes. */
export function useStore<S extends object, T>(store: Store<S>, select: (state: S) => T): T {
  return useSyncExternalStore(store.subscribe, () => select(store.getState()));
}

export function useAtom<T>(a: Atom<T>): T {
  return useSyncExternalStore(a.subscribe, a.get);
}

/** A derived value of an atom; the selector must return the same value (or reference) for the same input. */
export function useAtomSelect<T, R>(a: Atom<T>, select: (value: T) => R): R {
  return useSyncExternalStore(a.subscribe, () => select(a.get()));
}
