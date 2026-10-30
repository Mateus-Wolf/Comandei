// Share concurrent reads only. Responses are discarded when the request finishes.
export function createRequestPool() {
  const pending = new Map<string, Promise<unknown>>();
  return {
    run<T>(key: string, load: () => Promise<T>): Promise<T> {
      const existing = pending.get(key);
      if (existing) return existing as Promise<T>;
      const request = Promise.resolve().then(load);
      pending.set(key, request);
      const forget = () => {
        if (pending.get(key) === request) pending.delete(key);
      };
      void request.then(forget, forget);
      return request;
    },
    invalidate() {
      pending.clear();
    },
  };
}
