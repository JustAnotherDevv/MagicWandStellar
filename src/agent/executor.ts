import type { Session, ToolResult } from '../types/index.js';
import type { RAGStore } from '../rag/index.js';
import type { DatabaseStore } from '../db/index.js';
import * as fileOps from '../tools/file-ops.js';
import * as stellarCli from '../tools/stellar-cli.js';
import * as rpcOps from '../tools/rpc-ops.js';
import * as knowledge from '../tools/knowledge.js';
import * as projectOps from '../tools/project-ops.js';
import * as paymentFetch from '../tools/payment-fetch.js';

function log(level: 'INFO' | 'WARN' | 'ERROR', msg: string, data?: unknown): void {
  const ts = new Date().toISOString();
  const extra = data !== undefined ? ' ' + JSON.stringify(data) : '';
  console.log(`[${ts}][${level}][executor] ${msg}${extra}`);
}

// Dispatch table — each handler receives (input, session, ragStore, db)
type ToolHandler = (
  input: unknown,
  session: Session,
  ragStore: RAGStore,
  db: DatabaseStore,
) => Promise<ToolResult>;

const HANDLERS: Record<string, ToolHandler> = {
  // File ops
  read_file: (i, s) => fileOps.readFile(i as { path: string }, s.workspaceDir),
  write_file: (i, s) => fileOps.writeFile(i as { path: string; content: string }, s.workspaceDir, s),
  list_dir: (i, s) => fileOps.listDir(i as { path: string }, s.workspaceDir),
  delete_file: (i, s) => fileOps.deleteFile(i as { path: string }, s.workspaceDir),
  make_dir: (i, s) => fileOps.makeDir(i as { path: string }, s.workspaceDir),

  // Stellar CLI
  contract_init: (i, s) => stellarCli.contractInit(i as { contractName: string }, s),
  contract_build: (i, s) => stellarCli.contractBuild(i as { contractDir: string }, s),
  contract_deploy: async (i, s, _rag, db) => {
    const input = i as { wasmPath: string; source: string; contractAlias?: string };
    const result = await stellarCli.contractDeploy(input, s);
    if (!result.isError) {
      const match = result.content.match(/Contract ID: (C[A-Z0-9]{55})/);
      if (match) {
        db.saveContract({
          contractId: match[1],
          projectId: s.projectId,
          sessionId: s.id,
          userId: s.userId,
          network: s.network,
          wasmPath: input.wasmPath,
          sourceAccount: input.source,
          contractAlias: input.contractAlias,
        });
      }
    }
    return result;
  },
  contract_invoke: (i, s) =>
    stellarCli.contractInvoke(
      i as {
        contractId: string;
        source: string;
        functionName: string;
        args?: string[];
        sendTransaction?: boolean;
      },
      s,
    ),
  contract_info: (i, s) => stellarCli.contractInfo(i as { contractId: string }, s),
  stellar_account_info: (i, s) => stellarCli.accountInfo(i as { accountId: string }, s),
  run_cargo_test: (i, s) =>
    stellarCli.runCargoTest(i as { contractDir: string; testFilter?: string }, s),

  // RPC ops
  rpc_get_latest_ledger: (i) => rpcOps.getLatestLedger(i as { network: string }),
  rpc_get_account: (i) => rpcOps.getAccount(i as { accountId: string; network: string }),
  rpc_get_contract_data: (i) =>
    rpcOps.getContractData(
      i as {
        contractId: string;
        keyXdr: string;
        durability: 'persistent' | 'temporary';
        network: string;
      },
    ),

  // Knowledge ops
  search_docs: (i, _s, rag) => knowledge.searchDocs(i as { query: string; topK?: number }, rag),
  get_doc: (i, _s, rag) => knowledge.getDoc(i as { filename: string }, rag),
  list_docs: (_i, _s, rag) => knowledge.listDocs(rag),

  // Project spec
  update_project_spec: (i, s, _rag, db) =>
    projectOps.updateProjectSpec(i as { spec: string }, s, db),

  // Payment tools
  x402_fetch: (i) =>
    paymentFetch.x402Fetch(i as { url: string; method?: string; body?: string }),
  mpp_fetch: (i) =>
    paymentFetch.mppFetch(i as { url: string; method?: string; body?: string }),
};

export async function executeToolSafe(
  toolName: string,
  toolInput: unknown,
  session: Session,
  ragStore: RAGStore,
  db: DatabaseStore,
): Promise<ToolResult> {
  const handler = HANDLERS[toolName];
  if (!handler) {
    log('WARN', `unknown tool "${toolName}"`, { sessionId: session.id });
    return { content: `Unknown tool: "${toolName}"`, isError: true };
  }
  const t0 = Date.now();
  log('INFO', `tool start: ${toolName}`, { sessionId: session.id });
  try {
    const result = await handler(toolInput, session, ragStore, db);
    const elapsedMs = Date.now() - t0;
    if (result.isError) {
      log('WARN', `tool error: ${toolName}`, { elapsedMs, contentLen: result.content.length, sessionId: session.id });
    } else {
      log('INFO', `tool done: ${toolName}`, { elapsedMs, contentLen: result.content.length, sessionId: session.id });
    }
    return result;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const elapsedMs = Date.now() - t0;
    log('ERROR', `tool threw: ${toolName}`, { error: msg, elapsedMs, sessionId: session.id });
    return { content: `Tool execution error in "${toolName}": ${msg}`, isError: true };
  }
}
