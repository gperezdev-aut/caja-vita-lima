import "server-only";

export function getServerEnv(name: string) {
  const value = process.env[name];

  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}
