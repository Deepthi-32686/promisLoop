import React, { useEffect, useMemo, useRef, useState } from 'react';
import './agent.css';

const API = '/api';

async function call(path, token, options = {}) {
  const r = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });
  const d = await r.json().catch(() => ({ error: 'Server returned an invalid response.' }));
  if (!r.ok) throw new Error(d.error || 'Request failed');
  return d;
}

const statuses = [
  'New',
  'Triaged',
  'Assigned',
  'In Progress',
  'Waiting for Customer',
  'Waiting for Internal Action',
  'Resolved',
  'Closed'
];

export default function AgentPortal() {
  const [token, setToken] = useState(() => localStorage.getItem('pl_agent_token') || '');
  const [agent, setAgent] = useState(null);
  const [auth, setAuth] = useState({ email: 'agent@promiseloop.local', password: 'SupportDemo2026!' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [cases, setCases] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [tab, setTab] = useState('overview');
  const [reply, setReply] = useState('');
  const [note, setNote] = useState('');
  const [resolution, setResolution] = useState('');
  const [files, setFiles] = useState([]);

  // Copilot structured state
  const [copilotLoading, setCopilotLoading] = useState(false);
  const [copilotData, setCopilotData] = useState(null);
  const [aiQuestion, setAiQuestion] = useState('Summarize this case, list missing information, and recommend immediate next steps.');
  const [aiAnswer, setAiAnswer] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiHistory, setAiHistory] = useState([]);

  const fileRef = useRef(null);

  const selected = cases.find(c => c.id === selectedId) || cases[0] || null;

  async function load(t = token) {
    if (!t) return;
    try {
      const me = await call('/agent/me', t);
      setAgent(me.agent);
      const list = await call(
        `/agent/cases?q=${encodeURIComponent(q)}&status=${encodeURIComponent(statusFilter)}&priority=${encodeURIComponent(priorityFilter)}`,
        t
      );
      setCases(list);
      if (!selectedId && list.length) setSelectedId(list[0].id);
      setError('');
    } catch (e) {
      setError(e.message);
      if (/sign in|authorized/i.test(e.message)) {
        localStorage.removeItem('pl_agent_token');
        setToken('');
        setAgent(null);
      }
    }
  }

  useEffect(() => {
    if (token) load(token);
  }, [token]);

  useEffect(() => {
    if (token) {
      const timer = setTimeout(() => load(token), 180);
      return () => clearTimeout(timer);
    }
  }, [q, statusFilter, priorityFilter]);

  // When selected case changes, reset copilot
  useEffect(() => {
    setCopilotData(null);
    setAiAnswer('');
  }, [selectedId]);

  async function login(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const d = await call('/agent/login', '', { method: 'POST', body: JSON.stringify(auth) });
      localStorage.setItem('pl_agent_token', d.token);
      setToken(d.token);
      setAgent(d.agent);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function act(path, body, method = 'POST') {
    if (!selected) return;
    setBusy(true);
    setError('');
    try {
      await call(path, token, { method, body: JSON.stringify(body) });
      await load(token);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function updateStatus(e) {
    const status = e.target.value;
    if (status === selected.status) return;
    let body = { status };
    if (status === 'Resolved' || status === 'Closed') {
      const summary = window.prompt('Enter investigation and resolution summary:');
      if (!summary?.trim()) {
        e.target.value = selected.status;
        return;
      }
      body.resolution = summary;
      setResolution(summary);
    }
    await act(`/agent/cases/${selected.id}`, body, 'PATCH');
  }

  async function assign() {
    const assignedAgent = window.prompt('Assign to agent name:', selected.assignedAgent || agent?.name || 'Support Agent');
    if (!assignedAgent?.trim()) return;
    const assignedTeam = window.prompt('Support team:', selected.assignedTeam || 'General Support');
    if (!assignedTeam?.trim()) return;
    await act(`/agent/cases/${selected.id}`, { assignedAgent, assignedTeam }, 'PATCH');
  }

  async function priority() {
    const band = window.prompt('Override priority to: Critical, High, Medium, Low', selected.priorityBand);
    if (!band) return;
    const reason = window.prompt('Recorded reason for override (required for audit):');
    if (!reason?.trim()) return;
    await act(`/agent/cases/${selected.id}`, { priority: band, reason }, 'PATCH');
  }

  async function escalate() {
    const reason = window.prompt('Why should this case be escalated?');
    if (reason?.trim()) await act(`/agent/cases/${selected.id}`, { escalationReason: reason }, 'PATCH');
  }

  async function send(visibility, text, setter) {
    if (!text.trim()) return;
    await act(`/agent/cases/${selected.id}/messages`, { visibility, text });
    setter('');
  }

  async function upload() {
    if (!files.length || !selected) return;
    setBusy(true);
    setError('');
    try {
      const images = await Promise.all(
        files.map(
          file =>
            new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve({ name: file.name, data: reader.result });
              reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
              reader.readAsDataURL(file);
            })
        )
      );
      await call(`/agent/cases/${selected.id}/attachments`, token, { method: 'POST', body: JSON.stringify({ images }) });
      setFiles([]);
      if (fileRef.current) fileRef.current.value = '';
      await load(token);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  // Fetch structured AI copilot analysis
  async function runCopilotAnalysis() {
    if (!selected) return;
    setCopilotLoading(true);
    setError('');
    try {
      const res = await call('/agent/copilot', token, {
        method: 'POST',
        body: JSON.stringify({ caseId: selected.id })
      });
      setCopilotData(res);
    } catch (e) {
      setError(`Copilot analysis failed: ${e.message}`);
    } finally {
      setCopilotLoading(false);
    }
  }

  async function askAgentAI(e) {
    e.preventDefault();
    const question = aiQuestion.trim();
    if (!question) return;
    setAiBusy(true);
    setAiAnswer('');
    try {
      const d = await call('/agent/assistant', token, {
        method: 'POST',
        body: JSON.stringify({
          message: question,
          caseId: selected?.id || '',
          history: aiHistory.slice(-8)
        })
      });
      setAiAnswer(`${d.ai ? '✨ REAL AI COPILOT' : '◈ BACKEND-GROUNDED SUMMARY'} · ${d.reply}`);
      setAiHistory(old => [...old, { role: 'user', content: question }, { role: 'assistant', content: d.reply }]);
    } catch (err) {
      setAiAnswer(err.message);
    } finally {
      setAiBusy(false);
    }
  }

  async function logout() {
    try {
      await call('/agent/logout', token, { method: 'POST' });
    } catch {}
    localStorage.removeItem('pl_agent_token');
    setToken('');
    setAgent(null);
    setCases([]);
  }

  const open = cases.filter(c => !['Resolved', 'Closed'].includes(c.status));
  const overdue = open.filter(c => c.urgency === 'Overdue').length;
  const urgent = open.filter(c => ['Critical', 'Overdue'].includes(c.urgency)).length;
  const unassigned = open.filter(c => !c.assignedAgent).length;

  if (!agent) {
    return (
      <div className="agent-auth-wrap">
        <form className="agent-login" onSubmit={login}>
          <div className="agent-logo">∞</div>
          <div className="agent-kicker">PROMISELOOP AI · STAFF ACCESS</div>
          <h1>Support Workspace</h1>
          <p>Sign in with your authorized support-agent account to manage resolution cases.</p>

          <label>
            Staff Email
            <input
              type="email"
              value={auth.email}
              onChange={e => setAuth({ ...auth, email: e.target.value })}
              required
              autoComplete="username"
            />
          </label>

          <label>
            Password
            <input
              type="password"
              value={auth.password}
              onChange={e => setAuth({ ...auth, password: e.target.value })}
              required
              autoComplete="current-password"
            />
          </label>

          {error && <div className="agent-error">{error}</div>}

          <button className="agent-primary" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in to support →'}
          </button>

          <div className="agent-demo-note">
            <b>Local Development Demo Credentials</b><br />
            Email: <code>agent@promiseloop.local</code><br />
            Password: <code>SupportDemo2026!</code><br />
            <small>
              Configured via <code>SUPPORT_AGENT_EMAIL</code> and <code>SUPPORT_AGENT_PASSWORD</code>. Manager overrides require <code>SUPPORT_MANAGER_EMAIL</code>.
            </small>
          </div>

          <a href="/">← Return to Customer Portal</a>
        </form>
      </div>
    );
  }

  return (
    <div className="agent-app">
      <aside className="agent-sidebar">
        <a className="agent-brand" href="/">
          <span>∞</span>
          <div>
            <b>PromiseLoop AI</b>
            <small>SUPPORT WORKSPACE</small>
          </div>
        </a>

        <div className="agent-nav-label">WORKSPACE</div>
        <button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>
          ▦ &nbsp; Case queue <span>{open.length}</span>
        </button>
        <button
          className={tab === 'urgent' ? 'active' : ''}
          onClick={() => {
            setTab('urgent');
            setPriorityFilter('Critical');
          }}
        >
          ⚑ &nbsp; Priority watch
        </button>
        <button
          onClick={() => {
            setQ('');
            setStatusFilter('');
            setPriorityFilter('');
            setTab('overview');
          }}
        >
          ↻ &nbsp; Reset filters
        </button>

        <div className="agent-side-bottom">
          <div className="agent-status-dot" /> Role: <strong>{agent.role.toUpperCase()}</strong>
          <div className="agent-profile">
            <span>{agent.name?.slice(0, 1) || 'A'}</span>
            <div>
              <b>{agent.name}</b>
              <small>{agent.email}</small>
            </div>
          </div>
          <button className="agent-signout" onClick={logout}>Sign out</button>
        </div>
      </aside>

      <main className="agent-main">
        <header className="agent-topbar">
          <div>
            <small>SUPPORT OPERATIONS / <b>CASE MANAGEMENT</b></small>
            <h1>{tab === 'urgent' ? 'Priority Watch (Critical SLA)' : 'Resolution Queue'}</h1>
          </div>
          <div className="agent-top-actions">
            <span className="agent-live"><i /> QUEUE LIVE</span>
            <button onClick={() => load(token)}>↻ Refresh</button>
            <a href="/">Customer portal ↗</a>
          </div>
        </header>

        <div className="agent-content">
          {error && (
            <div className="agent-error agent-banner">
              ⚠ {error}
              <button onClick={() => setError('')}>×</button>
            </div>
          )}

          <section className="agent-metrics">
            <div>
              <small>OPEN CASES</small>
              <strong>{open.length}</strong>
              <span>Require follow-through</span>
            </div>
            <div>
              <small>URGENT / CRITICAL</small>
              <strong className={urgent ? 'red-text' : ''}>{urgent}</strong>
              <span>High or Critical priority</span>
            </div>
            <div>
              <small>OVERDUE SLA</small>
              <strong className={overdue ? 'red-text' : ''}>{overdue}</strong>
              <span>Past target time</span>
            </div>
            <div>
              <small>UNASSIGNED</small>
              <strong>{unassigned}</strong>
              <span>Awaiting agent ownership</span>
            </div>
          </section>

          <section className="agent-work-grid">
            {/* Left Column: Filterable Case Queue */}
            <div className="agent-queue-card">
              <div className="agent-card-head">
                <div>
                  <h2>Resolution queue</h2>
                  <p>Deterministic priority rank based on impact, time, and vulnerability.</p>
                </div>
                <span>{cases.length} cases</span>
              </div>

              <div className="agent-filters">
                <input
                  value={q}
                  onChange={e => setQ(e.target.value)}
                  placeholder="Search reference, customer, or issue…"
                  aria-label="Search cases"
                />
                <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                  <option value="">All statuses</option>
                  {statuses.map(s => <option key={s}>{s}</option>)}
                </select>
                <select value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)}>
                  <option value="">All priorities</option>
                  {['Critical', 'High', 'Medium', 'Low'].map(s => <option key={s}>{s}</option>)}
                </select>
              </div>

              <div className="agent-case-list">
                {cases.map(c => (
                  <button
                    key={c.id}
                    className={`agent-case-row ${selected?.id === c.id ? 'selected' : ''}`}
                    onClick={() => setSelectedId(c.id)}
                  >
                    <span className={`agent-priority-dot ${c.priorityBand?.toLowerCase()}`} />
                    <span className="agent-case-main">
                      <b>{c.product || c.title}</b>
                      <small>{c.id} · {c.customerName || c.customerEmail || 'Customer'} · {c.issueType}</small>
                      <span className="agent-row-bottom">
                        <em>{c.status}</em>
                        <em className={`agent-priority ${c.priorityBand?.toLowerCase()}`}>{c.priorityBand}</em>
                        {c.overrideActive && <em style={{ background: '#fdf0d5', color: '#784605' }}>OVR</em>}
                      </span>
                    </span>
                    <span className={`agent-deadline ${c.urgency === 'Overdue' ? 'late' : ''}`}>
                      {c.urgency === 'Overdue'
                        ? 'Overdue'
                        : c.daysLeft == null
                        ? 'No SLA'
                        : c.daysLeft === 0
                        ? 'Due today'
                        : `${c.daysLeft}d left`}
                    </span>
                  </button>
                ))}
                {!cases.length && <div className="agent-empty">No cases match these filters.</div>}
              </div>
            </div>

            {/* Right Column: Case Details & Operations */}
            <div className="agent-detail-card">
              {!selected ? (
                <div className="agent-empty">Select a case from the queue to inspect details.</div>
              ) : (
                <>
                  <div className="agent-detail-head">
                    <div>
                      <small>CASE REFERENCE</small>
                      <h2>{selected.id}</h2>
                    </div>
                    <span className={`agent-priority ${selected.priorityBand?.toLowerCase()}`}>
                      {selected.priorityBand} ({selected.priorityScore}/100)
                    </span>
                  </div>

                  <h3>{selected.product || selected.title}</h3>
                  <p className="agent-description">{selected.description}</p>

                  <div className="agent-detail-meta">
                    <div>
                      <small>CUSTOMER</small>
                      <b>{selected.customerName || 'Demo customer'}</b>
                      <span>{selected.customerEmail || 'Customer account'}</span>
                    </div>
                    <div>
                      <small>CATEGORY</small>
                      <b>{selected.issueType}</b>
                    </div>
                    <div>
                      <small>ASSIGNED</small>
                      <b>{selected.assignedAgent || 'Unassigned'}</b>
                      <span>{selected.assignedTeam || 'General Support'}</span>
                    </div>
                    <div>
                      <small>SLA TARGET</small>
                      <b>{selected.slaDeadline ? new Date(selected.slaDeadline).toLocaleString() : 'Not set'}</b>
                    </div>
                  </div>

                  <div className="agent-action-row">
                    <label>
                      Workflow status
                      <select value={selected.status} onChange={updateStatus} disabled={busy}>
                        {(selected.status === 'Action needed' ? ['Action needed', ...statuses] : statuses).map(s => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
                    </label>
                    <button onClick={assign} disabled={busy}>♙ Assign</button>
                    {agent?.role === 'manager' && (
                      <button onClick={priority} disabled={busy}>⚑ Override Priority</button>
                    )}
                    <button onClick={escalate} disabled={busy}>↗ Escalate</button>
                  </div>

                  {/* Attachments */}
                  <div className="agent-subsection">
                    <h4>
                      Attachments & evidence <span>{(selected.attachments || []).length}</span>
                    </h4>
                    {selected.attachments?.length > 0 ? (
                      <div className="agent-attachments">
                        {selected.attachments.map(a => (
                          <a key={a.id} href={`${API}/agent/cases/${selected.id}/attachments/${a.id}`} target="_blank" rel="noreferrer">
                            <img src={`${API}/agent/cases/${selected.id}/attachments/${a.id}`} alt={a.name} />
                            <span>{a.name}</span>
                          </a>
                        ))}
                      </div>
                    ) : (
                      <p className="agent-muted">No files attached to this case.</p>
                    )}
                    <div className="agent-upload-row">
                      <input
                        ref={fileRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/gif"
                        multiple
                        onChange={e => setFiles(Array.from(e.target.files || []).slice(0, 4))}
                      />
                      <button onClick={upload} disabled={busy || !files.length}>
                        {busy ? 'Uploading…' : 'Upload support evidence'}
                      </button>
                    </div>
                    <small>Up to 4 images, max 3 MB each. Signature verified on backend.</small>
                  </div>

                  {/* Customer Conversation (Customer Visible) */}
                  <div className="agent-subsection">
                    <h4>Customer conversation (Customer-Visible)</h4>
                    <div className="agent-thread">
                      {(selected.messages || []).filter(m => m.visibility === 'customer').map(m => (
                        <div key={m.id} className={`agent-thread-message ${m.role === 'agent' ? 'from-agent' : ''}`}>
                          <b>{m.senderName || (m.role === 'agent' ? 'Support Agent' : 'Customer')}</b>
                          <p>{m.text}</p>
                          <time>{m.at ? new Date(m.at).toLocaleString() : ''}</time>
                        </div>
                      ))}
                      {!(selected.messages || []).some(m => m.visibility === 'customer') && (
                        <p className="agent-muted">No customer messages yet.</p>
                      )}
                    </div>
                    <form className="agent-compose" onSubmit={e => { e.preventDefault(); send('customer', reply, setReply); }}>
                      <textarea
                        value={reply}
                        onChange={e => setReply(e.target.value)}
                        placeholder="Write a response visible to the customer…"
                        rows="2"
                      />
                      <button disabled={busy || !reply.trim()}>Send to customer →</button>
                    </form>
                  </div>

                  {/* Private Internal Notes (Protected: NEVER visible to customers) */}
                  <div className="agent-subsection">
                    <h4>Private internal notes <span>Staff Only — Protected</span></h4>
                    <div className="agent-thread">
                      {(selected.internalNotes || []).map(n => (
                        <div className="agent-thread-message internal" key={n.id}>
                          <b>{n.author} (Internal Note)</b>
                          <p>{n.text}</p>
                          <time>{new Date(n.at).toLocaleString()}</time>
                        </div>
                      ))}
                      {!(selected.internalNotes || []).length && (
                        <p className="agent-muted">No internal notes yet.</p>
                      )}
                    </div>
                    <form className="agent-compose internal-compose" onSubmit={e => { e.preventDefault(); send('internal', note, setNote); }}>
                      <textarea
                        value={note}
                        onChange={e => setNote(e.target.value)}
                        placeholder="Add private staff note (investigation logs, fraud checks, etc.)…"
                        rows="2"
                      />
                      <button disabled={busy || !note.trim()}>Add internal note</button>
                    </form>
                  </div>

                  {/* Investigation & Resolution */}
                  <div className="agent-subsection">
                    <h4>Investigation & resolution summary</h4>
                    <textarea
                      className="agent-resolution-input"
                      value={resolution || selected.resolution || ''}
                      onChange={e => setResolution(e.target.value)}
                      placeholder="Document root cause, investigation results, and customer resolution…"
                      rows="3"
                    />
                    <button
                      className="agent-save-resolution"
                      disabled={busy || !(resolution || selected.resolution || '').trim()}
                      onClick={() => act(`/agent/cases/${selected.id}`, { resolution: resolution || selected.resolution }, 'PATCH')}
                    >
                      Save resolution summary
                    </button>
                  </div>

                  {/* History */}
                  <div className="agent-subsection">
                    <h4>Case history <span>{(selected.history || []).length} events</span></h4>
                    <div className="agent-history">
                      {[...(selected.history || [])].reverse().map((h, i) => (
                        <div key={`${h.at}-${i}`}>
                          <i style={h.internal ? { background: '#d48806' } : {}} />
                          <p>
                            {h.text} {h.internal && <em>(Internal)</em>}
                            <time>{new Date(h.at).toLocaleString()}</time>
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </section>

          {/* AI Case Copilot for Agents */}
          <section className="agent-ai-assistant">
            <div>
              <small>AI SUPPORT COPILOT</small>
              <h2>AI Case Copilot & Advisory Intelligence</h2>
              <p>
                Grounded strictly in verified case records. Provides automated case summaries, identifies missing evidence, drafts customer responses, and suggests next actions.
              </p>
              <div style={{ marginTop: '14px' }}>
                <button
                  type="button"
                  onClick={runCopilotAnalysis}
                  disabled={copilotLoading || !selected}
                  style={{
                    background: 'linear-gradient(120deg, #6254e8, #3b82f6)',
                    color: '#fff',
                    padding: '10px 14px',
                    borderRadius: '8px',
                    border: '0',
                    cursor: 'pointer',
                    fontWeight: '700'
                  }}
                >
                  {copilotLoading ? 'Analyzing Case Records…' : '✨ Generate Full AI Case Analysis'}
                </button>
              </div>
            </div>

            <form onSubmit={askAgentAI}>
              <textarea
                value={aiQuestion}
                onChange={e => setAiQuestion(e.target.value)}
                rows="2"
                maxLength={1600}
                placeholder="Ask custom question about the case or queue…"
              />
              <button disabled={aiBusy || !aiQuestion.trim() || !selected}>
                {aiBusy ? 'Consulting Copilot…' : 'Ask Copilot →'}
              </button>
            </form>

            {/* Structured Copilot Result Card */}
            {copilotData && copilotData.analysis && (
              <div
                style={{
                  gridColumn: '1 / -1',
                  background: '#f8f9ff',
                  border: '1px solid #dcdff5',
                  borderRadius: '14px',
                  padding: '20px',
                  marginTop: '10px'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <h3 style={{ margin: 0, fontSize: '16px', color: '#272d5c' }}>
                    {copilotData.ai ? '✨ AI Copilot Structured Analysis' : '◈ Grounded Copilot Analysis (Deterministic Fallback)'}
                  </h3>
                  <span style={{ fontSize: '11px', background: '#e0e7ff', color: '#4338ca', padding: '4px 8px', borderRadius: '6px', fontWeight: '800' }}>
                    ADVISORY ONLY
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '14px', fontSize: '12px' }}>
                  {/* Summary */}
                  <div style={{ background: '#fff', padding: '12px', borderRadius: '8px', border: '1px solid #e5e7f2' }}>
                    <strong style={{ color: '#4b5563', display: 'block', marginBottom: '6px' }}>Factual Case Summary</strong>
                    <p style={{ margin: 0, color: '#1f2937', lineHeight: '1.5' }}>{copilotData.analysis.summary}</p>
                  </div>

                  {/* Next Action */}
                  <div style={{ background: '#fff', padding: '12px', borderRadius: '8px', border: '1px solid #e5e7f2' }}>
                    <strong style={{ color: '#4b5563', display: 'block', marginBottom: '6px' }}>Recommended Next Action</strong>
                    <p style={{ margin: 0, color: '#1f2937', lineHeight: '1.5' }}>{copilotData.analysis.recommendedNextAction}</p>
                  </div>

                  {/* Missing Info */}
                  <div style={{ background: '#fff', padding: '12px', borderRadius: '8px', border: '1px solid #e5e7f2' }}>
                    <strong style={{ color: '#4b5563', display: 'block', marginBottom: '6px' }}>Missing Information Needed</strong>
                    <ul style={{ margin: '4px 0 0', paddingLeft: '18px', color: '#1f2937', lineHeight: '1.5' }}>
                      {(copilotData.analysis.missingInformation || []).map((m, idx) => (
                        <li key={idx}>{m}</li>
                      ))}
                    </ul>
                  </div>

                  {/* Priority & Escalation */}
                  <div style={{ background: '#fff', padding: '12px', borderRadius: '8px', border: '1px solid #e5e7f2' }}>
                    <strong style={{ color: '#4b5563', display: 'block', marginBottom: '6px' }}>Advisory Priority & Escalation</strong>
                    <div>Suggested Band: <strong>{copilotData.analysis.suggestedPriority}</strong></div>
                    <div style={{ marginTop: '4px', color: '#4b5563' }}>{copilotData.analysis.priorityExplanation}</div>
                    {copilotData.analysis.escalationRecommendation && (
                      <div style={{ marginTop: '6px', color: '#dc2626', fontWeight: '700' }}>
                        ⚠ Escalation Recommended: {copilotData.analysis.escalationReason}
                      </div>
                    )}
                  </div>
                </div>

                {/* Draft Customer Response */}
                {copilotData.analysis.draftCustomerResponse && (
                  <div style={{ marginTop: '14px', background: '#fff', padding: '14px', borderRadius: '8px', border: '1px solid #e5e7f2' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <strong style={{ color: '#4b5563' }}>Suggested Customer Response Draft:</strong>
                      <button
                        type="button"
                        onClick={() => setReply(copilotData.analysis.draftCustomerResponse)}
                        style={{
                          background: '#e0e7ff',
                          color: '#4338ca',
                          border: '0',
                          padding: '6px 10px',
                          borderRadius: '6px',
                          fontSize: '11px',
                          fontWeight: '700',
                          cursor: 'pointer'
                        }}
                      >
                        📋 Copy Draft to Customer Reply Box
                      </button>
                    </div>
                    <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit', color: '#1f2937', fontSize: '12px', background: '#f9fafb', padding: '10px', borderRadius: '6px' }}>
                      {copilotData.analysis.draftCustomerResponse}
                    </pre>
                    <small style={{ display: 'block', marginTop: '6px', color: '#6b7280' }}>
                      Human agent review is required. Clicking the copy button places this draft in the reply box for you to edit and send.
                    </small>
                  </div>
                )}
              </div>
            )}

            {aiAnswer && <div className="agent-ai-answer">{aiAnswer}</div>}
          </section>

          <footer className="agent-footer">
            PromiseLoop AI <span>·</span> Staff Support Operations <span>·</span> Role-Checked Backend APIs
          </footer>
        </div>
      </main>
    </div>
  );
}
