import { scanStructuredPii, resolveOverlaps } from "../../common/sensitive";
import { scanSecrets } from "../sensitive/secrets";
import { buildRedactor } from "../sensitive/scanner";

/** Incremental path: every new evidence/answer/result passes this before disk or model. */
export async function redactIncremental(text: string): Promise<string> {
  const matches = resolveOverlaps([
    ...(await scanSecrets(text, { strict: true })),
    ...scanStructuredPii(text),
  ]);
  return buildRedactor(matches.map((m) => m.value))(text);
}

/** Preserve JSON types: replacing a numeric timestamp in serialized JSON can make it invalid. */
export async function redactValue<T>(value: T): Promise<T> {
  if (typeof value === "string") return (await redactIncremental(value)) as T;
  if (Array.isArray(value))
    return (await Promise.all(value.map((item) => redactValue(item)))) as T;
  if (value && typeof value === "object") {
    const entries = await Promise.all(
      Object.entries(value).map(async ([key, item]) => [
        key,
        await redactValue(item),
      ]),
    );
    return Object.fromEntries(entries) as T;
  }
  return value;
}
