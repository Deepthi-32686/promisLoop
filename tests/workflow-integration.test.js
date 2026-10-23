const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'promiseloop-workflow-test-'));
process.env.PROMISELOOP_DATA_DIR = path.join(tempDir, 'data');
process.env.PROMISELOOP_UPLOAD_DIR = path.join(tempDir, 'uploads');
process.env.SUPPORT_AGENT_EMAIL = 'agent@promiseloop.local';
process.env.SUPPORT_AGENT_PASSWORD = 'SupportDemo2026!';
process.env.SUPPORT_MANAGER_EMAIL = 'manager@promiseloop.local';
process.env.SUPPORT_MANAGER_PASSWORD = 'ManagerDemo2026!';

const { app, readCases, writeCases, ensureDataFiles } = require('../server/index.js');
const policy = require('../server/policy.js');

let server, base;
let mockAIServer, mockAIBaseUrl;
let mockAICallCount = 0;

before(async () => {
  // Start mock AI server
  mockAIServer = http.createServer((req, res) => {
    mockAICallCount++;
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'I verified your case details. According to our approved 30-day return policy, replacements are available for damaged items upon photo verification.'
            }
          }
        ]
      }));
    });
  });
  await new Promise(r => mockAIServer.listen(0, r));
  mockAIBaseUrl = `http://127.0.0.1:${mockAIServer.address().port}/v1`;

  // Start app server
  server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise(r => server.close(r));
  await new Promise(r => mockAIServer.close(r));
  fs.rmSync(tempDir, { recursive: true, force: true });
});

async function json(url, opts = {}) {
  const r = await fetch(base + url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) }
  });
  let body;
  try { body = await r.json(); } catch { body = null; }
  return { status: r.status, body, headers: r.headers };
}

const auth = token => ({ authorization: `Bearer ${token}` });

// Minimal 1x1 PNG fixture
const pngData = 'data:image/png;base64,' + Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00
]).toString('base64');

test('missing data directory and cases.json initialize safely without error', () => {
  const freshTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'promiseloop-init-test-'));
  const origDataDir = process.env.PROMISELOOP_DATA_DIR;
  process.env.PROMISELOOP_DATA_DIR = path.join(freshTemp, 'new-data');

  ensureDataFiles();
  assert.ok(fs.existsSync(path.join(freshTemp, 'new-data', 'cases.json')));
  assert.ok(fs.existsSync(path.join(freshTemp, 'new-data', 'users.json')));

  process.env.PROMISELOOP_DATA_DIR = origDataDir;
  fs.rmSync(freshTemp, { recursive: true, force: true });
});

test('approved policy source delivers verified return and refund guidelines', () => {
  assert.equal(policy.isPolicySourceAvailable(), true);
  const policies = policy.getApprovedPolicies();
  assert.ok(policies.returnsAndReplacements);
  assert.equal(policies.returnsAndReplacements.returnWindowDays, 30);
  assert.ok(policies.refundProcessing);

  const searchResults = policy.searchPolicies('refund');
  assert.ok(searchResults.length > 0);
});

test('customer registration, login, and auth token issuance', async () => {
  const reg = await json('/api/customer/register', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Alice Customer',
      email: 'alice@example.com',
      password: 'SecurePassword2026!'
    })
  });
  assert.equal(reg.status, 201);
  assert.ok(reg.body.token);
  assert.equal(reg.body.user.email, 'alice@example.com');
  assert.equal(reg.body.user.role, 'customer');

  const login = await json('/api/customer/login', {
    method: 'POST',
    body: JSON.stringify({
      email: 'alice@example.com',
      password: 'SecurePassword2026!'
    })
  });
  assert.equal(login.status, 200);
  assert.ok(login.body.token);
});

