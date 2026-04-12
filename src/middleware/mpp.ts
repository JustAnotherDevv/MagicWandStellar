/**
 * MPP (Machine Payments Protocol) middleware for Express.
 *
 * When MPP_ENABLED=true, POST /chat requires 0.01 USDC payment per request
 * using the Stellar MPP charge protocol. Clients receive a WWW-Authenticate
 * challenge on 402 and must pay with a Stellar USDC wallet.
 *
 * The agent's STELLAR_PUBLIC_KEY receives the payments.
 */
import type { Request, Response, NextFunction } from 'express';
import { charge, Mppx } from '@stellar/mpp/charge/server';
import { USDC_SAC_TESTNET, USDC_SAC_MAINNET, STELLAR_TESTNET, toBaseUnits } from '@stellar/mpp';
import {
  MPP_ENABLED,
  MPP_SECRET_KEY,
  MPP_AMOUNT_USDC,
  STELLAR_PUBLIC_KEY,
  DEFAULT_NETWORK,
} from '../config/index.js';

// ── Singleton MPP server instance ─────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _mppServer: any = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getMppServer(): any {
  if (_mppServer) return _mppServer;

  const isMainnet = DEFAULT_NETWORK === 'mainnet';
  const network = isMainnet ? 'stellar:pubnet' : STELLAR_TESTNET;
  const currency = isMainnet ? USDC_SAC_MAINNET : USDC_SAC_TESTNET;

  if (!STELLAR_PUBLIC_KEY) {
    throw new Error(
      'STELLAR_PUBLIC_KEY is required when MPP_ENABLED=true. Set it in your .env file.',
    );
  }

  _mppServer = Mppx.create({
    methods: [
      charge({
        recipient: STELLAR_PUBLIC_KEY,
        currency,
        network,
      }),
    ],
    secretKey: MPP_SECRET_KEY,
  });

  const usdc = isMainnet ? 'USDC (mainnet)' : 'USDC (testnet)';
  console.log(`[mpp] Server initialised — ${MPP_AMOUNT_USDC} ${usdc} per /chat request → ${STELLAR_PUBLIC_KEY}`);
  return _mppServer;
}

// ── Middleware ────────────────────────────────────────────────────────────────

/**
 * Express middleware: require an MPP payment before processing /chat.
 *
 * On no/invalid payment: returns HTTP 402 with WWW-Authenticate challenge.
 * On valid payment: sets Payment-Receipt header, calls next().
 */
export async function mppPaymentMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let server: any;
  try {
    server = getMppServer();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[mpp] Init error:', msg);
    res.status(500).json({ error: `MPP server init failed: ${msg}` });
    return;
  }

  const amountBaseUnits = toBaseUnits(MPP_AMOUNT_USDC, 7);
  const handler = server.charge({
    amount: amountBaseUnits,
    description: `Stellar AI Agent - 1 response turn (${MPP_AMOUNT_USDC} USDC)`,
  });

  try {
    const result = await Mppx.toNodeListener(handler)(req, res);
    if (result.status === 402) {
      // 402 challenge already written to res by toNodeListener
      console.log('[mpp] 402 challenge issued');
      return;
    }
    // Payment verified — Payment-Receipt header already set on res
    console.log('[mpp] Payment verified, proceeding to agent');
    next();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[mpp] Payment error:', msg);
    res.status(500).json({ error: `MPP payment error: ${msg}` });
  }
}

/** No-op pass-through used when MPP_ENABLED=false */
export function noopMiddleware(
  _req: Request,
  _res: Response,
  next: NextFunction,
): void {
  next();
}

/** Returns the active payment middleware based on MPP_ENABLED */
export function paymentMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void | Promise<void> {
  if (MPP_ENABLED) {
    return mppPaymentMiddleware(req, res, next);
  }
  return noopMiddleware(req, res, next);
}
