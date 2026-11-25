import { execSync } from "node:child_process";

// Integration tests run against the throwaway stack in compose.test.yaml (docs/environment.md).
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://test:test@localhost:55432/quantpilot_test";
export const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? "redis://localhost:56379";

export default function setup(): void {
  // Guard: only ever migrate a *_test database. The compose.test.yaml database lives on
  // tmpfs, so each `up` starts empty; tests do not assume an empty database.
  if (!new URL(TEST_DATABASE_URL).pathname.endsWith("_test")) {
    throw new Error("TEST_DATABASE_URL must name a *_test database");
  }
  execSync("pnpm exec prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: "pipe",
  });
}
