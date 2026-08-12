export type ReadinessCheck = () => Promise<void>;
export type SqlProbe = (statement: string) => Promise<unknown>;

export function createPostgresReadinessCheck(probe: SqlProbe): ReadinessCheck {
  return async () => {
    await probe("select 1");
  };
}
