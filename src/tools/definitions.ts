import type OpenAI from 'openai';

// OpenAI function-calling format (compatible with OpenRouter)
export type OAITool = OpenAI.Chat.Completions.ChatCompletionTool;

export const TOOLS: OAITool[] = [
  // ── FILE OPERATIONS ────────────────────────────────────────────────────────

  {
    type: 'function',
    function: {
      name: 'read_file',
      description:
        'Read the contents of a file in the session workspace. Path must be relative to the workspace root (e.g. "hello_world/src/lib.rs").',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path from workspace root.' },
        },
        required: ['path'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'write_file',
      description:
        'Write or overwrite a file in the session workspace. Parent directories are created automatically.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path from workspace root.' },
          content: { type: 'string', description: 'Full file content to write.' },
        },
        required: ['path', 'content'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'list_dir',
      description:
        'List files and directories at a path relative to the session workspace root. Returns JSON array of {name, type, size?}.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Relative path from workspace root. Use "." for root.',
          },
        },
        required: ['path'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'delete_file',
      description: 'Delete a file in the session workspace.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path from workspace root.' },
        },
        required: ['path'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'make_dir',
      description: 'Create a directory (and all parents) in the session workspace.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path from workspace root.' },
        },
        required: ['path'],
      },
    },
  },

  // ── STELLAR CLI OPERATIONS ─────────────────────────────────────────────────

  {
    type: 'function',
    function: {
      name: 'contract_init',
      description:
        'Initialize a new Soroban smart contract project using `stellar contract init`. Creates a Cargo workspace with the given contract name inside the session workspace.',
      parameters: {
        type: 'object',
        properties: {
          contractName: {
            type: 'string',
            description: 'Name of the contract (snake_case), e.g. "hello_world", "token_contract".',
          },
        },
        required: ['contractName'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'contract_build',
      description:
        'Build a Soroban contract to WASM using `stellar contract build`. Runs inside the contract project directory. Returns full stdout/stderr — read carefully on failure.',
      parameters: {
        type: 'object',
        properties: {
          contractDir: {
            type: 'string',
            description:
              'Relative path from workspace root to the contract project directory (where Cargo.toml lives), e.g. "hello_world".',
          },
        },
        required: ['contractDir'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'contract_deploy',
      description:
        'Deploy a compiled WASM to the Stellar network using `stellar contract deploy`. Returns the contract ID (C...) on success.',
      parameters: {
        type: 'object',
        properties: {
          wasmPath: {
            type: 'string',
            description:
              'Relative path from workspace root to the .wasm file. After contract_build, it is at: "<contractDir>/target/wasm32-unknown-unknown/release/<name>.wasm".',
          },
          source: {
            type: 'string',
            description: 'Stellar account alias or S... secret key to use as deployer.',
          },
          contractAlias: {
            type: 'string',
            description: 'Optional alias to assign to the deployed contract.',
          },
        },
        required: ['wasmPath', 'source'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'contract_invoke',
      description:
        'Invoke a function on a deployed Soroban contract. Pass function arguments as a flat CLI flag array.',
      parameters: {
        type: 'object',
        properties: {
          contractId: { type: 'string', description: 'The contract ID (C... address) or alias.' },
          source: { type: 'string', description: 'Stellar account alias or S... secret key.' },
          functionName: { type: 'string', description: 'Contract function name to call.' },
          args: {
            type: 'array',
            items: { type: 'string' },
            description: 'Flat list of CLI flag pairs, e.g. ["--to", "GABC...", "--amount", "100"].',
          },
          sendTransaction: {
            type: 'boolean',
            description: 'Whether to send the transaction (true, default) or only simulate (false).',
          },
          network: {
            type: 'string',
            enum: ['testnet', 'mainnet', 'futurenet', 'local'],
            description: 'Network to invoke on. Defaults to session network.',
          },
        },
        required: ['contractId', 'source', 'functionName'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'contract_info',
      description:
        'Get the ABI/interface of a deployed contract using `stellar contract info interface`.',
      parameters: {
        type: 'object',
        properties: {
          contractId: { type: 'string', description: 'Contract ID or alias.' },
          network: { type: 'string', enum: ['testnet', 'mainnet', 'futurenet', 'local'] },
        },
        required: ['contractId'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'stellar_account_info',
      description: 'Get balances and sequence number for a Stellar account from Horizon.',
      parameters: {
        type: 'object',
        properties: {
          accountId: { type: 'string', description: 'G... public key.' },
          network: { type: 'string', enum: ['testnet', 'mainnet', 'futurenet', 'local'] },
        },
        required: ['accountId'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'run_cargo_test',
      description:
        'Run `cargo test` for a Soroban contract project to execute unit and integration tests.',
      parameters: {
        type: 'object',
        properties: {
          contractDir: {
            type: 'string',
            description: 'Relative path from workspace root to the Cargo project directory.',
          },
          testFilter: {
            type: 'string',
            description: 'Optional test name substring to filter, e.g. "test_transfer".',
          },
        },
        required: ['contractDir'],
      },
    },
  },

  // ── RPC / NETWORK OPERATIONS ──────────────────────────────────────────────

  {
    type: 'function',
    function: {
      name: 'rpc_get_latest_ledger',
      description:
        'Fetch the latest ledger sequence and protocol version from Soroban RPC. Use to confirm network connectivity before deploying.',
      parameters: {
        type: 'object',
        properties: {
          network: {
            type: 'string',
            enum: ['testnet', 'mainnet', 'futurenet'],
            description: 'Stellar network to query.',
          },
        },
        required: ['network'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'rpc_get_account',
      description: 'Fetch account details (balances, sequence) from Horizon.',
      parameters: {
        type: 'object',
        properties: {
          accountId: { type: 'string', description: 'G... Stellar public key.' },
          network: { type: 'string', enum: ['testnet', 'mainnet', 'futurenet'] },
        },
        required: ['accountId', 'network'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'rpc_get_contract_data',
      description: 'Read a contract data ledger entry from Soroban RPC.',
      parameters: {
        type: 'object',
        properties: {
          contractId: { type: 'string', description: 'C... contract address.' },
          keyXdr: { type: 'string', description: 'Base64-encoded XDR ScVal key.' },
          durability: { type: 'string', enum: ['persistent', 'temporary'] },
          network: { type: 'string', enum: ['testnet', 'mainnet', 'futurenet'] },
        },
        required: ['contractId', 'keyXdr', 'durability', 'network'],
      },
    },
  },

  // ── KNOWLEDGE OPERATIONS ──────────────────────────────────────────────────

  {
    type: 'function',
    function: {
      name: 'search_docs',
      description:
        'Search the loaded Stellar/Soroban documentation using BM25 keyword scoring. Returns the top matching chunks.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search keywords, e.g. "require_auth authorization", "storage persistent extend ttl".',
          },
          topK: { type: 'number', description: 'Number of results (default 5, max 15).' },
        },
        required: ['query'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'get_doc',
      description: 'Retrieve the full content of a specific documentation file by filename.',
      parameters: {
        type: 'object',
        properties: {
          filename: {
            type: 'string',
            description: 'Doc filename, e.g. "contracts-soroban.md", "security.md".',
          },
        },
        required: ['filename'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'list_docs',
      description: 'List all available documentation files in the knowledge base with their sizes.',
      parameters: { type: 'object', properties: {} },
    },
  },

  // ── PAYMENT TOOLS ─────────────────────────────────────────────────────────────

  {
    type: 'function',
    function: {
      name: 'x402_fetch',
      description:
        "Fetch an x402-protected HTTP endpoint, automatically paying with the agent's Stellar USDC wallet when the server returns 402. Uses the Coinbase x402 protocol — the agent signs a Soroban auth entry and payment settles on-chain via the x402 facilitator. Use to access paid APIs, data services, or content gated behind x402 micropayments.",
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'Full URL to fetch (e.g. "https://xlm402.com/api/price").',
          },
          method: {
            type: 'string',
            enum: ['GET', 'POST'],
            description: 'HTTP method (default: GET).',
          },
          body: {
            type: 'string',
            description: 'Optional request body for POST requests.',
          },
        },
        required: ['url'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'mpp_fetch',
      description:
        "Fetch an MPP (Machine Payments Protocol)-protected HTTP endpoint, automatically paying with the agent's Stellar USDC wallet when the server returns 402. Uses Stripe's MPP charge protocol on Stellar — the agent signs a SAC USDC transfer (pull mode). Use to access paid APIs protected by MPP, such as https://mpp.stellar.buzz.",
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'Full URL to fetch (e.g. "https://mpp.stellar.buzz/api/endpoint").',
          },
          method: {
            type: 'string',
            enum: ['GET', 'POST'],
            description: 'HTTP method (default: GET).',
          },
          body: {
            type: 'string',
            description: 'Optional request body for POST requests.',
          },
        },
        required: ['url'],
      },
    },
  },

  // ── PROJECT SPEC ──────────────────────────────────────────────────────────

  {
    type: 'function',
    function: {
      name: 'update_project_spec',
      description:
        'Update the project specification document for the current project. The spec is injected into every subsequent system prompt as <project_specification>. Use this to record the full picture: requirements, architecture decisions, contract function signatures, storage layout, deployed contract addresses, and progress notes. Write the complete spec in markdown — it replaces the previous version entirely.',
      parameters: {
        type: 'object',
        properties: {
          spec: {
            type: 'string',
            description: 'Full markdown specification (replaces previous spec entirely).',
          },
        },
        required: ['spec'],
      },
    },
  },
];
