const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const ai = require('../server/ai');

let mockServer;
let mockBaseUrl;
let mockResponseStatusCode = 200;
let mockResponseBody = {};
let mockDelayMs = 0;

before(async () => {
  mockServer = http.createServer((req, res) => {
    if (mockDelayMs > 0) {
      setTimeout(() => {
        res.writeHead(mockResponseStatusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(mockResponseBody));
      }, mockDelayMs);
    } else {
      res.writeHead(mockResponseStatusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(mockResponseBody));
    }
  });

  await new Promise(resolve => mockServer.listen(0, resolve));
  mockBaseUrl = `http://127.0.0.1:${mockServer.address().port}/v1`;
});

after(async () => {
  await new Promise(resolve => mockServer.close(resolve));
});

test('provider configuration defaults to groq when unconfigured', () => {
  const origProvider = process.env.AI_PROVIDER;
  const origUrl = process.env.AI_BASE_URL;
  delete process.env.AI_PROVIDER;
  delete process.env.AI_BASE_URL;

  const conf = ai.getConfig();
  assert.equal(conf.provider, 'groq');
  assert.equal(conf.baseUrl, 'https://api.groq.com/openai/v1');

  process.env.AI_PROVIDER = origProvider;
  process.env.AI_BASE_URL = origUrl;
});

test('provider configuration adapts to custom or openai provider', () => {
  process.env.AI_PROVIDER = 'openai';
  process.env.AI_BASE_URL = 'https://api.openai.com/v1';
  process.env.AI_MODEL = 'gpt-4o-mini';

  const conf = ai.getConfig();
  assert.equal(conf.provider, 'openai');
  assert.equal(conf.baseUrl, 'https://api.openai.com/v1');
  assert.equal(conf.model, 'gpt-4o-mini');
});

test('handles missing API key honestly without making network requests', async () => {
  process.env.AI_API_KEY = '';
  assert.equal(ai.isAIEnabled(), false);

  const res = await ai.chat([{ role: 'user', content: 'Hello' }]);
  assert.equal(res, null);
});

test('successful real-provider response using mocked API', async () => {
  process.env.AI_PROVIDER = 'custom';
  process.env.AI_BASE_URL = mockBaseUrl;
  process.env.AI_API_KEY = 'mock-valid-key-12345';
  process.env.AI_MODEL = 'test-model';

  mockResponseStatusCode = 200;
  mockResponseBody = {
    choices: [
      {
        message: {
          role: 'assistant',
          content: 'Hello! I am your AI support agent.'
        }
      }
    ]
  };
  mockDelayMs = 0;

  const reply = await ai.chat([{ role: 'user', content: 'Hi' }]);
  assert.equal(reply, 'Hello! I am your AI support agent.');
});

test('handles invalid API key (401/403) gracefully', async () => {
  process.env.AI_BASE_URL = mockBaseUrl;
  process.env.AI_API_KEY = 'invalid-key';

  mockResponseStatusCode = 401;
  mockResponseBody = { error: { message: 'Invalid API Key' } };

  const reply = await ai.chat([{ role: 'user', content: 'Hi' }]);
  assert.equal(reply, null);
});

test('handles provider rate limit (429) gracefully', async () => {
  process.env.AI_BASE_URL = mockBaseUrl;
  process.env.AI_API_KEY = 'mock-key';

  mockResponseStatusCode = 429;
  mockResponseBody = { error: { message: 'Rate limit exceeded' } };

  const reply = await ai.chat([{ role: 'user', content: 'Hi' }]);
  assert.equal(reply, null);
});

test('handles provider outage / server error (500) gracefully', async () => {
  process.env.AI_BASE_URL = mockBaseUrl;
  process.env.AI_API_KEY = 'mock-key';

  mockResponseStatusCode = 500;
  mockResponseBody = { error: { message: 'Internal Server Error' } };

  const reply = await ai.chat([{ role: 'user', content: 'Hi' }]);
  assert.equal(reply, null);
});

test('handles provider request timeout gracefully', async () => {
  process.env.AI_BASE_URL = mockBaseUrl;
  process.env.AI_API_KEY = 'mock-key';

  mockResponseStatusCode = 200;
  mockResponseBody = { choices: [{ message: { content: 'Delayed response' } }] };
  mockDelayMs = 300;

  // Set timeoutMs to 50ms so it aborts early
  const reply = await ai.chat([{ role: 'user', content: 'Hi' }], { timeoutMs: 50 });
  assert.equal(reply, null);
  mockDelayMs = 0;
});

test('handles malformed provider response (not JSON or missing choices)', async () => {
  process.env.AI_BASE_URL = mockBaseUrl;
  process.env.AI_API_KEY = 'mock-key';

  mockResponseStatusCode = 200;
  mockResponseBody = { unexpected: 'format' };

  const reply = await ai.chat([{ role: 'user', content: 'Hi' }]);
  assert.equal(reply, null);
});

test('copilot structured case analysis validates schema and enum constraints', async () => {
  process.env.AI_BASE_URL = mockBaseUrl;
  process.env.AI_API_KEY = 'mock-key';

  mockResponseStatusCode = 200;
  mockResponseBody = {
    choices: [
      {
        message: {
          role: 'assistant',
          content: JSON.stringify({
            summary: 'The laptop battery overheated and began to smoke upon first charge.',
            missingInformation: ['Photos of serial number', 'Exact charger model used'],
            suggestedQuestions: ['Was the original charger used?', 'Are there visible scorch marks?'],
            verifiedHistorySummary: 'Customer submitted safety issue with high severity.',
            recommendedNextAction: 'Immediately escalate to safety engineering and do not attempt to ship battery.',
            suggestedPriority: 'Critical',
            priorityExplanation: 'Plausible thermal hazard involving lithium-ion battery.',
            draftCustomerResponse: 'Dear Customer, we take safety reports with utmost urgency. Please disconnect the unit and keep it on a non-flammable surface.',
            escalationRecommendation: true,
            escalationReason: 'Thermal runaway hazard'
          })
        }
      }
    ]
  };

  const copilot = await ai.copilotAnalyzeCase({
    id: 'PL-TEST1',
    product: 'Laptop Battery Pack',
    description: 'Battery smoking',
    issueType: 'Damaged item',
    priorityBand: 'Critical'
  });

  assert.ok(copilot);
  assert.equal(copilot.suggestedPriority, 'Critical');
  assert.equal(copilot.escalationRecommendation, true);
  assert.deepEqual(copilot.missingInformation, ['Photos of serial number', 'Exact charger model used']);
  assert.match(copilot.draftCustomerResponse, /safety reports with utmost urgency/);
});
