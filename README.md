<img src="logo.png" alt="MagicWand" width="120" />

# MagicWand

**Agentic Stellar App Store & App Building Agent**

Platform that combines no-code creation and discovery for agents and humans — describe your app in natural language, watch an AI agent build it, then publish it to the store in minutes.

---

## What is MagicWand?

### MagicWand Agent
1. **Describe** your app in natural language
2. **Get** a mermaid architecture diagram + contract spec
3. **Approve** and watch the agent build production-ready Soroban contracts with full end-to-end tests
4. **Get** a custom UI interface connected to your contracts automatically
5. **Edit** metadata, deploy on-chain, and publish to the App Store

### MagicWand App Store
- **Publish** your own apps and monetize them in minutes
- **Discover** products from any category — DeFi, games, payments
- **Interact** with integrated Stellar protocols
- Humans use apps from the UI; agents access them through the MCP server and x402 micropayments

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Frontend (React + Vite)                                        │
│  Chat → Spec → Code → Build → Deploy → Publish                 │
└──────────────────────┬──────────────────────────────────────────┘
                       │ SSE  /chat
┌──────────────────────▼──────────────────────────────────────────┐
│  Backend (Express + TypeScript)                                 │
│  Agent Loop  ·  RAG (BM25)  ·  SQLite  ·  Workspace FS         │
└──────┬───────────────┬──────────────────┬───────────────────────┘
       │               │                  │
  MiniMax LLM    Stellar SDK        x402 / MPP
  (tool calls)   (build/deploy)   (402 payments)
```

- **Agent loop** — up to 20 turns with automatic retry on rate limits (63 s) and provider errors
- **Tools** — `write_file`, `read_file`, `contract_init`, `contract_build`, `contract_deploy`, `contract_invoke`, `update_project_spec`, `search_docs`, and more
- **RAG** — BM25 full-text search over 26 Stellar/Soroban skill docs injected per request
- **Workspace** — isolated per-project filesystem, surfaced via `/workspace/:projectId/*` REST routes
- **Persistence** — SQLite (better-sqlite3): sessions, messages, projects, contracts, logs survive restarts
- **Payments** — optional x402/MPP middleware gates `/chat` behind a 402 USDC micropayment

---

## Quick Start

### Prerequisites
- Node.js 20+
- Rust + `cargo` + `stellar-cli` (for contract compilation)
- [Freighter wallet](https://freighter.app) browser extension
- [MiniMax API key](https://platform.minimax.io)

### 1. Clone & install

```bash
git clone https://github.com/your-org/magicwand
cd magicwand
npm install
cd frontend && npm install && cd ..
```

### 2. Configure environment

```bash
cp .env.example .env
# Fill in MINIMAX_API_KEY and STELLAR_SECRET_KEY
```

| Variable | Required | Description |
|---|---|---|
| `MINIMAX_API_KEY` | Yes | MiniMax API key (`sk-api-...`) |
| `STELLAR_SECRET_KEY` | Yes | Agent wallet secret key (`S...`) |
| `STELLAR_PUBLIC_KEY` | Yes | Agent wallet public key (`G...`) |
| `STELLAR_NETWORK` | No | `testnet` (default) or `mainnet` |
| `MPP_ENABLED` | No | `true` to gate `/chat` with 0.01 USDC |
| `MPP_AMOUNT_USDC` | No | Cost per request (default `0.01`) |
| `MPP_SECRET_KEY` | No | HMAC secret for MPP challenges |
| `PORT` | No | HTTP port (default `3000`) |

### 3. Download Stellar docs (for RAG)

```bash
npm run setup:docs
```

### 4. Run

```bash
# Backend
npm run dev

# Frontend (separate terminal)
cd frontend && npm run dev
```

Open [http://localhost:5173](http://localhost:5173), connect your Freighter wallet, and start building.

---

## API

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check |
| `POST` | `/chat` | Start/resume agent session (SSE stream) |
| `GET` | `/sessions?userId=` | List sessions for a user |
| `DELETE` | `/sessions/:id` | Delete a session |
| `GET` | `/projects/:id` | Get project details + spec |
| `GET` | `/projects/:id/logs` | Get project-level logs |
| `GET` | `/sessions/:id/logs` | Get session-level logs |
| `GET` | `/workspace/:projectId/files` | Browse workspace file tree |
| `GET` | `/workspace/:projectId/file?path=` | Read a workspace file |
| `POST` | `/workspace/:projectId/build` | Build the contract |
| `POST` | `/workspace/:projectId/test` | Run contract tests |
| `POST` | `/workspace/:projectId/deploy` | Deploy to Stellar |

### Chat request body

```json
{
  "message": "Build me a counter contract",
  "userId": "user_abc",
  "sessionId": "sess_...",
  "projectId": "proj_...",
  "network": "testnet"
}
```

### SSE event types

| Type | Description |
|---|---|
| `session_created` | New session ID |
| `text_delta` | Streaming text from the model |
| `thinking` | Extended thinking tokens (if enabled) |
| `tool_use` | Agent is calling a tool |
| `tool_result` | Tool execution result |
| `spec_updated` | Project spec updated (triggers UI refresh) |
| `done` | Stream complete with token usage |
| `error` | Unrecoverable error |

---

## Payments (x402 / MPP)

When `MPP_ENABLED=true`, every `/chat` request requires a **0.01 USDC** Stellar payment via the [x402 protocol](https://x402.org).

- Agent clients receive a `402 Payment Required` with a `WWW-Authenticate` header
- Pay using any MPP-compatible wallet or the `@stellar/mpp` SDK
- The facilitator endpoint is configurable via `X402_FACILITATOR_URL`

MCP server access follows the same payment flow, enabling other AI agents to use MagicWand as a paid tool.

---

## Testing

```bash
# Unit + integration (no API key needed)
npm test

# Unit only
npm run test:unit

# Integration only
npm run test:integration

# E2E full workflow (requires MINIMAX_API_KEY)
npm run test:e2e
```

Tests use **vitest** with an isolated in-memory server per suite.  
E2E tests skip automatically when no valid API key is present.

---

## Tech Stack

| Layer | Technology |
|---|---|
| LLM | MiniMax Text-01 (OpenAI-compatible) |
| Backend | Node.js, Express, TypeScript |
| Frontend | React 18, Vite, Tailwind CSS |
| Database | SQLite (better-sqlite3) |
| Smart Contracts | Rust, Soroban (Stellar) |
| Payments | x402, MPP (`@stellar/mpp`) |
| Wallet | Freighter (`@stellar/freighter-api`) |
| Testing | Vitest |

---

## License

ISC
