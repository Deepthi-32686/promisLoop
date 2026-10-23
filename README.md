# PromiseLoop AI — Real AI-Powered Customer Support & Resolution System

PromiseLoop AI is an end-to-end delivery resolution platform featuring an authenticated Customer Portal, an authorized Support Operations Workspace, a deterministic auditable priority & SLA engine, and a genuine generative AI customer support agent with AI Copilot for support staff.

---

## 1. Audit Report & Discovered Root Causes

During our technical audit of the original codebase, several critical architectural, security, and runtime issues were identified and resolved:

### 1.1 Leaking Internal Notes to Customers (`GET /api/customer/cases`)
* **Root Cause Found**: In `server/index.js`, the `/api/customer/cases` endpoint was enriching cases via `enrich(c)` and spreading all properties without stripping `internalNotes`.
* **Impact**: Private staff investigation logs, fraud flags, and confidential internal messages were exposed to customers in HTTP API responses.
* **Fix**: Added explicit property destructuring `{ internalNotes, ...safe }` in both `GET /api/customer/cases` and `POST /api/customer/cases` so `internalNotes` is completely absent from customer responses.

### 1.2 Unhandled Missing Data Files & Crash (`ENOENT: cases.json`)
* **Root Cause Found**: `readCases()` used a raw `fs.readFileSync(DATA_FILE)` inside a basic try/catch without ensuring the parent directory existed or automatically initializing the JSON array file. On fresh checkouts or dynamic temporary testing paths, the server logged scary `ENOENT` error logs or threw when directories were absent.
* **Fix**: Implemented `ensureDataFiles()` which guarantees `DATA_DIR` and `UPLOAD_DIR` exist recursively, safely copies seed data or initializes empty `[]` arrays atomically, and dynamically resolves paths.

### 1.3 Client Process Terminating with Code 1 & `ERR_CONNECTION_REFUSED`
* **Root Cause Found**: The npm script `"dev": "concurrently -k \"npm:server\" \"npm:client\""` uses the `-k` (kill-others) flag. Whenever the server experienced an initialization error (such as missing `data/cases.json` or port collision), the server process exited, causing `concurrently` to terminate the client Vite process with exit code 1. Subsequent browser connections failed with `ERR_CONNECTION_REFUSED`.
* **Fix**: Made server startup fully resilient with automatic data initialization, error handling, and robust Vite proxy configuration.

### 1.4 Chatbot Repetitive Canned Answers & Lack of Configurable AI Provider
* **Root Cause Found**: The previous chatbot relied on rigid regex keyword checks. If `AI_API_KEY` was missing or an unhandled query was sent, it returned the exact same canned generic message repeatedly. Moreover, only a hardcoded Groq URL was supported, lacking a multi-provider adapter.
* **Fix**: Built a multi-provider adapter in `server/ai.js` supporting Groq, OpenAI, Ollama, OpenRouter, and custom endpoints via `AI_PROVIDER`, `AI_BASE_URL`, and `AI_MODEL`. Added grounded fallback handling, context-appropriate responses, and honest uncertainty reporting.

### 1.5 Missing Admin / Support Login Link on Welcome & Auth Screens
* **Root Cause Found**: The route to the agent portal (`/?workspace=agent`) was only rendered in the authenticated customer navigation bar. Unauthenticated support agents visiting the homepage had no visible way to reach the staff login.
* **Fix**: Added a prominent "Admin / Support Team Login" button to the welcome navigation header and within the customer authentication card.

### 1.6 Absence of an Approved Policy Source of Truth
* **Root Cause Found**: Chatbot answers regarding refund timeframes and return policies had no backing source of truth, causing either refusal to answer or risk of hallucination.
* **Fix**: Built `server/policy.js` containing approved retailer policies (30-day return window, damage claim photo requirements, 3-5 day refund timelines, battery/safety protocols) and grounded all AI prompts and fallback search directly in this source.

---

## 2. Architecture & Security Model

```
┌────────────────────────────────────────────────────────┐
│                   Customer Portal                      │
│        (Registration, Login, Cases, Photo Uploads)     │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│                    Express Backend                     │
│  ├── Authentication (scrypt hashing, timing-safe auth) │
│  ├── Ownership Enforcement (Customer-scoped queries)   │
│  ├── Safe Upload Handler (Magic bytes, 3MB limit)     │
│  ├── Internal Notes Isolation (Staff-only access)     │
│  ├── Deterministic Priority Engine (Auditable 0-100)  │
│  ├── Approved Policy Source (server/policy.js)         │
│  └── AI Provider Adapter (server/ai.js)                │
└───────────────────────────▲────────────────────────────┘
                            │
┌───────────────────────────┴────────────────────────────┐
│                Support Agent Workspace                 │
│  ├── Case Queue & Priority Watch                       │
│  ├── Status Transitions & Assignment                   │
│  ├── Private Internal Notes & Customer Messaging       │
│  └── AI Case Copilot (Structured Analysis & Drafts)    │
└────────────────────────────────────────────────────────┘
```

