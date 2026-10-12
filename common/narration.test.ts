import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_NARRATION_LANGUAGE,
  isNarrationLanguage,
  NARRATION_LANGUAGES,
  SENSEVOICE_LANGUAGES,
  narrationLanguageLabel,
} from "./narration";

test("narration exposes all Whisper languages alphabetically with Chinese as the default", () => {
  const codes = NARRATION_LANGUAGES.map(({ code }) => code);
  const labels = NARRATION_LANGUAGES.map(({ label }) => label);

  assert.equal(NARRATION_LANGUAGES.length, 100);
  assert.equal(new Set(codes).size, NARRATION_LANGUAGES.length);
  assert.deepEqual(labels, [...labels].sort((left, right) => left.localeCompare(right, "en")));
  assert.equal(DEFAULT_NARRATION_LANGUAGE, "zh");
  assert.equal(narrationLanguageLabel(DEFAULT_NARRATION_LANGUAGE), "中文");
  assert.equal(isNarrationLanguage("haw"), true);
  assert.equal(isNarrationLanguage("xx"), false);
});

test("SenseVoice exposes only its five supported recording languages", () => {
  assert.deepEqual(SENSEVOICE_LANGUAGES.map(language => language.code).sort(), ["en","ja","ko","yue","zh"]);
});
