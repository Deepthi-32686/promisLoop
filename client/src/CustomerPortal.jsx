import React, { useEffect, useRef, useState } from 'react';
import './customer.css';

const API = '/api';

async function request(url, token, options = {}) {
  const r = await fetch(`${API}${url}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });
  const d = await r.json().catch(() => ({ error: 'The server returned an invalid response.' }));
  if (!r.ok) throw new Error(d.error || 'Request failed. Please try again.');
  return d;
}

const emptyForm = { title: '', category: 'Damaged item', description: '', orderRef: '' };

export default function CustomerPortal() {
  const [token, setToken] = useState(() => localStorage.getItem('pl_customer_token') || '');
  const [user, setUser] = useState(null);
  const [authMode, setAuthMode] = useState('login'); // 'login' | 'register'
  const [auth, setAuth] = useState({ name: '', email: '', password: '' });
  const [authBusy, setAuthBusy] = useState(false);
  const [error, setError] = useState('');
  const [cases, setCases] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [confirmStep, setConfirmStep] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [images, setImages] = useState([]);
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState('');
  const [feedback, setFeedback] = useState({ rating: 5, comment: '' });

  // Assistant state
  const [assistantInput, setAssistantInput] = useState('');
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [assistantError, setAssistantError] = useState('');
  const [assistantChat, setAssistantChat] = useState([
    {
      role: 'assistant',
      text: 'Hi! I am your PromiseLoop delivery assistant. I can help you describe an issue, understand your saved case status, explain return & refund policies, and prepare a case for support review.',
      ai: false
    }
  ]);
  const [assistantAI, setAssistantAI] = useState(null);

  const assistantEnd = useRef(null);
  const fileRef = useRef(null);

  const selected = cases.find(c => c.id === selectedId) || cases[0] || null;

  async function load(t = token) {
    if (!t) return;
    try {
      const me = await request('/customer/me', t);
      setUser(me.user);
      const list = await request('/customer/cases', t);
      setCases(list);
      if (!selectedId && list.length) setSelectedId(list[0].id);
      setError('');
    } catch (e) {
      setError(e.message);
      if (/sign in|session expired/i.test(e.message)) {
        localStorage.removeItem('pl_customer_token');
        setToken('');
        setUser(null);
      }
    }
  }

  useEffect(() => {
    if (token) load(token);
  }, [token]);

  useEffect(() => {
    request('/health', null)
      .then(d => setAssistantAI(d.ai || { enabled: false }))
      .catch(() => setAssistantAI({ enabled: false }));
  }, []);

  useEffect(() => {
    assistantEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [assistantChat, assistantBusy]);

  async function submitAuth(e) {
    e.preventDefault();
    setError('');
    setAuthBusy(true);
    try {
      const d = await request(
        `/customer/${authMode === 'register' ? 'register' : 'login'}`,
        null,
        { method: 'POST', body: JSON.stringify(auth) }
      );
      localStorage.setItem('pl_customer_token', d.token);
      setToken(d.token);
      setUser(d.user);
    } catch (e) {
      setError(e.message);
    } finally {
      setAuthBusy(false);
    }
  }

  function chooseFiles(e) {
    const chosen = Array.from(e.target.files || []);
    e.target.value = '';
    if (!chosen.length) return;
    setError('');
    const room = 4 - images.length;
    if (chosen.length > room) {
      setError('You can attach up to 4 images per case.');
      return;
    }
    Promise.all(
      chosen.map(
        file =>
          new Promise(resolve => {
            if (!file.type.startsWith('image/')) {
              resolve({ error: `${file.name} is not a valid image format.` });
              return;
            }
            if (file.size > 3 * 1024 * 1024) {
              resolve({ error: `${file.name} is larger than 3 MB.` });
              return;
            }
            const reader = new FileReader();
            reader.onload = () => resolve({ name: file.name, data: reader.result, preview: reader.result });
            reader.onerror = () => resolve({ error: `Could not read ${file.name}. Please try again.` });
            reader.readAsDataURL(file);
          })
      )
    ).then(results => {
      const bad = results.find(x => x.error);
      if (bad) {
        setError(bad.error);
        return;
      }
      setImages(old => [...old, ...results]);
    });
  }

  function openNewCaseModal(prefill = null) {
    if (prefill) {
      setForm({
        title: prefill.title || form.title || '',
        category: prefill.category || form.category || 'Damaged item',
        description: prefill.description || form.description || '',
        orderRef: prefill.orderRef || form.orderRef || ''
      });
    }
    setConfirmStep(false);
    setError('');
    setFormOpen(true);
  }

  async function createCase(e) {
    e.preventDefault();
    if (!confirmStep) {
      // Show confirmation step before actual creation
      setConfirmStep(true);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const d = await request('/customer/cases', token, {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          images: images.map(({ name, data }) => ({ name, data }))
        })
      });
      setCases(old => [d.case, ...old]);
      setSelectedId(d.case.id);
      setFormOpen(false);
      setConfirmStep(false);
      setForm(emptyForm);
      setImages([]);
      setAssistantChat(old => [
        ...old,
        {
          role: 'assistant',
          text: `Case ${d.case.id} for "${d.case.product}" has been successfully created and submitted to our support team! Priority: ${d.case.priorityBand}. You can track updates in your case timeline.`,
          ai: false
        }
      ]);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function sendReply(e) {
    e.preventDefault();
    if (!selected || !reply.trim()) return;
    setBusy(true);
    try {
      await request(`/customer/cases/${selected.id}/messages`, token, {
        method: 'POST',
        body: JSON.stringify({ text: reply })
      });
      setReply('');
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function sendFeedback(e) {
    e.preventDefault();
    if (!selected) return;
    setBusy(true);
    try {
      await request(`/customer/cases/${selected.id}/feedback`, token, {
        method: 'POST',
        body: JSON.stringify(feedback)
      });
      await load();
      setError('Thank you — your feedback was saved.');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function askAssistant(e, retryText = null) {
    e?.preventDefault();
    const text = (retryText || assistantInput).trim();
    if (!text || assistantBusy) return;

    const prior = assistantChat.slice(-8).map(m => ({ role: m.role, content: m.text }));
    if (!retryText) {
      setAssistantChat(old => [...old, { role: 'user', text }]);
      setAssistantInput('');
    }
    setAssistantBusy(true);
    setAssistantError('');

    try {
      const d = await request('/customer/assistant', token, {
        method: 'POST',
        body: JSON.stringify({ message: text, history: prior, caseId: selected?.id || '' })
      });
      setAssistantChat(old => [
        ...old,
        {
          role: 'assistant',
          text: d.reply,
          ai: d.ai,
          provider: d.provider,
          actions: d.actions || []
        }
      ]);
    } catch (err) {
      setAssistantError(err.message);
      setAssistantChat(old => [
        ...old,
        {
          role: 'assistant',
          text: `I encountered an issue communicating with the assistant service: ${err.message}`,
          failed: true,
          failedText: text
        }
      ]);
    } finally {
      setAssistantBusy(false);
    }
  }

  async function logout() {
    try {
      await request('/customer/logout', token, { method: 'POST' });
    } catch {}
    localStorage.removeItem('pl_customer_token');
    setToken('');
    setUser(null);
    setCases([]);
    setSelectedId('');
  }

  // Welcome, Login, and Signup Screen
  if (!user) {
    return (
      <div className="customer-shell">
        <header className="cp-nav">
          <div className="cp-brand">
            <span className="cp-logo">∞</span>
            <div>
              <b>PromiseLoop</b>
              <small>DELIVERY RESOLUTION</small>
            </div>
          </div>
          <div className="cp-nav-right">
            <span className="cp-nav-note">Customer Resolution Space</span>
            <a className="cp-agent-link cp-admin-pill" href="/?workspace=agent" title="Staff & Agent Access">
              Admin / Support Team Login ↗
            </a>
          </div>
        </header>

        <main className="cp-auth-layout">
          <section className="cp-hero">
            <div className="cp-eyebrow">✦ CUSTOMER CARE, CONNECTED</div>
            <h1>
              Close the loop.<br />
              <em>Not just the delivery.</em>
            </h1>
            <p>Report a problem, share photos, and follow every update in one place.</p>
            <div className="cp-hero-points">
              <span>✓ Secure customer case tracking</span>
              <span>✓ Verified photo evidence attachments</span>
              <span>✓ Direct responses from authorized support agents</span>
            </div>
            <div className="cp-orbit">∞</div>
          </section>

          <form className="cp-auth-card" onSubmit={submitAuth}>
            <div className="cp-eyebrow">YOUR SUPPORT SPACE</div>
            <h2>{authMode === 'login' ? 'Customer Sign In' : 'Create Customer Account'}</h2>
            <p>
              {authMode === 'login'
                ? 'Sign in to view your cases, track updates, and talk with support.'
                : 'Enter your details to start tracking your delivery resolutions.'}
            </p>

            {authMode === 'register' && (
              <label>
                Full name
                <input
                  required
                  minLength="2"
                  value={auth.name}
                  onChange={e => setAuth({ ...auth, name: e.target.value })}
                  placeholder="e.g. Alex Johnson"
                  autoComplete="name"
                />
              </label>
            )}

            <label>
              Email address
              <input
                required
                type="email"
                value={auth.email}
                onChange={e => setAuth({ ...auth, email: e.target.value })}
                placeholder="you@example.com"
                autoComplete="email"
              />
            </label>

            <label>
              Password
              <input
                required
                type="password"
                minLength={authMode === 'register' ? 10 : 1}
                value={auth.password}
                onChange={e => setAuth({ ...auth, password: e.target.value })}
                placeholder="••••••••••"
                autoComplete={authMode === 'register' ? 'new-password' : 'current-password'}
              />
              {authMode === 'register' && (
                <small>Use at least 10 characters with a letter and a number.</small>
              )}
            </label>

            {error && <div className="cp-error">{error}</div>}

            <button className="cp-primary" disabled={authBusy}>
              {authBusy ? 'Please wait…' : authMode === 'login' ? 'Sign in securely' : 'Create account'} <span>→</span>
            </button>

            <div className="cp-switch">
              {authMode === 'login' ? 'New to PromiseLoop?' : 'Already have an account?'}{' '}
              <button
                type="button"
                onClick={() => {
                  setAuthMode(authMode === 'login' ? 'register' : 'login');
                  setError('');
                }}
              >
                {authMode === 'login' ? 'Create customer account' : 'Sign in'}
              </button>
            </div>

            <div className="cp-admin-access" style={{ marginTop: '20px', paddingTop: '15px', borderTop: '1px solid #eff0f6', textAlign: 'center' }}>
              <span style={{ fontSize: '11px', color: '#77819c' }}>Are you a support team member or administrator?</span><br />
              <a href="/?workspace=agent" style={{ display: 'inline-block', marginTop: '6px', fontSize: '12px', fontWeight: '700', color: '#5b4dc7', textDecoration: 'none' }}>
                Admin / Support Team Login ↗
              </a>
            </div>

            <div className="cp-security">
              ▣ Passwords are securely hashed with scrypt. Private uploads and case records are protected by backend ownership checks.
            </div>
          </form>
        </main>
      </div>
    );
  }

  // Authenticated Customer Portal
  return (
    <div className="customer-shell">
      <header className="cp-nav">
        <div className="cp-brand">
          <span className="cp-logo">∞</span>
          <div>
            <b>PromiseLoop</b>
            <small>CUSTOMER PORTAL</small>
          </div>
        </div>
        <div className="cp-nav-right">
          <span className="cp-user-avatar">{user.name?.slice(0, 1).toUpperCase()}</span>
          <span className="cp-user-name">{user.name}</span>
          <button className="cp-logout" onClick={logout}>Sign out</button>
          <a className="cp-agent-link" href="/?workspace=agent" title="Switch to support staff workspace">
            Admin / Support Team Login ↗
          </a>
        </div>
      </header>

      <main className="cp-dashboard">
        <div className="cp-welcome">
          <div>
            <div className="cp-eyebrow">YOUR RESOLUTION SPACE</div>
            <h1>Hi, {user.name.split(' ')[0]}.</h1>
            <p>Every update, in one place. We will keep your cases moving forward.</p>
          </div>
          <button className="cp-primary cp-new-case" onClick={() => openNewCaseModal()}>
            ＋ Report an issue
          </button>
        </div>

        {error && <div className="cp-alert">{error}</div>}

        <div className="cp-stats">
          <div>
            <small>MY CASES</small>
            <strong>{cases.length}</strong>
            <span>All reported issues</span>
          </div>
          <div>
            <small>IN PROGRESS</small>
            <strong>{cases.filter(c => !['Resolved', 'Closed'].includes(c.status)).length}</strong>
            <span>Actively investigated</span>
          </div>
          <div>
            <small>RESOLVED</small>
            <strong>{cases.filter(c => ['Resolved', 'Closed'].includes(c.status)).length}</strong>
            <span>Closed successfully</span>
          </div>
        </div>

        <div className="cp-workspace">
          {/* Case list */}
          <section className="cp-case-list">
            <div className="cp-section-head">
              <div>
                <h2>Your cases</h2>
                <p>Select a case to inspect verified updates.</p>
              </div>
              <span>{cases.length} total</span>
            </div>
            {!cases.length ? (
              <div className="cp-empty">
                <div>✦</div>
                <h3>No cases yet</h3>
                <p>If something went wrong with a delivery, report it here. You can attach photos to help the team investigate.</p>
                <button className="cp-primary" onClick={() => openNewCaseModal()}>
                  Report your first issue →
                </button>
              </div>
            ) : (
              cases.map(c => (
                <button
                  key={c.id}
                  className={`cp-case-row ${selected?.id === c.id ? 'active' : ''}`}
                  onClick={() => setSelectedId(c.id)}
                >
                  <span className="cp-case-icon">
                    {c.issueType?.toLowerCase().includes('damage') ? '◇' : c.issueType?.toLowerCase().includes('deliver') ? '⌁' : '▧'}
                  </span>
                  <span className="cp-case-main">
                    <b>{c.product}</b>
                    <small>{c.id} · {c.issueType}</small>
                    <span className={`cp-status ${c.status?.toLowerCase().replaceAll(' ', '-')}`}>
                      {c.status}
                    </span>
                  </span>
                  <span className="cp-chevron">›</span>
                </button>
              ))
            )}
          </section>

          {/* Case details */}
          <section className="cp-case-detail">
            {!selected ? (
              <div className="cp-empty">
                <h3>Select or create a case</h3>
                <p>Details, verified status, and agent responses will appear here.</p>
              </div>
            ) : (
              <>
                <div className="cp-detail-top">
                  <div>
                    <div className="cp-eyebrow">CASE REFERENCE</div>
                    <h2>{selected.id}</h2>
                  </div>
                  <span className={`cp-status ${selected.status?.toLowerCase().replaceAll(' ', '-')}`}>
                    {selected.status}
                  </span>
                </div>

                <h3 className="cp-issue-title">{selected.product}</h3>
                <p className="cp-description">{selected.description}</p>

                <div className="cp-meta-grid">
                  <div>
                    <small>CATEGORY</small>
                    <b>{selected.issueType}</b>
                  </div>
                  <div>
                    <small>SUBMITTED</small>
                    <b>{new Date(selected.createdAt).toLocaleDateString()}</b>
                  </div>
                  <div>
                    <small>ASSIGNED TEAM</small>
                    <b>{selected.assignedTeam || 'General Support Review'}</b>
                  </div>
                  <div>
                    <small>ORDER REFERENCE</small>
                    <b>{selected.orderRef || 'Not provided'}</b>
                  </div>
                </div>

                {selected.attachments?.length > 0 && (
                  <div className="cp-attachments">
                    <h3>Attached photos ({selected.attachments.length})</h3>
                    <div className="cp-image-grid">
                      {selected.attachments.map(a => (
                        <a key={a.id} href={`${API}/customer/cases/${selected.id}/attachments/${a.id}`} target="_blank" rel="noreferrer">
                          <img src={`${API}/customer/cases/${selected.id}/attachments/${a.id}`} alt={a.name} />
                          <span>{a.name}</span>
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                <div className="cp-timeline">
                  <div className="cp-section-head">
                    <div>
                      <h3>Updates & conversation</h3>
                      <p>Verified updates and messages from your support team.</p>
                    </div>
                  </div>
                  {(selected.history || []).map((h, i) => (
                    <div className="cp-event" key={`${h.at}-${i}`}>
                      <span className="cp-event-dot" />
                      <div>
                        <p>{h.text}</p>
                        <time>{new Date(h.at).toLocaleString()}</time>
                      </div>
                    </div>
                  ))}
                  {(selected.messages || []).map(m => (
                    <div className={`cp-message ${m.role === 'customer' ? 'mine' : ''}`} key={m.id}>
                      <b>{m.role === 'customer' ? 'You' : (m.senderName || 'Support Team')}</b>
                      <p>{m.text}</p>
                      <time>{new Date(m.at).toLocaleString()}</time>
                    </div>
                  ))}
                </div>

                {!['Resolved', 'Closed'].includes(selected.status) && (
                  <form className="cp-reply-form" onSubmit={sendReply}>
                    <label htmlFor="cp-reply">Reply to support team</label>
                    <textarea
                      id="cp-reply"
                      value={reply}
                      onChange={e => setReply(e.target.value)}
                      placeholder="Add details, answer questions, or update the team…"
                      rows="3"
                    />
                    <button className="cp-primary" disabled={busy || !reply.trim()}>
                      {busy ? 'Sending…' : 'Send reply →'}
                    </button>
                  </form>
                )}

                {['Resolved', 'Closed'].includes(selected.status) && (
                  <div className="cp-resolution">
                    <div className="cp-resolved-mark">✓</div>
                    <div>
                      <h3>Case Resolution</h3>
                      <p>{selected.resolution || 'This case has been marked resolved by the support team.'}</p>
                    </div>
                  </div>
                )}

                {['Resolved', 'Closed'].includes(selected.status) && !selected.feedback && (
                  <form className="cp-feedback" onSubmit={sendFeedback}>
                    <h3>How was your support experience?</h3>
                    <label>
                      Rating
                      <select value={feedback.rating} onChange={e => setFeedback({ ...feedback, rating: Number(e.target.value) })}>
                        {[5, 4, 3, 2, 1].map(n => (
                          <option value={n} key={n}>
                            {n} / 5 {n === 5 ? '— Excellent' : n === 1 ? '— Poor' : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                    <textarea
                      value={feedback.comment}
                      onChange={e => setFeedback({ ...feedback, comment: e.target.value })}
                      placeholder="Optional feedback about your resolution…"
                      rows="2"
                    />
                    <button className="cp-primary" disabled={busy}>Submit feedback</button>
                  </form>
                )}

                {selected.feedback && (
                  <div className="cp-feedback-saved">
                    ✓ Feedback received · Rated {selected.feedback.rating}/5
                  </div>
                )}
              </>
            )}
          </section>
        </div>

        {/* AI Customer Support Assistant */}
        <section className="cp-assistant">
          <div className="cp-assistant-head">
            <div>
              <div className="cp-eyebrow">AI SUPPORT AGENT</div>
              <h2>Natural-Language Support Assistant</h2>
              <p>Grounded in your verified cases and approved company policies. No invented claims.</p>
            </div>
            <span className={`cp-ai-status ${assistantAI?.enabled ? 'live' : ''}`}>
              {assistantAI?.enabled
                ? `REAL AI · ${assistantAI.provider || 'Groq'} (${assistantAI.model || 'model'})`
                : 'GUIDED FALLBACK · Rule-based (No AI key)'}
            </span>
          </div>

          <div className="cp-assistant-messages">
            {assistantChat.map((m, i) => (
              <div className={`cp-assistant-message ${m.role}`} key={i}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <b>{m.role === 'assistant' ? 'PromiseLoop AI Assistant' : 'You'}</b>
                  {m.role === 'assistant' && (
                    <span style={{ fontSize: '9px', padding: '2px 6px', borderRadius: '4px', background: m.ai ? '#e2f7ed' : '#f0f0f5', color: m.ai ? '#157347' : '#6c757d' }}>
                      {m.ai ? '✨ Real AI' : '◈ Grounded Fallback'}
                    </span>
                  )}
                </div>
                <p>{m.text}</p>
                {m.failed && (
                  <button
                    type="button"
                    style={{ marginTop: '8px', border: '1px solid #c9cddb', background: '#fff', borderRadius: '6px', padding: '4px 8px', fontSize: '11px', cursor: 'pointer' }}
                    onClick={() => askAssistant(null, m.failedText)}
                  >
                    ↺ Retry this question
                  </button>
                )}
                {m.actions?.includes('human_handoff_available') && (
                  <div style={{ marginTop: '8px' }}>
                    <a href="/?workspace=agent" style={{ color: '#5144c6', fontWeight: '700', fontSize: '12px' }}>
                      Escalate to Support Workspace ↗
                    </a>
                  </div>
                )}
              </div>
            ))}
            {assistantBusy && (
              <div className="cp-assistant-message assistant">
                <b>PromiseLoop AI Assistant</b>
                <p>Thinking and checking case & policy facts…</p>
              </div>
            )}
            <div ref={assistantEnd} />
          </div>

          <div className="cp-assistant-prompts">
            <button
              type="button"
              onClick={() =>
                setAssistantInput(
                  selected
                    ? `What is the current status of case ${selected.id}, and what should I do next?`
                    : 'What is your return and replacement policy for damaged items?'
                )
              }
            >
              Case status & next step
            </button>
            <button
              type="button"
              onClick={() => setAssistantInput('What is your refund timeframe policy if an item arrives damaged?')}
            >
              Refund policy & timeframe
            </button>
            <button
              type="button"
              onClick={() => setAssistantInput('My package arrived with broken glass. What details do you need from me to submit a case?')}
            >
              Report damaged item
            </button>
            <button
              type="button"
              onClick={() => setAssistantInput('What is your policy on lost shipments or delayed delivery?')}
            >
              Lost or delayed shipment policy
            </button>
          </div>

          <form className="cp-assistant-form" onSubmit={askAssistant}>
            <input
              value={assistantInput}
              onChange={e => setAssistantInput(e.target.value)}
              placeholder="Ask anything about your cases, return policies, or describe a delivery problem…"
              maxLength={1600}
              aria-label="Ask PromiseLoop assistant"
            />
            <button className="cp-primary" disabled={assistantBusy || !assistantInput.trim()}>
              {assistantBusy ? 'Thinking…' : 'Ask →'}
            </button>
          </form>

          <small className="cp-assistant-note">
            {assistantAI?.enabled
              ? `Generative AI model active via official API (${assistantAI.provider}). Policy answers reflect official store policy.`
              : 'AI_API_KEY is not configured on the backend. The assistant runs in grounded fallback mode using verified backend records and approved policies.'}
          </small>
        </section>

        <footer className="cp-footer">
          PromiseLoop AI <span>·</span> Authenticated customer portal <span>·</span> Deterministic priority & SLA protection.
        </footer>
      </main>

      {/* Case Creation Modal */}
      {formOpen && (
        <div className="cp-modal-bg" onMouseDown={e => { if (e.target === e.currentTarget) setFormOpen(false); }}>
          <form className="cp-modal" onSubmit={createCase}>
            <div className="cp-modal-head">
              <div>
                <div className="cp-eyebrow">NEW SUPPORT CASE</div>
                <h2>{confirmStep ? 'Confirm Case Summary' : 'Report a delivery issue'}</h2>
                <p>
                  {confirmStep
                    ? 'Review the verified case summary before final submission.'
                    : 'Provide details and photos so our support team can investigate.'}
                </p>
              </div>
              <button type="button" className="cp-close" onClick={() => setFormOpen(false)}>×</button>
            </div>

            {confirmStep ? (
              <div style={{ background: '#f8f9fd', border: '1px solid #e2e6f2', borderRadius: '14px', padding: '18px', marginBottom: '16px' }}>
                <h3 style={{ margin: '0 0 10px', fontSize: '15px' }}>{form.title}</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '12px', marginBottom: '12px' }}>
                  <div><strong>Category:</strong> {form.category}</div>
                  <div><strong>Order reference:</strong> {form.orderRef || 'Not provided'}</div>
                  <div><strong>Attached photos:</strong> {images.length} photo(s)</div>
                  <div><strong>Customer:</strong> {user.name} ({user.email})</div>
                </div>
                <div style={{ fontSize: '12px', color: '#495057', background: '#fff', padding: '10px', borderRadius: '8px', border: '1px solid #edf0f5' }}>
                  <strong>Description:</strong>
                  <p style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{form.description}</p>
                </div>
                <p style={{ fontSize: '11px', color: '#6c757d', marginTop: '10px' }}>
                  Once submitted, an official case ID will be generated, and your case will appear in the authorized support queue with deterministic priority scoring.
                </p>
              </div>
            ) : (
              <>
                <label>
                  Issue title
                  <input
                    required
                    minLength="4"
                    maxLength="140"
                    value={form.title}
                    onChange={e => setForm({ ...form, title: e.target.value })}
                    placeholder="e.g. Headphones arrived with cracked headband"
                  />
                </label>

                <label>
                  Category
                  <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                    <option>Damaged item</option>
                    <option>Missing item</option>
                    <option>Wrong item</option>
                    <option>Delivery problem</option>
                    <option>Refund or payment</option>
                    <option>Other issue</option>
                  </select>
                </label>

                <label>
                  Describe what happened
                  <textarea
                    required
                    minLength="10"
                    maxLength="5000"
                    rows="4"
                    value={form.description}
                    onChange={e => setForm({ ...form, description: e.target.value })}
                    placeholder="Explain what happened in detail. Mention when it arrived, packaging condition, and product state…"
                  />
                </label>

                <label>
                  Order or tracking reference <span className="cp-optional">OPTIONAL</span>
                  <input
                    value={form.orderRef}
                    maxLength="100"
                    onChange={e => setForm({ ...form, orderRef: e.target.value })}
                    placeholder="e.g. ORD-98124 or tracking number"
                  />
                </label>

                <div className="cp-upload-box">
                  <div className="cp-upload-symbol">▧</div>
                  <div>
                    <b>Add supporting photos (up to 4)</b>
                    <p>JPG, PNG, WEBP or GIF · max 3 MB each. Stored securely on the backend.</p>
                  </div>
                  <div className="cp-upload-buttons">
                    <button
                      type="button"
                      onClick={() => {
                        if (fileRef.current) fileRef.current.setAttribute('capture', 'environment');
                        fileRef.current?.click();
                      }}
                      disabled={images.length >= 4}
                    >
                      ◎ Take photo
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (fileRef.current) fileRef.current.removeAttribute('capture');
                        fileRef.current?.click();
                      }}
                      disabled={images.length >= 4}
                    >
                      Choose files
                    </button>
                  </div>
                  <input
                    ref={fileRef}
                    className="cp-hidden-input"
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    multiple
                    onChange={chooseFiles}
                  />
                </div>

                {images.length > 0 && (
                  <div className="cp-preview-grid">
                    {images.map((im, i) => (
                      <div className="cp-preview" key={`${im.name}-${i}`}>
                        <img src={im.preview} alt={`Preview ${im.name}`} />
                        <span title={im.name}>{im.name}</span>
                        <button
                          type="button"
                          aria-label={`Remove ${im.name}`}
                          onClick={() => setImages(old => old.filter((_, j) => j !== i))}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {error && <div className="cp-error">{error}</div>}

            <div className="cp-modal-actions">
              {confirmStep ? (
                <>
                  <button type="button" className="cp-secondary" onClick={() => setConfirmStep(false)}>
                    ← Back to edit
                  </button>
                  <button type="submit" className="cp-primary" disabled={busy}>
                    {busy ? 'Creating case…' : 'Confirm and submit case →'}
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className="cp-secondary" onClick={() => setFormOpen(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="cp-primary">
                    Review case summary →
                  </button>
                </>
              )}
            </div>
            <small className="cp-upload-footnote">
              All attachments are validated on the backend for MIME type and file signature.
            </small>
          </form>
        </div>
      )}
    </div>
  );
}
