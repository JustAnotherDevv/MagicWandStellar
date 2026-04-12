// NOTE: Import from '@stellar/stellar-sdk/rpc' — not the root package (SDK v15)
import { Server, Durability } from '@stellar/stellar-sdk/rpc';
import { xdr } from '@stellar/stellar-sdk';
import type { ToolResult } from '../types/index.js';
import { RPC_URLS, HORIZON_URLS } from '../config/index.js';

function getRpcServer(network: string): Server {
  const url = RPC_URLS[network];
  if (!url) throw new Error(`Unknown network: ${network}`);
  return new Server(url);
}

export async function getLatestLedger(
  input: { network: string },
): Promise<ToolResult> {
  try {
    const server = getRpcServer(input.network);
    const ledger = await server.getLatestLedger();
    return {
      content: JSON.stringify(ledger, null, 2),
      isError: false,
    };
  } catch (err) {
    return {
      content: `rpc_get_latest_ledger error: ${(err as Error).message}`,
      isError: true,
    };
  }
}

export async function getAccount(
  input: { accountId: string; network: string },
): Promise<ToolResult> {
  try {
    const horizonBase = HORIZON_URLS[input.network] ?? HORIZON_URLS['testnet'];
    const res = await fetch(`${horizonBase}/accounts/${input.accountId}`, {
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      return {
        content: `Horizon HTTP ${res.status}: account not found or network error`,
        isError: true,
      };
    }

    const data = (await res.json()) as {
      id: string;
      sequence: string;
      subentry_count: number;
      balances: Array<{
        balance: string;
        asset_type: string;
        asset_code?: string;
        asset_issuer?: string;
      }>;
    };

    const summary = {
      id: data.id,
      sequence: data.sequence,
      subentryCount: data.subentry_count,
      balances: data.balances.map((b) => ({
        asset:
          b.asset_type === 'native'
            ? 'XLM (native)'
            : `${b.asset_code ?? '?'}:${b.asset_issuer ?? '?'}`,
        balance: b.balance,
      })),
    };

    return { content: JSON.stringify(summary, null, 2), isError: false };
  } catch (err) {
    return {
      content: `rpc_get_account error: ${(err as Error).message}`,
      isError: true,
    };
  }
}

export async function getContractData(
  input: {
    contractId: string;
    keyXdr: string;
    durability: 'persistent' | 'temporary';
    network: string;
  },
): Promise<ToolResult> {
  try {
    const server = getRpcServer(input.network);
    const key = xdr.ScVal.fromXDR(input.keyXdr, 'base64');

    const durability =
      input.durability === 'persistent' ? Durability.Persistent : Durability.Temporary;

    const result = await server.getContractData(input.contractId, key, durability);

    return {
      content: JSON.stringify(
        {
          found: !!result,
          lastModifiedLedger: result?.lastModifiedLedgerSeq,
          liveUntilLedger: result?.liveUntilLedgerSeq,
          valueXdr: result?.val?.toXDR('base64'),
        },
        null,
        2,
      ),
      isError: false,
    };
  } catch (err) {
    return {
      content: `rpc_get_contract_data error: ${(err as Error).message}`,
      isError: true,
    };
  }
}
