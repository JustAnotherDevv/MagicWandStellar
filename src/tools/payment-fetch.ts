/**
 * Payment-enabled fetch tools for the AI agent.
 *
 * x402_fetch  — calls any x402-protected HTTP endpoint, paying automatically
 *               with the agent's STELLAR_SECRET_KEY via the Coinbase x402 protocol.
 *
 * mpp_fetch   — calls any MPP-protected HTTP endpoint, paying automatically
 *               with the agent's STELLAR_SECRET_KEY via the Stellar MPP charge protocol.
 *
 * Both tools produce real Stellar testnet/mainnet transactions.
 */
import { createEd25519Signer } from '@x402/stellar';
import { ExactStellarScheme } from '@x402/stellar/exact/client';
import { x402Client } from '@x402/core/client';
import { x402HTTPClient } from '@x402/core/http';
import { charge, Mppx } from '@stellar/mpp/charge/client';
import type { ToolResult } from '../types/index.js';
import { STELLAR_SECRET_KEY, DEFAULT_NETWORK } from '../config/index.js';

// ── x402 client ───────────────────────────────────────────────────────────────

type X402HTTPClientInstance = InstanceType<typeof x402HTTPClient>;
let _x402HttpClient: X402HTTPClientInstance | null = null;

function getX402Client(): X402HTTPClientInstance {
  if (_x402HttpClient) return _x402HttpClient;

  if (!STELLAR_SECRET_KEY) {
    throw new Error('STELLAR_SECRET_KEY is required for x402 payments. Set it in your .env file.');
  }

  const network = DEFAULT_NETWORK === 'mainnet' ? 'stellar:pubnet' : 'stellar:testnet';
  const signer = createEd25519Signer(STELLAR_SECRET_KEY, network);
  const coreClient = new x402Client().register('stellar:*', new ExactStellarScheme(signer));
  _x402HttpClient = new x402HTTPClient(coreClient);

  console.log(`[x402_fetch] Client initialised for network: ${network}`);
  return _x402HttpClient;
}

/**
 * Fetch an x402-protected URL, paying automatically on 402.
 * The agent's STELLAR_SECRET_KEY signs the Soroban auth entry.
 */
export async function x402Fetch(input: {
  url: string;
  method?: string;
  body?: string;
}): Promise<ToolResult> {
  if (!STELLAR_SECRET_KEY) {
    return {
      content: 'STELLAR_SECRET_KEY not configured — cannot pay for x402 services. Set it in .env.',
      isError: true,
    };
  }

  let httpClient: X402HTTPClientInstance;
  try {
    httpClient = getX402Client();
  } catch (err) {
    return { content: `x402 client init error: ${(err as Error).message}`, isError: true };
  }

  const method = input.method?.toUpperCase() ?? 'GET';
  const url = input.url;

  try {
    // Step 1: initial unauthenticated request
    const firstRes = await fetch(url, {
      method,
      body: input.body,
      signal: AbortSignal.timeout(15_000),
    });

    // If not 402, return response directly
    if (firstRes.status !== 402) {
      const text = await firstRes.text();
      return {
        content: `HTTP ${firstRes.status}\n${text}`,
        isError: !firstRes.ok,
      };
    }

    // Step 2: parse payment requirements from 402 response
    let paymentRequired;
    try {
      const body402 = await firstRes.clone().json().catch(() => null);
      paymentRequired = httpClient.getPaymentRequiredResponse(
        (name: string) => firstRes.headers.get(name),
        body402,
      );
    } catch (err) {
      return {
        content: `x402: failed to parse 402 response: ${(err as Error).message}`,
        isError: true,
      };
    }

    // Step 3: create and sign payment payload
    let paymentPayload;
    try {
      paymentPayload = await httpClient.createPaymentPayload(paymentRequired);
    } catch (err) {
      return {
        content: `x402: failed to create payment payload: ${(err as Error).message}`,
        isError: true,
      };
    }

    const paymentHeaders = httpClient.encodePaymentSignatureHeader(paymentPayload);

    // Step 4: retry with payment header
    const paidRes = await fetch(url, {
      method,
      body: input.body,
      headers: paymentHeaders as HeadersInit,
      signal: AbortSignal.timeout(30_000),
    });

    // Extract settlement/transaction info
    let txHash = 'pending';
    try {
      const settlement = httpClient.getPaymentSettleResponse(
        (name: string) => paidRes.headers.get(name),
      );
      if ((settlement as any)?.transaction) txHash = (settlement as any).transaction;
    } catch {
      // best-effort
    }

    const text = await paidRes.text();
    const paymentNote = `[x402 payment settled — tx: ${txHash}]`;

    return {
      content: `HTTP ${paidRes.status} ${paymentNote}\n${text}`,
      isError: !paidRes.ok,
    };
  } catch (err) {
    return { content: `x402_fetch error: ${(err as Error).message}`, isError: true };
  }
}

// ── MPP client ────────────────────────────────────────────────────────────────

type MppClientInstance = ReturnType<typeof Mppx.create>;
let _mppClient: MppClientInstance | null = null;

function getMppClient(): MppClientInstance {
  if (_mppClient) return _mppClient;

  if (!STELLAR_SECRET_KEY) {
    throw new Error('STELLAR_SECRET_KEY is required for MPP payments. Set it in your .env file.');
  }

  _mppClient = Mppx.create({
    methods: [charge({ secretKey: STELLAR_SECRET_KEY })],
    polyfill: false, // do NOT patch globalThis.fetch
  });

  console.log('[mpp_fetch] Client initialised');
  return _mppClient;
}

/**
 * Fetch an MPP-protected URL, paying automatically on 402.
 * The agent's STELLAR_SECRET_KEY signs the USDC SAC transfer transaction.
 */
export async function mppFetch(input: {
  url: string;
  method?: string;
  body?: string;
}): Promise<ToolResult> {
  if (!STELLAR_SECRET_KEY) {
    return {
      content: 'STELLAR_SECRET_KEY not configured — cannot pay for MPP services. Set it in .env.',
      isError: true,
    };
  }

  let client: MppClientInstance;
  try {
    client = getMppClient();
  } catch (err) {
    return { content: `MPP client init error: ${(err as Error).message}`, isError: true };
  }

  try {
    const response = await client.fetch(input.url, {
      method: input.method ?? 'GET',
      body: input.body,
      signal: AbortSignal.timeout(60_000), // MPP payments need a few ledger closes
    });

    const text = await response.text();
    const receiptHeader = response.headers.get('Payment-Receipt');
    const paymentNote = receiptHeader
      ? '[MPP payment made — receipt received]'
      : '[no payment required]';

    return {
      content: `HTTP ${response.status} ${paymentNote}\n${text}`,
      isError: !response.ok,
    };
  } catch (err) {
    return { content: `mpp_fetch error: ${(err as Error).message}`, isError: true };
  }
}
