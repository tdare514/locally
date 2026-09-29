export interface ServerEnvInput {
  base: NodeJS.ProcessEnv;
  port: number;
  configDir: string;
  ffmpegPath?: string;
  extraPathDirs: string[];
}

/**
 * Environment for the Next standalone server child process. Pure: no electron import.
 * HOSTNAME is 127.0.0.1 unconditionally; the standalone server defaults to 0.0.0.0
 * and ADR 0003 forbids exposing the server on the LAN.
 */
export function buildServerEnv(input: ServerEnvInput): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...input.base,
    HOSTNAME: "127.0.0.1",
    PORT: String(input.port),
    NODE_ENV: "production",
    LOCALLY_CONFIG_DIR: input.configDir,
  };
  if (input.ffmpegPath) env.LOCALLY_FFMPEG = input.ffmpegPath;

  const existing = (input.base.PATH ?? "").split(":").filter(Boolean);
  const added: string[] = [];
  for (const dir of input.extraPathDirs) {
    if (!existing.includes(dir) && !added.includes(dir)) added.push(dir);
  }
  env.PATH = [...added, ...existing].join(":");
  return env;
}
