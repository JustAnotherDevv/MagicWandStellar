import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT_DIR = path.resolve(__dirname, '..', '..');

export const PORT = parseInt(process.env.PORT ?? '3000', 10);
export const DOCS_DIR = path.resolve(process.env.DOCS_DIR ?? path.join(ROOT_DIR, 'docs'));
export const WORKSPACES_DIR = path.resolve(
  process.env.WORKSPACES_DIR ?? path.join(ROOT_DIR, 'workspaces'),
);
export const DB_DIR  = path.resolve(process.env.DB_DIR  ?? path.join(ROOT_DIR, 'data'));
export const DB_PATH = path.resolve(process.env.DB_PATH ?? path.join(DB_DIR,   'stellar-agents.db'));
export const DEFAULT_NETWORK = (process.env.DEFAULT_NETWORK ?? 'testnet') as StellarNetwork;
export const DEFAULT_THINKING_BUDGET = parseInt(
  process.env.DEFAULT_THINKING_BUDGET ?? '8000',
  10,
);
export const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY ?? '';
export const MINIMAX_BASE_URL = 'https://api.minimax.io/v1';
// MiniMax model name — can be overridden via env
export const MODEL = process.env.MODEL ?? 'MiniMax-M2.7';

// ── Stellar agent wallet ──────────────────────────────────────────────────────
export const STELLAR_SECRET_KEY = process.env.STELLAR_SECRET_KEY ?? '';
export const STELLAR_PUBLIC_KEY = process.env.STELLAR_PUBLIC_KEY ?? '';

// ── MPP payment middleware (protect /chat) ────────────────────────────────────
// Set MPP_ENABLED=true to require 0.01 USDC per chat request via MPP
export const MPP_ENABLED = process.env.MPP_ENABLED === 'true';
export const MPP_SECRET_KEY = process.env.MPP_SECRET_KEY ?? 'stellar-agents-dev-secret-change-in-production';
export const MPP_AMOUNT_USDC = process.env.MPP_AMOUNT_USDC ?? '0.01';

// ── x402 facilitator ─────────────────────────────────────────────────────────
export const X402_FACILITATOR_URL = process.env.X402_FACILITATOR_URL ?? 'https://www.x402.org/facilitator';

export type StellarNetwork = 'testnet' | 'mainnet' | 'futurenet' | 'local';

export const RPC_URLS: Record<string, string> = {
  testnet: 'https://soroban-testnet.stellar.org',
  mainnet: 'https://rpc.stellar.org',
  futurenet: 'https://rpc-futurenet.stellar.org',
  local: 'http://localhost:8000/soroban/rpc',
};

export const HORIZON_URLS: Record<string, string> = {
  testnet: 'https://horizon-testnet.stellar.org',
  mainnet: 'https://horizon.stellar.org',
  futurenet: 'https://horizon-futurenet.stellar.org',
  local: 'http://localhost:8000',
};

export const FRIENDBOT_URLS: Record<string, string> = {
  testnet: 'https://friendbot.stellar.org',
  futurenet: 'https://friendbot-futurenet.stellar.org',
  local: 'http://localhost:8000/friendbot',
};

export const NETWORK_PASSPHRASES: Record<string, string> = {
  testnet: 'Test SDF Network ; September 2015',
  mainnet: 'Public Global Stellar Network ; September 2015',
  futurenet: 'Test SDF Future Network ; October 2022',
  local: 'Standalone Network ; February 2017',
};

export function validateConfig(): void {
  if (!MINIMAX_API_KEY) {
    throw new Error('MINIMAX_API_KEY environment variable is required');
  }
}
