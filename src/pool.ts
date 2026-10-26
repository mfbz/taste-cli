// Runs fn over items with at most `limit` running at once, results in input order. On the first failure
// no new item starts, but the ones already running are let finish, so a caller that records what
// succeeded (a file written) knows the whole of it before the error comes out.

async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failure: { error: unknown } | undefined;
  async function worker(): Promise<void> {
    while (failure === undefined && next < items.length) {
      const index = next;
      next += 1;
      try {
        results[index] = await fn(items[index] as T, index);
      } catch (error) {
        failure ??= { error };
      }
    }
  }
  const workers = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workers }, worker));
  if (failure !== undefined) throw failure.error;
  return results;
}

export { mapLimit };
