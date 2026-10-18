import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftFailure } from '../src/integration/draft-errors.js';
test('draft diagnostics distinguish incomplete schedules, invalid output and provider failures without copying secrets', () => {
  assert.equal(draftFailure(new Error('La proposta no conté una setmana completa per persona.')).code, 'DRAFT_INCOMPLETE');
  assert.equal(draftFailure(new Error('Torn de la proposta invàlid.')).code, 'DRAFT_INVALID_SHIFT');
  assert.equal(draftFailure(new Error('Error al parsear la respuesta de la IA: private-data')).code, 'DRAFT_INVALID_OUTPUT');
  assert.equal(draftFailure(new Error('Codex d’AiBrain no ha completat el càlcul (503).')).code, 'DRAFT_CALCULATION_UNAVAILABLE');
  const result = draftFailure(new Error('password=DO_NOT_EXPOSE SQL customer-data'));
  assert.equal(result.code, 'DRAFT_INTERNAL');
  assert.equal(result.businessDataSaved, false);
  assert.doesNotMatch(JSON.stringify(result), /DO_NOT_EXPOSE|SQL|customer-data/);
});
