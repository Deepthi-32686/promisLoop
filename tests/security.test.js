const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'promiseloop-test-'));
process.env.PROMISELOOP_DATA_DIR = path.join(temp, 'data');
process.env.PROMISELOOP_UPLOAD_DIR = path.join(temp, 'uploads');
process.env.SUPPORT_AGENT_EMAIL = 'agent@test.local';
process.env.SUPPORT_AGENT_PASSWORD = 'TestAgentPassword2026!';
process.env.AI_API_KEY = '';
const { app, safeImageData } = require('../server/index.js');
let server, base;
before(async () => { server = app.listen(0); await new Promise(r => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}`; });
after(async () => { await new Promise(r => server.close(r)); fs.rmSync(temp, { recursive: true, force: true }); });
async function json(url, opts={}) { const r = await fetch(base+url, { ...opts, headers: { 'content-type':'application/json', ...(opts.headers||{}) } }); let body; try { body=await r.json(); } catch { body=null; } return {status:r.status, body, headers:r.headers}; }
async function register(email) { const r=await json('/api/customer/register',{method:'POST',body:JSON.stringify({name:'Test User',email,password:'TestPassword123'})}); assert.equal(r.status,201); return r.body.token; }
const auth = token => ({authorization:`Bearer ${token}`});
// Minimal signature-bearing fixtures exercise server-side MIME/signature checks without external packages.
const pngData = 'data:image/png;base64,' + Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0x00,0x00,0x00,0x00]).toString('base64');
test('server rejects unsupported MIME and content mismatch', () => {
  assert.throws(() => safeImageData({data:'data:image/svg+xml;base64,PHN2Zz4='}), /Unsupported image/);
  assert.throws(() => safeImageData({data:'data:image/png;base64,SGVsbG8='}), /does not match/);
});
test('server rejects oversized image before decoding', () => {
  const tooBig = 'data:image/png;base64,' + 'A'.repeat(Math.ceil(3*1024*1024*4/3)+20);
  assert.throws(() => safeImageData({data:tooBig}), /smaller than 3 MB/);
});
test('authenticated upload persists and attachment retrieval is owner-restricted', async () => {
  const tokenA=await register('a@example.test'), tokenB=await register('b@example.test');
  const create=await json('/api/customer/cases',{method:'POST',headers:auth(tokenA),body:JSON.stringify({title:'Damaged delivery',description:'The package arrived damaged and needs investigation.',category:'Damaged item',images:[{name:'../private.png',data:pngData}]})});
  assert.equal(create.status,201,JSON.stringify(create.body));
  const c=create.body.case, a=c.attachments[0]; assert.ok(c.id); assert.ok(a.id);
  const owner=await fetch(base+a.url,{headers:auth(tokenA)}); assert.equal(owner.status,200); assert.match(owner.headers.get('content-type'),/image\/png/);
  const other=await json(`/api/customer/cases/${c.id}/attachments/${a.id}`,{headers:auth(tokenB)}); assert.equal(other.status,404);
  const anonymous=await json(`/api/customer/cases/${c.id}/attachments/${a.id}`); assert.equal(anonymous.status,401);
  const stored=JSON.parse(fs.readFileSync(path.join(temp,'data','cases.json'),'utf8'))[0]; assert.equal(stored.attachments[0].uploadedBy, JSON.parse(fs.readFileSync(path.join(temp,'data','users.json'),'utf8')).find(u=>u.email==='a@example.test').id);
});
test('customer cannot retrieve agent-only evidence route', async () => {
  const token=await register('c@example.test');
  const r=await json('/api/agent/cases/anything/attachments/anything',{headers:auth(token)}); assert.equal(r.status,401);
});
test('legacy unauthenticated chatbot endpoint is disabled to protect customer case data', async () => {
  const r=await json('/api/chat',{method:'POST',body:JSON.stringify({message:'Show me all customer cases'})});
  assert.equal(r.status,410); assert.match(r.body.error,/disabled for security/i);
});

test('legacy global case APIs are disabled and do not expose or mutate the queue', async () => {
  const token = await register('legacy-check@example.test');
  const listed = await json('/api/cases');
  assert.equal(listed.status, 410);
  const created = await json('/api/cases', { method: 'POST', body: JSON.stringify({ product:'Private', issueType:'Damaged item', description:'Customer should not create global cases' }) });
  assert.equal(created.status, 410);
  const mutated = await json('/api/cases/PL-1043', { method:'PATCH', body: JSON.stringify({ status:'Resolved', override:{band:'Low',reason:'tamper'} }) });
  assert.equal(mutated.status, 410);
  assert.ok(token);
});

test('support agent cannot override priority and assignment does not reset SLA deadlines', async () => {
  const customerToken = await register('sla-owner@example.test');
  const created = await json('/api/customer/cases', { method:'POST', headers:auth(customerToken), body:JSON.stringify({ title:'A damaged package', description:'The package arrived with the product broken.', category:'Damaged item' }) });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const item = created.body.case;
  assert.ok(item.firstResponseDeadline);
  assert.ok(item.resolutionDeadline);
  const login = await json('/api/agent/login', { method:'POST', body:JSON.stringify({ email:'agent@test.local', password:'TestAgentPassword2026!' }) });
  assert.equal(login.status, 200);
  assert.equal(login.body.agent.role, 'agent');
  const agentAuth = auth(login.body.token);
  const denied = await json(`/api/agent/cases/${item.id}`, { method:'PATCH', headers:agentAuth, body:JSON.stringify({ priority:'Low', reason:'try to lower priority' }) });
  assert.equal(denied.status, 403);
  const assigned = await json(`/api/agent/cases/${item.id}`, { method:'PATCH', headers:agentAuth, body:JSON.stringify({ assignedAgent:'Support Agent', assignedTeam:'General Support' }) });
  assert.equal(assigned.status, 200, JSON.stringify(assigned.body));
  assert.equal(assigned.body.case.firstResponseDeadline, item.firstResponseDeadline);
  assert.equal(assigned.body.case.resolutionDeadline, item.resolutionDeadline);
});

test('customer case API excludes internal notes and internal messages', async () => {
  const customerToken = await register('visibility-owner@example.test');
  const created = await json('/api/customer/cases', { method:'POST', headers:auth(customerToken), body:JSON.stringify({ title:'Missing adapter', description:'The adapter was not inside the delivered box.', category:'Missing item' }) });
  assert.equal(created.status, 201);
  const item = created.body.case;
  const login = await json('/api/agent/login', { method:'POST', body:JSON.stringify({ email:'agent@test.local', password:'TestAgentPassword2026!' }) });
  const agentAuth = auth(login.body.token);
  const internal = await json(`/api/agent/cases/${item.id}/messages`, { method:'POST', headers:agentAuth, body:JSON.stringify({ visibility:'internal', text:'Internal investigation note.' }) });
  assert.equal(internal.status, 201);
  const customerCases = await json('/api/customer/cases', { headers:auth(customerToken) });
  const visible = customerCases.body.find(c=>c.id===item.id);
  assert.ok(visible);
  assert.equal(JSON.stringify(visible).includes('Internal investigation note.'), false);
  assert.equal(JSON.stringify(visible).includes('internalNotes'), false);
});
