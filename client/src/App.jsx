import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CustomerPortal from './CustomerPortal';
import AgentPortal from './AgentPortal';

const API = '/api';
const quickPrompts = [
  'Which case is most urgent?',
  'What should I do next?',
  'Show all my cases'
];
const statusOptions = ['Action needed', 'Waiting for customer', 'In progress', 'Resolved', 'Closed'];
const fmtDate = (value) => value ? new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Not set';
const relativeDeadline = (c) => {
  if (c.daysLeft == null) return 'No deadline';
  if (c.daysLeft < 0) return `${Math.abs(c.daysLeft)}d overdue`;
  if (c.daysLeft === 0) return 'Due today';
  return `${c.daysLeft}d left`;
};

function AgentDashboard() {
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [chat, setChat] = useState([{ role: 'assistant', text: 'Hi! I’m PromiseLoop, your delivery-resolution assistant. Tell me what went wrong, ask what to do next, or ask which deadline needs attention.' }]);
  const [formOpen, setFormOpen] = useState(false);
  const emptyForm = { product: '', issueType: 'Damaged item', description: '', deliveryDate: new Date().toISOString().slice(0, 10), requestedDeadline: '', orderRef: '', impact: '', vulnerability: 'none', priorContacts: 0 };
  const [form, setForm] = useState(emptyForm);
  const [caseBusy, setCaseBusy] = useState('');
  const [aiInfo, setAiInfo] = useState({ enabled: false, provider: '', model: '' });
  const chatEnd = useRef(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${API}/cases`);
      if (!res.ok) throw new Error('API request failed');
      setCases(await res.json()); setApiError('');
    } catch {
      setApiError('Cannot reach the local API. Start the app with npm run dev.');
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { fetch(`${API}/health`).then(r => r.json()).then(d => setAiInfo(d.ai || { enabled: false })).catch(() => {}); }, []);
  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [chat]);

  const selected = cases.find(c => c.id === selectedId) || cases[0] || null;
  const openCases = useMemo(() => cases.filter(c => !['Resolved', 'Closed'].includes(c.status)), [cases]);
  const urgentCount = openCases.filter(c => ['Critical', 'Overdue'].includes(c.urgency)).length;
  const resolvedCount = cases.filter(c => ['Resolved', 'Closed'].includes(c.status)).length;
  const highestRisk = [...openCases].sort((a, b) => b.priorityScore - a.priorityScore)[0];

  async function sendMessage(text = message) {
    const clean = text.trim(); if (!clean || sending) return;
    setChat(prev => [...prev, { role: 'user', text: clean }]); setMessage(''); setSending(true);
    try {
      const res = await fetch(`${API}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: clean }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Assistant request failed');
      setChat(prev => [...prev, { role: 'assistant', text: data.reply, actions: data.actions || [] }]);
      if (data.case?.id) setSelectedId(data.case.id);
      await refresh();
    } catch (e) { setChat(prev => [...prev, { role: 'assistant', text: `I couldn't reach the assistant service: ${e.message}` }]); }
    finally { setSending(false); }
  }

  async function createCase(e) {
    e.preventDefault(); setCaseBusy('create');
    try {
      const res = await fetch(`${API}/cases`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const data = await res.json(); if (!res.ok) throw new Error(data.error || 'Could not create case');
      setFormOpen(false); setForm(emptyForm);
      setSelectedId(data.id); await refresh();
      setChat(prev => [...prev, { role: 'assistant', text: `Case ${data.id} created. Priority ${data.priorityBand} (${data.priorityScore}/100): ${data.priorityReasons.join(' ')}` }]);
    } catch (e) { setApiError(e.message); }
    finally { setCaseBusy(''); }
  }

  async function patchCase(id, body) {
    setCaseBusy(id);
    try {
      const res = await fetch(`${API}/cases/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json(); if (!res.ok) throw new Error(data.error || 'Update failed');
      await refresh(); setSelectedId(id);
    } catch (e) { setApiError(e.message); }
    finally { setCaseBusy(''); }
  }

  async function overridePriority(id) {
    const band = window.prompt('Override priority to (Critical / High / Medium / Low):', 'High');
    if (!band) return;
    const reason = window.prompt('Recorded reason for the override (required for audit):');
    if (!reason?.trim()) { setApiError('An override requires a reason.'); return; }
    await patchCase(id, { override: { band: band.trim(), by: 'Support manager', reason: reason.trim() } });
  }

  function askWhy(id) { sendMessage(`why is ${id} that priority?`); }

  async function detectWithAI() {
    if (!form.description.trim()) { setApiError('Describe the problem first, then detect.'); return; }
    setCaseBusy('ai');
    try {
      const res = await fetch(`${API}/ai/classify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: form.description }) });
      const d = await res.json();
      setForm(f => ({ ...f, issueType: d.issueType || f.issueType, impact: d.impact || f.impact, vulnerability: d.vulnerability || f.vulnerability }));
      setChat(prev => [...prev, { role: 'assistant', text: `${d.ai ? '[AI] ' : '[rules] '}Classified as ${d.issueType} · impact ${d.impact} · vulnerability ${d.vulnerability}.${d.summary ? ' ' + d.summary : ''}` }]);
    } catch (e) { setApiError('Classify failed: ' + e.message); }
    finally { setCaseBusy(''); }
  }

  function addEvidence() {
    if (!selected) return;
    const note = window.prompt('Describe the evidence or action taken (for example: “Photo of damaged box taken”).');
    if (note?.trim()) patchCase(selected.id, { evidence: note.trim() });
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><span className="brand-loop">∞</span></div><div><div className="brand-name">PromiseLoop<span> AI</span></div><div className="brand-tag">THE AGENT THAT DOESN’T FORGET</div></div></div>
      <div className="workspace-label">WORKSPACE</div>
      <button className="nav-item active"><span className="nav-icon">▦</span> Resolution overview <span className="nav-pill">LIVE</span></button>
      <button className="nav-item" onClick={() => setFormOpen(true)}><span className="nav-icon">＋</span> Create a case</button>
      <div className="sidebar-divider" />
      <div className="workspace-label">YOUR QUEUE <span className="queue-count">{openCases.length}</span></div>
      <div className="queue-list">
        {cases.map(c => <button key={c.id} className={`queue-item ${selected?.id === c.id ? 'selected' : ''}`} onClick={() => setSelectedId(c.id)}><span className={`queue-dot ${c.urgency === 'Critical' || c.urgency === 'Overdue' ? 'red' : c.urgency === 'Soon' ? 'amber' : 'blue'}`} /><span className="queue-copy"><span className="queue-product">{c.product}</span><span className="queue-meta">{c.id} · {c.status}</span></span><span className="queue-time">{relativeDeadline(c)}</span></button>)}
        {!cases.length && !loading && <div className="empty-queue">Your queue is clear. Create your first case.</div>}
      </div>
      <div className="sidebar-bottom"><div className="demo-indicator"><span className="pulse" /> Demo environment</div><div className="profile"><div className="avatar">PL</div><div><div className="profile-name">Personal workspace</div><div className="profile-sub">Local demo data</div></div><span className="profile-menu">•••</span></div></div>
    </aside>

    <main className="main-content">
      <header className="topbar"><div className="breadcrumb">Workspace <span>/</span> <strong>Resolution overview</strong></div><div className="top-actions"><div className={`ai-chip ${aiInfo.enabled ? 'on' : 'off'}`} title={aiInfo.enabled ? `Live model: ${aiInfo.model} via ${aiInfo.provider}` : 'Set AI_API_KEY to enable the live model'}><span className="ai-dot" /> {aiInfo.enabled ? `AI AGENT LIVE · ${aiInfo.model}` : 'RULE-BASED · no AI key'}</div><div className="secure-label"><span>◆</span> Context saved locally</div><button className="icon-button" title="Refresh cases" onClick={refresh}>↻</button><div className="top-avatar">PL</div></div></header>
      <div className="page-content">
        <section className="welcome-row"><div><div className="eyebrow"><span className="eyebrow-dot" /> POST-DELIVERY INTELLIGENCE</div><h1>Close the loop.<br/><span>Not just the delivery.</span></h1><p className="welcome-sub">One place to turn delivery problems into clear, trackable next steps.</p></div><button className="primary-button" onClick={() => setFormOpen(true)}><span>＋</span> New resolution case</button></section>

        {apiError && <div className="error-banner"><span>!</span>{apiError}</div>}

        <section className="metrics-grid">
          <Metric label="OPEN RESOLUTION CASES" value={openCases.length} note="Needs attention" icon="◷" tone="violet" />
          <Metric label="DEADLINE AT RISK" value={urgentCount} note={urgentCount ? 'Critical or overdue' : 'No critical deadlines'} icon="⚑" tone={urgentCount ? 'rose' : 'green'} />
          <Metric label="RESOLVED CASES" value={resolvedCount} note="Closed successfully" icon="✓" tone="green" />
          <Metric label="TOP PRIORITY CASE" value={highestRisk ? `${highestRisk.priorityBand}` : '—'} note={highestRisk ? `${highestRisk.priorityScore}/100 · ${highestRisk.urgency}` : 'No open cases'} icon="⌁" tone="amber" />
        </section>

        <div className="content-grid">
          <section className="panel cases-panel">
            <div className="panel-heading"><div><div className="panel-kicker">CASE MANAGEMENT</div><h2>Resolution queue</h2><p>Cases are ranked by the priority engine, so the case that genuinely needs attention stays on top.</p></div><button className="text-button" onClick={() => setFormOpen(true)}>＋ Add case</button></div>
            <div className="case-table-wrap"><table className="case-table"><thead><tr><th>CASE / PRODUCT</th><th>STATUS</th><th>SLA DEADLINE</th><th>PRIORITY</th></tr></thead><tbody>
              {cases.map(c => <tr key={c.id} className={selected?.id === c.id ? 'row-selected' : ''} onClick={() => setSelectedId(c.id)}><td><div className="case-product-cell"><div className="product-thumb">{productIcon(c.issueType)}</div><div><div className="product-name">{c.product}</div><div className="case-id">{c.id} <span>·</span> {c.issueType}</div></div></div></td><td><StatusPill status={c.status}/></td><td><div className={`deadline-text ${c.urgency === 'Critical' || c.urgency === 'Overdue' ? 'deadline-danger' : c.urgency === 'Soon' ? 'deadline-warn' : ''}`}>{relativeDeadline(c)}</div><div className="deadline-date">{fmtDate(c.slaDeadline?.slice(0, 10) || c.requestedDeadline)}</div></td><td><PriorityCell score={c.priorityScore} band={c.priorityBand} overridden={c.overrideActive}/></td></tr>)}
              {!cases.length && <tr><td colSpan="4" className="empty-table">{loading ? 'Loading cases…' : 'No cases yet. Create a case to start tracking a resolution.'}</td></tr>}
            </tbody></table></div>
            <div className="table-footer"><span>Showing <strong>{cases.length}</strong> cases</span><span><i className="legend-dot"/> Risk score updates from deadline and case status</span></div>
          </section>

          <section className="panel detail-panel">
            <div className="panel-heading detail-heading"><div><div className="panel-kicker">CASE INSIGHT</div><h2>Resolution details</h2></div><span className="live-chip"><span/> LIVE</span></div>
            {selected ? <>
              <div className="detail-product"><div className="detail-product-icon">{productIcon(selected.issueType)}</div><div className="detail-product-copy"><h3>{selected.product}</h3><div className="case-id">{selected.id} <span>·</span> Order {selected.orderRef}</div></div><StatusPill status={selected.status}/></div>
              <div className="issue-box"><div className="issue-label"><span className="tiny-alert">!</span> REPORTED ISSUE</div><p>{selected.description}</p><div className="issue-type-label">{selected.issueType}</div></div>
              <div className="priority-card"><div className="priority-head"><div><div className="panel-kicker">PRIORITY ENGINE</div><div className="priority-band-row"><PriorityBadge band={selected.priorityBand}/>{selected.overrideActive && <span className="override-chip">OVERRIDDEN</span>}</div></div><div className="priority-score">{selected.priorityScore}<span>/100</span></div></div>
                <div className="breakdown">{[['Impact', selected.priorityBreakdown.impact, 40], ['Time vs SLA', selected.priorityBreakdown.time, 25], ['Vulnerability', selected.priorityBreakdown.vulnerability, 20], ['Repeated', selected.priorityBreakdown.repeat, 15]].map(([label, val, max]) => <div className="break-row" key={label}><span>{label}</span><div className="break-track"><div className="break-fill" style={{ width: `${(val / max) * 100}%` }}/></div><b>{val}/{max}</b></div>)}</div>
                <ul className="priority-reasons">{selected.priorityReasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
              </div>
              <div className="deadline-card"><div className="deadline-icon">◷</div><div className="deadline-main"><span>System SLA target</span><strong>{fmtDate(selected.slaDeadline?.slice(0, 10))}</strong><span className="sla-note">Customer requested: {selected.requestedDeadline ? fmtDate(selected.requestedDeadline) : '—'} (does not set priority)</span></div><div className={`deadline-badge ${selected.urgency === 'Critical' || selected.urgency === 'Overdue' ? 'danger' : selected.urgency === 'Soon' ? 'warn' : ''}`}>{relativeDeadline(selected)}</div></div>
              <div className="next-action"><div className="next-action-head"><div className="next-action-icon">✦</div><div><div className="panel-kicker">AGENT RECOMMENDATION</div><h3>Suggested next action</h3></div></div><p>{selected.nextAction}</p><div className="agent-reason"><span>◈</span> Deterministic rule-based agent — no external AI model is called.</div></div>
              <div className="detail-buttons"><button className="secondary-button" onClick={addEvidence} disabled={!!caseBusy}>＋ Record evidence</button><button className="secondary-button" onClick={() => askWhy(selected.id)} disabled={!!caseBusy}>◈ Explain priority</button><button className="secondary-button" onClick={() => overridePriority(selected.id)} disabled={!!caseBusy}>⚑ Override</button><select aria-label="Update case status" className="status-select" value={selected.status} disabled={!!caseBusy} onChange={e => patchCase(selected.id, { status: e.target.value })}>{statusOptions.map(s => <option key={s}>{s}</option>)}</select></div>
              <div className="history-section"><div className="history-heading"><h3>Case history</h3><span>{(selected.history || []).length} events</span></div><div className="history-list">{[...(selected.history || [])].reverse().slice(0, 4).map((h, i) => <div className="history-item" key={`${h.at}-${i}`}><span className={`history-dot ${i === 0 ? 'latest' : ''}`}/><div><p>{h.text}</p><time>{new Date(h.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</time></div></div>)}</div></div>
            </> : <div className="empty-detail">Choose a case to see its timeline and next action.</div>}
          </section>
        </div>

        <section className="assistant-panel panel"><div className="assistant-intro"><div className="assistant-symbol"><span>∞</span><i/></div><div><div className="assistant-title-line"><h2>PromiseLoop agent</h2><span className="simulated-chip">SIMULATED AGENT</span></div><p>A context-aware assistant that remembers cases and helps decide what to do next.</p></div></div><div className="chat-area"><div className="chat-messages">{chat.map((m, i) => <div className={`chat-message ${m.role}`} key={i}><div className={`chat-avatar ${m.role}`}>{m.role === 'assistant' ? '∞' : 'YOU'}</div><div className="chat-bubble"><div className="chat-role">{m.role === 'assistant' ? 'PROMISELOOP' : 'YOU'} <span>{m.role === 'assistant' ? '· RULE-BASED AGENT' : ''}</span></div><p>{m.text}</p>{m.actions?.length > 0 && <div className="action-tags">{m.actions.map(a => <span key={a}>✓ {a.replaceAll('_', ' ')}</span>)}</div>}</div></div>)}{sending && <div className="typing"><span/><span/><span/> Agent is thinking through your case…</div>}<div ref={chatEnd}/></div></div><div className="quick-prompts">{quickPrompts.map(q => <button key={q} onClick={() => sendMessage(q)} disabled={sending}>{q} <span>↗</span></button>)}</div><form className="chat-input-row" onSubmit={e => { e.preventDefault(); sendMessage(); }}><span className="input-spark">✦</span><input value={message} onChange={e => setMessage(e.target.value)} placeholder="Tell me what happened, or ask about a case…" aria-label="Message PromiseLoop agent"/><button type="submit" className="send-button" disabled={sending || !message.trim()} aria-label="Send message">↑</button></form><div className="assistant-footnote"><span>◈</span> Demo mode: uses local sample records and deterministic rules. No live Amazon account or order API is connected.</div></section>
        <footer className="footer"><span>PromiseLoop AI <span className="footer-dot">·</span> Hackathon prototype</span><span>Built for better post-delivery resolution <span className="footer-heart">✦</span></span></footer>
      </div>
    </main>

    {formOpen && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setFormOpen(false); }}><form className="case-modal" onSubmit={createCase}><div className="modal-heading"><div><div className="panel-kicker">NEW WORKFLOW</div><h2>Create a resolution case</h2><p>Capture the problem and let the agent suggest the next step.</p></div><button type="button" className="modal-close" onClick={() => setFormOpen(false)}>×</button></div><label>Product name<input required value={form.product} onChange={e => setForm({ ...form, product: e.target.value })} placeholder="e.g. Wireless headphones"/></label><label>Issue type<select value={form.issueType} onChange={e => setForm({ ...form, issueType: e.target.value })}><option>Damaged item</option><option>Missing item</option><option>Wrong item</option><option>Delivery problem</option><option>Other issue</option></select></label><label>What happened?<textarea required rows="3" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Describe the problem clearly…"/></label><div className="ai-detect-row"><button type="button" className="ai-detect-btn" onClick={detectWithAI} disabled={caseBusy === 'ai'}>✨ {caseBusy === 'ai' ? 'Detecting…' : 'Auto-detect type, impact & hardship'}</button></div><div className="form-two-col"><label>Delivery date<input type="date" value={form.deliveryDate} onChange={e => setForm({ ...form, deliveryDate: e.target.value })}/></label><label>Requested deadline <span className="optional-label">OPTIONAL</span><input type="date" value={form.requestedDeadline} onChange={e => setForm({ ...form, requestedDeadline: e.target.value })}/></label></div>
<div className="form-two-col"><label>Impact / severity<select value={form.impact} onChange={e => setForm({ ...form, impact: e.target.value })}><option value="">Auto-detect from description</option><option value="safety">Safety risk</option><option value="financial">Financial loss</option><option value="service">Service disruption</option><option value="inconvenience">Inconvenience</option></select></label><label>Customer vulnerability<select value={form.vulnerability} onChange={e => setForm({ ...form, vulnerability: e.target.value })}><option value="none">None</option><option value="moderate">Moderate hardship</option><option value="high">Severe hardship</option></select></label></div>
<label>Prior contacts / reopens <span className="optional-label">AFFECTS REPEATED-ISSUE SIGNAL</span><input type="number" min="0" max="10" value={form.priorContacts} onChange={e => setForm({ ...form, priorContacts: Number(e.target.value) || 0 })}/></label>
<label>Order reference <span className="optional-label">OPTIONAL</span><input value={form.orderRef} onChange={e => setForm({ ...form, orderRef: e.target.value })} placeholder="e.g. DEMO-1024"/></label><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setFormOpen(false)}>Cancel</button><button type="submit" className="primary-button" disabled={caseBusy === 'create'}>{caseBusy === 'create' ? 'Creating…' : 'Create case →'}</button></div></form></div>}
  </div>;
}

