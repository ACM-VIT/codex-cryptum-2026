import assert from "node:assert/strict";
import { scryptSync } from "node:crypto";
import { test } from "vitest";
import { digest, equalSecret, flagFor, newToken, verifyAccessCode } from "./security";
import { filterReply, INSPECTION_LIMIT, isL5Blocked, isL6Blocked, REDACTION } from "./filters";
import { body, challengeId, HttpError, sameOrigin } from "./http";
import { z } from "zod";

const flag = "CTF{synthetic_l6_smart_flag}";

test("flags use the FastAPI HMAC format and are isolated by team and challenge", () => {
  const secret = "s".repeat(32);
  assert.equal(flagFor("team-a", 5, secret), "cdx{172f9919bc83f81f984b434c190267fb81b7c5c41d0d8678c16cfad7aafa27f7}");
  assert.notEqual(flagFor("team-a", 5, secret), flagFor("team-b", 5, secret));
  assert.notEqual(flagFor("team-a", 5, secret), flagFor("team-a", 6, secret));
  assert.throws(() => flagFor("team-a", 5, "short"));
});

test("session tokens are random, hashed, and safely compared", () => {
  const token = newToken();
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(token, newToken());
  assert.notEqual(digest(token), token);
  assert.equal(equalSecret("a", "a"), true);
  assert.equal(equalSecret("a", "aa"), false);
});

test("scrypt salt:hex team credentials fail closed", async () => {
  const salt = "ab".repeat(16);
  const stored = `${salt}:${scryptSync("correct-code", salt, 64).toString("hex")}`;
  assert.equal(await verifyAccessCode("correct-code", stored), true);
  assert.equal(await verifyAccessCode("wrong", stored), false);
  assert.equal(await verifyAccessCode("correct-code", "malformed"), false);
});

test("L5 intentionally filters exact case-sensitive strings only", () => {
  assert.equal(isL5Blocked(`prefix ${flag} suffix`, flag), true);
  assert.equal(isL5Blocked(flag.toLowerCase(), flag), false);
  assert.equal(isL5Blocked([...flag].join(" "), flag), false);
  assert.equal(filterReply(5, flag, flag), REDACTION);
});

test("L6 catches direct, normalized, HTML, URL, reverse, ROT13, base64 and hex representations", () => {
  const rot13 = flag.replace(/[a-z]/gi, (char) => String.fromCharCode(char.charCodeAt(0) + (char.toLowerCase() <= "m" ? 13 : -13)));
  const variants = [flag, flag.toLowerCase(), [...flag].join(" . "), [...flag].map((char) => `&#${char.codePointAt(0)};`).join(""), encodeURIComponent(flag), [...flag].reverse().join(""), rot13, Buffer.from(flag).toString("base64"), Buffer.from(flag).toString("hex")];
  for (const value of variants) assert.equal(isL6Blocked(value, flag), true, value);
  assert.equal(isL6Blocked("Safe conversation", flag), false);
});

test("L6 preserves the PR2 limited Unicode-codepoint inspection vulnerability", () => {
  assert.equal(INSPECTION_LIMIT, 512);
  assert.equal(isL6Blocked(`Summary: ${flag}`, flag), true);
  const appendix = `${"x".repeat(512)}\nAppendix: ${flag}`;
  assert.equal(isL6Blocked(appendix, flag), false);
  assert.equal(filterReply(6, appendix, flag), appendix);
  assert.equal(isL6Blocked(`${"😀".repeat(500)}${flag}`, flag), false);
  assert.equal(isL6Blocked(`${"😀".repeat(450)}${flag}`, flag), true);
});

test("mutations reject cross-origin and missing-origin requests", () => {
  const previous = process.env.BETTER_AUTH_URL;
  process.env.BETTER_AUTH_URL = "https://cryptum.example";
  try {
    assert.doesNotThrow(() => sameOrigin(new Request("https://cryptum.example/api/session", { headers: { origin: "https://cryptum.example" } })));
    for (const origin of [undefined, "https://evil.example"]) assert.throws(() => sameOrigin(new Request("https://cryptum.example/api/session", { headers: origin ? { origin } : {} })), HttpError);
  } finally {
    if (previous === undefined) delete process.env.BETTER_AUTH_URL; else process.env.BETTER_AUTH_URL = previous;
  }
});

test("JSON bodies and challenge IDs are bounded and strict", async () => {
  const schema = z.object({ flag: z.string().max(200) }).strict();
  const request = (value: unknown) => new Request("https://cryptum.example", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
  assert.deepEqual(await body(request({ flag }), schema), { flag });
  await assert.rejects(body(request({ flag, score: 99999 }), schema));
  await assert.rejects(body(request({ flag: "x".repeat(9000) }), schema), HttpError);
  assert.equal(challengeId("10"), 10);
  assert.equal(challengeId("11"), 11);
  for (const id of ["0", "1x", "01", "-1", "2147483648", "999999999999999999999"]) assert.throws(() => challengeId(id), HttpError);
});
