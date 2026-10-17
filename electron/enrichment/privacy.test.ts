import { test } from "node:test";
import assert from "node:assert/strict";
import { redactIncremental, redactValue } from "./privacy";
test("incremental material redaction masks secret text before storage and preserves structured JSON types", async () => {
  const secret = "ghp_" + "A".repeat(36),
    value = {
      createdAt: 1791966724563,
      query: { description: "token " + secret },
      array: ["contact person@example.com"],
      nullable: null,
    };
  const result = await redactValue(value);
  assert.equal(result.createdAt, value.createdAt);
  assert.equal(result.nullable, null);
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(result.array[0]?.includes("person@example.com"), false);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  assert.equal(
    (await redactIncremental("token " + secret)).includes(secret),
    false,
  );
});
