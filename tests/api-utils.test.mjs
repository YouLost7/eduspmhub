import test from "node:test";
import assert from "node:assert/strict";
import { friendlyNonJsonApiMessage, messageForFailedApiResponse } from "../src/api.js";
import { normalizePersonName, formatPersonNameInput } from "../shared/personName.js";

test("normalizePersonName uppercases and trims names", () => {
  assert.equal(normalizePersonName("  ahmad bin ali  "), "AHMAD BIN ALI");
  assert.equal(normalizePersonName(""), "");
});

test("formatPersonNameInput preserves trailing space while typing", () => {
  assert.equal(formatPersonNameInput("ahmad "), "AHMAD ");
  assert.equal(formatPersonNameInput("  ahmad  ali"), "AHMAD ALI");
});

test("friendlyNonJsonApiMessage maps payload-too-large errors", () => {
  const msg = friendlyNonJsonApiMessage("Request Entity Too Large");
  assert.match(msg, /payload was too large/i);
});

test("friendlyNonJsonApiMessage maps HTML proxy errors", () => {
  const msg = friendlyNonJsonApiMessage("<!doctype html><title>Error</title>");
  assert.match(msg, /did not reach the EduSPM API/i);
});

test("messageForFailedApiResponse prefers server-provided error", () => {
  const msg = messageForFailedApiResponse(
    { status: 400, statusText: "Bad Request" },
    '{"error":"Invalid payload"}',
    { error: "Invalid payload" }
  );
  assert.equal(msg, "Invalid payload");
});

test("messageForFailedApiResponse includes multi-server 404 hint", () => {
  const msg = messageForFailedApiResponse(
    { status: 404, statusText: "Not Found" },
    '{"error":"Course not found"}',
    { error: "Course not found" }
  );
  assert.match(msg, /different API/i);
});