test('agent and manager login authentication separation', async () => {
  // Invalid credentials
  const bad = await json('/api/agent/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'unknown@example.com', password: 'wrong' })
  });
  assert.equal(bad.status, 401);

  // Agent login
  const agentLogin = await json('/api/agent/login', {
    method: 'POST',
    body: JSON.stringify({
      email: 'agent@promiseloop.local',
      password: 'SupportDemo2026!'
    })
  });
  assert.equal(agentLogin.status, 200);
  assert.equal(agentLogin.body.agent.role, 'agent');

  // Manager login
  const managerLogin = await json('/api/agent/login', {
    method: 'POST',
    body: JSON.stringify({
      email: 'manager@promiseloop.local',
      password: 'ManagerDemo2026!'
    })
  });
  assert.equal(managerLogin.status, 200);
  assert.equal(managerLogin.body.agent.role, 'manager');
});

test('full end-to-end case creation, photo upload, queue visibility, and resolution workflow', async () => {
  // 1. Customer signs in
  const customerReg = await json('/api/customer/register', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Bob Buyer',
      email: 'bob@example.com',
      password: 'BobSecurePassword2026!'
    })
  });
  const customerToken = customerReg.body.token;

  // 2. Customer creates case with actual image attachment
  const createCase = await json('/api/customer/cases', {
    method: 'POST',
    headers: auth(customerToken),
    body: JSON.stringify({
      title: 'Cracked Monitor Screen',
      category: 'Damaged item',
      description: 'The monitor screen arrived shattered in the box with visible glass cracks.',
      orderRef: 'ORD-9912',
      images: [
        { name: 'screen-crack.png', data: pngData }
      ]
    })
  });
  assert.equal(createCase.status, 201);
  const createdCase = createCase.body.case;
  assert.ok(createdCase.id);
  assert.match(createdCase.id, /^PL-[A-F0-9]+/);
  assert.equal(createdCase.priorityBand, 'Low'); // 18 impact + 5 time = 23 (Low band: 0-29)
  assert.equal(createdCase.priorityScore, 23);

  // 3. Customer downloads their own attachment
  const attachUrl = createdCase.attachments[0].url;
  const dl = await fetch(base + attachUrl, { headers: auth(customerToken) });
  assert.equal(dl.status, 200);
  assert.equal(dl.headers.get('content-type'), 'image/png');

  // 4. Another customer cannot download Bob's attachment
  const eveReg = await json('/api/customer/register', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Eve Intruder',
      email: 'eve@example.com',
      password: 'EveSecurePassword2026!'
    })
  });
  const eveToken = eveReg.body.token;
  const eveDl = await json(attachUrl, { headers: auth(eveToken) });
  assert.equal(eveDl.status, 404);

  // 5. Authorized agent sees the case in queue
  const agentLogin = await json('/api/agent/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'agent@promiseloop.local', password: 'SupportDemo2026!' })
  });
  const agentToken = agentLogin.body.token;

  const queue = await json('/api/agent/cases', { headers: auth(agentToken) });
  assert.equal(queue.status, 200);
  const foundInQueue = queue.body.find(c => c.id === createdCase.id);
  assert.ok(foundInQueue);
  assert.equal(foundInQueue.customerEmail, 'bob@example.com');

  // 6. Agent posts internal note and customer-visible message
  const internalNote = await json(`/api/agent/cases/${createdCase.id}/messages`, {
    method: 'POST',
    headers: auth(agentToken),
    body: JSON.stringify({ visibility: 'internal', text: 'Confirmed carrier box damage code.' })
  });
  assert.equal(internalNote.status, 201);

  const customerMsg = await json(`/api/agent/cases/${createdCase.id}/messages`, {
    method: 'POST',
    headers: auth(agentToken),
    body: JSON.stringify({ visibility: 'customer', text: 'We have approved an expedited replacement for your monitor.' })
  });
  assert.equal(customerMsg.status, 201);

  // 7. Verify customer case retrieval strictly excludes internal note
  const customerCases = await json('/api/customer/cases', { headers: auth(customerToken) });
  assert.equal(customerCases.status, 200);
  const bobCase = customerCases.body.find(c => c.id === createdCase.id);
  assert.ok(bobCase);
  const bobCaseStr = JSON.stringify(bobCase);
  assert.equal(bobCaseStr.includes('Confirmed carrier box damage code.'), false);
  assert.equal(bobCaseStr.includes('internalNotes'), false);
  assert.ok(bobCaseStr.includes('We have approved an expedited replacement'));

  // 8. Agent resolves the case
  const resolved = await json(`/api/agent/cases/${createdCase.id}`, {
    method: 'PATCH',
    headers: auth(agentToken),
    body: JSON.stringify({
      status: 'Resolved',
      resolution: 'Replacement monitor shipped via express carrier. Tracking: EXP-5510.'
    })
  });
  assert.equal(resolved.status, 200);
  assert.equal(resolved.body.case.status, 'Resolved');

  // 9. Verified case persistence survives simulated server restart
  const allCases = readCases();
  const persisted = allCases.find(c => c.id === createdCase.id);
  assert.ok(persisted);
  assert.equal(persisted.status, 'Resolved');
  assert.equal(persisted.resolution, 'Replacement monitor shipped via express carrier. Tracking: EXP-5510.');
});