### Security Guarantees:
1. **Private Credentials on Backend**: API keys (`AI_API_KEY`) and password hashes never leave the server.
2. **Customer Ownership**: Customers can only view cases, messages, and attachments belonging to their own user ID (`customerId`).
3. **Internal Note Separation**: Internal notes and internal history entries are stripped from all customer-facing responses.
4. **Safe File Handling**: Uploaded files undergo MIME type validation, file size limits (max 3 MB), and binary magic-byte inspection (JPEG `FF D8 FF`, PNG `89 50 4E 47`, GIF `GIF87a/89a`, WebP `RIFF....WEBP`). Files are stored under UUID filenames in isolated directories with path traversal protection.
5. **Deterministic Priority Protection**: Case priority and SLA targets are governed by mathematical rules (Impact 40, Time 25, Hardship 20, Repeat 15), not customer demands or generative model output. Priority overrides are restricted to the Manager role and mandate an audit reason.

---

## 3. Real Generative AI Integration

PromiseLoop AI connects to official generative AI providers via a backend adapter in `server/ai.js`.

### Supported Providers:
* **Groq** (Default recommended: fast inference, OpenAI-compatible)
* **OpenAI** (`gpt-4o-mini`, `gpt-4o`)
* **OpenRouter** (Unified API for various open/commercial models)
* **Ollama** (Local models: `llama3`, `mistral`, etc.)
* **Custom** (Any standard OpenAI-compatible `/chat/completions` endpoint)

### AI Agent Features:
* **Natural-Language Understanding**: Interprets complex issue descriptions and extracts key facts.
* **Clarifying Questions**: Detects missing facts and prompts the customer with 1-3 targeted questions.
* **Grounded Policy Answers**: Answers questions regarding returns, replacements, and refunds using `server/policy.js`.
* **Verified Case Status**: Inquiries about case IDs look up backend facts without inventing deadlines.
* **Honest Unknown-Answer Behavior**: Admits uncertainty for out-of-scope queries and offers human support escalation.
* **Structured AI Copilot for Agents**: Analyzes cases for support agents, identifying missing information, drafting customer responses, and suggesting next actions with an advisory priority score.

---

## 4. Setup & Running Locally

### Prerequisites:
* Node.js 18 or newer
* npm

### Step 1: Install Dependencies
```bash
npm install
```

### Step 2: Configure Environment Variables
Copy `.env.example` to `.env`:
```bash
copy .env.example .env
```

Configure your AI provider in `.env`:
```env
AI_PROVIDER=groq
AI_API_KEY=your_actual_groq_api_key_here
AI_BASE_URL=https://api.groq.com/openai/v1
AI_MODEL=llama-3.3-70b-versatile
```

*(Note: If `AI_API_KEY` is left blank, the application automatically runs in grounded deterministic fallback mode using verified backend records and approved policies.)*

### Step 3: Start the Application

To run both backend and frontend concurrently:
```bash
npm run dev
```

Or run them in separate terminals:
```bash
# Terminal 1: Backend Server (Port 4000)
npm run server

# Terminal 2: Frontend Client (Port 5173)
npm run client
```

### Step 4: Open in Your Browser
* **Customer Portal**: [http://localhost:5173](http://localhost:5173)
* **Support Workspace**: [http://localhost:5173/?workspace=agent](http://localhost:5173/?workspace=agent)
* **Backend Health Check**: [http://localhost:4000/api/health](http://localhost:4000/api/health)

---

## 5. Staff & Development Credentials

* **Support Agent Account**:
  * Email: `agent@promiseloop.local`
  * Password: `SupportDemo2026!`
* **Support Manager Account** (Authorized for priority overrides):
  * Email: `manager@promiseloop.local`
  * Password: `ManagerDemo2026!`
* **Customer Accounts**: Customers can register and sign in with any valid email on the Customer Portal.

---

## 6. Automated Test Suite

A complete test suite is included in `tests/`:
* `tests/ai-provider.test.js` — Mocked provider API tests for timeouts, rate limits, invalid keys, outages, and malformed responses.
* `tests/ai-structured.test.js` — Schema validation for structured outputs and enum constraints.
* `tests/security.test.js` — Authentication, authorization, image upload validation, and customer isolation.
* `tests/workflow-integration.test.js` — Full workflow from customer case creation with photo, to queue management, internal note exclusion, and resolution.

Run all tests:
```bash
npm test
```

Build the production bundle:
```bash
npm run build
```

---

## 7. Files Changed in this Integration

* `server/index.js` — Safe data persistence, dynamic storage paths, internal notes isolation, grounded customer AI assistant, and agent copilot endpoints.
* `server/ai.js` — Configurable multi-provider adapter, robust error handling (timeouts, rate limits, 401s), structured JSON validation, and agent copilot analysis.
* `server/policy.js` (New) — Approved policy source for returns, refunds, replacements, safety hazards, and delivery delays.
* `client/src/CustomerPortal.jsx` — Added Admin/Support Team login button, natural conversation flow, retry controls, case summary confirmation, and honest AI status badge.
* `client/src/AgentPortal.jsx` — Added AI Copilot structured analysis cards, one-click draft-to-reply copy, and staff login documentation.
* `vite.config.js` — Added proxy configuration and server network bindings.
* `tests/ai-provider.test.js` (New) — Mocked AI provider unit tests.
* `tests/workflow-integration.test.js` (New) — End-to-end integration test suite.
* `.env.example` — Updated with multi-provider setup and credential templates.
* `README.md` — Updated with audit findings, architecture, setup instructions, and test results.