function Metric({ label, value, note, icon, tone }) { return <div className="metric-card"><div className="metric-top"><span>{label}</span><div className={`metric-icon ${tone}`}>{icon}</div></div><div className="metric-value">{value}</div><div className="metric-note"><span className={`note-dot ${tone}`}/>{note}</div></div>; }
function StatusPill({ status }) { const cls = status.toLowerCase().replaceAll(' ', '-'); return <span className={`status-pill ${cls}`}><i/>{status}</span>; }
function bandTone(band = '') { return { Critical: 'critical', High: 'high', Medium: 'medium', Low: 'low' }[band] || 'low'; }
function PriorityBadge({ band }) { return <span className={`priority-badge ${bandTone(band)}`}>{band}</span>; }
function PriorityCell({ score, band, overridden }) { return <div className="risk-cell"><div className="risk-number">{score}<span>/100</span></div><div className="risk-track"><div className={`risk-fill ${bandTone(band)}`} style={{ width: `${score}%` }}/></div><div className="band-line"><PriorityBadge band={band}/>{overridden && <span className="override-chip sm">OVR</span>}</div></div>; }
function productIcon(type = '') { const t = type.toLowerCase(); if (t.includes('damag')) return '◇'; if (t.includes('miss')) return '□'; if (t.includes('wrong')) return '↔'; if (t.includes('deliver')) return '⌁'; return '▧'; }

export default function App() {
  const isAgentWorkspace = new URLSearchParams(window.location.search).get('workspace') === 'agent';
  return isAgentWorkspace ? <AgentPortal /> : <CustomerPortal />;
}