test('manager-only priority override enforcement and audit trail', async () => {
  const customerReg = await json('/api/customer/register', {
    method: 'POST',
    body: JSON.stringify({ name: 'Charlie', email: 'charlie@example.com', password: 'CharliePassword2026!' })
  });
  const created = await json('/api/customer/cases', {
    method: 'POST',
    headers: auth(customerReg.body.token),
    body: JSON.stringify({
      title: 'Late parcel',
      category: 'Delivery problem',
      description: 'The shipment is 2 days late.'
    })
  });
  const caseId = created.body.case.id;

  const agentLogin = await json('/api/agent/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'agent@promiseloop.local', password: 'SupportDemo2026!' })
  });
  // Regular agent override rejected (HTTP 403)
  const agentOverride = await json(`/api/agent/cases/${caseId}`, {
    method: 'PATCH',
    headers: auth(agentLogin.body.token),
    body: JSON.stringify({ priority: 'Critical', reason: 'agent attempt' })
  });
  assert.equal(agentOverride.status, 403);

  // Manager override accepted
  const managerLogin = await json('/api/agent/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'manager@promiseloop.local', password: 'ManagerDemo2026!' })
  });
  const managerOverride = await json(`/api/agent/cases/${caseId}`, {
    method: 'PATCH',
    headers: auth(managerLogin.body.token),
    body: JSON.stringify({ priority: 'Critical', reason: 'High-value customer VIP exception' })
  });
  assert.equal(managerOverride.status, 200);
  assert.equal(managerOverride.body.case.priorityBand, 'Critical');
  assert.equal(managerOverride.body.case.overrideActive, true);
});

test('customer assistant responds accurately with real AI provider when configured', async () => {
  process.env.AI_PROVIDER = 'custom';
  process.env.AI_BASE_URL = mockAIBaseUrl;
  process.env.AI_API_KEY = 'valid-test-key';
  process.env.AI_MODEL = 'mock-model';

  const customerReg = await json('/api/customer/register', {
    method: 'POST',
    body: JSON.stringify({ name: 'David', email: 'david@example.com', password: 'DavidPassword2026!' })
  });

  const assist = await json('/api/customer/assistant', {
    method: 'POST',
    headers: auth(customerReg.body.token),
    body: JSON.stringify({ message: 'What is your replacement policy for damaged products?' })
  });

  assert.equal(assist.status, 200);
  assert.equal(assist.body.ai, true);
  assert.match(assist.body.reply, /approved 30-day return policy/);
});

test('agent copilot returns structured case analysis', async () => {
  const agentLogin = await json('/api/agent/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'agent@promiseloop.local', password: 'SupportDemo2026!' })
  });

  const all = readCases();
  assert.ok(all.length > 0);
  const sampleCase = all[0];

  const copilot = await json('/api/agent/copilot', {
    method: 'POST',
    headers: auth(agentLogin.body.token),
    body: JSON.stringify({ caseId: sampleCase.id })
  });

  assert.equal(copilot.status, 200);
  assert.ok(copilot.body.analysis);
  assert.ok(copilot.body.analysis.summary);
  assert.ok(Array.isArray(copilot.body.analysis.missingInformation));
  assert.ok(copilot.body.analysis.recommendedNextAction);
  assert.ok(copilot.body.analysis.draftCustomerResponse);
});
