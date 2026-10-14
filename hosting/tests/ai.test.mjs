import test from "node:test";
import assert from "node:assert/strict";
import { generateCitedAnswer, validateCitedAnswer } from "../ai.mjs";

const sources = [{ id: "paper1-page2", paper_id: "paper1", title: "Evidence", page: 2, kind: "pdf-page", text: "The measurement depends on detector acceptance and equal exposure." }];
const result = { answer: "Acceptance matters.", claims: [{ text: "Acceptance is an assumption.", citations: [{ source_id: "paper1-page2", quote: "depends on detector acceptance" }] }], open_questions: [], limitations: ["Only one page is supplied."] };

test("no API key makes no external call and explicitly blocks generation", async () => {
  let calls = 0;
  await assert.rejects(generateCitedAnswer({}, { question: "Why?", sources }, () => { calls++; }), { code: "ai_not_configured" });
  assert.equal(calls, 0);
});
test("unknown source and fabricated quote are refused", () => {
  const unknown = structuredClone(result); unknown.claims[0].citations[0].source_id = "invented";
  assert.throws(() => validateCitedAnswer(unknown, sources), { code: "unverified_ai_citation" });
  const fake = structuredClone(result); fake.claims[0].citations[0].quote = "a fabricated measurement";
  assert.throws(() => validateCitedAnswer(fake, sources), { code: "unverified_ai_citation" });
});
test("valid quote returns original paper/page provenance", () => {
  const answer = validateCitedAnswer(result, sources);
  assert.equal(answer.claims[0].citations[0].paper_id, "paper1");
  assert.equal(answer.claims[0].citations[0].page, 2);
});
test("provider response is a draft and uses structured output without storage", async () => {
  const response = await generateCitedAnswer({ OPENAI_API_KEY: "test-fixture" }, { question: "Why?", locale: "ko", sources }, async (url, init) => {
    assert.equal(url, "https://api.openai.com/v1/responses");
    const body = JSON.parse(init.body); assert.equal(body.store, false); assert.equal(body.text.format.strict, true);
    return Response.json({ status: "completed", output: [{ content: [{ type: "output_text", text: JSON.stringify(result) }] }] });
  });
  assert.equal(response.provider, "openai");
  assert.equal(response.claims.length, 1);
});
