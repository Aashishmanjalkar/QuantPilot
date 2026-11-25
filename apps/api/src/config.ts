import { z } from "zod";

// QP-STD-002/006: environment is external input; secrets only come from here.
const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  QUANT_URL: z.string().url(),
  QUANT_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  RUN_WORKER: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    // Report variable names only, never values.
    const names = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid environment configuration: ${names}`);
  }
  return parsed.data;
}
