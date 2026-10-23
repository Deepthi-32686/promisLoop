const { test } = require('node:test');
const assert = require('node:assert/strict');
const ai = require('../server/ai');

test('accepts valid structured AI output with supported enum values', () => {
  const result = ai.parseStructured(JSON.stringify({
    issueType: 'Damaged item', impact: 'service', vulnerability: 'none',
    summary: 'The item arrived cracked.', missingInformation: ['When did it arrive?'],
    priorityRecommendation: 'Medium', nextAction: 'request_photo_evidence'
  }));
  assert.ok(result);
  assert.equal(result.issueType, 'Damaged item');
  assert.equal(result.priorityRecommendation, 'Medium');
  assert.deepEqual(result.missingInformation, ['When did it arrive?']);
});

test('rejects unsupported enum values and malformed JSON', () => {
  assert.equal(ai.parseStructured('{"issueType":"make up"}'), null);
  assert.equal(ai.parseStructured('not json'), null);
});

test('rejects overlong summary and malformed missing-information lists', () => {
  const base = { issueType:'Other issue', impact:'service', vulnerability:'none', summary:'ok', missingInformation:[], priorityRecommendation:'Low', nextAction:'other' };
  assert.equal(ai.parseStructured(JSON.stringify({...base, summary:'x'.repeat(241)})), null);
  assert.equal(ai.parseStructured(JSON.stringify({...base, missingInformation:['x'.repeat(161)]})), null);
});
