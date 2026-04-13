import type {
  Project,
  SessionSummary,
  Contract,
  HealthStatus,
  Stats,
  FileNode,
  BuildResult,
  ContractFunctionAbi,
} from '../types'

const BASE = '/api'

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`)
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
  return r.json()
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
  return r.json()
}

async function patch<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
  return r.json()
}

async function put<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
  return r.json()
}

// ── Normalizers (snake_case DB rows → camelCase frontend types) ────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeProject(p: any): Project {
  return {
    id: p.id,
    userId: p.user_id ?? p.userId ?? '',
    name: p.name,
    spec: p.spec ?? '',
    phase: (p.phase ?? 'design') as 'design' | 'code',
    network: p.network,
    workspaceDir: p.workspace_dir ?? p.workspaceDir ?? '',
    createdAt: p.created_at ?? p.createdAt ?? Date.now(),
    updatedAt: p.updated_at ?? p.updatedAt ?? Date.now(),
    contractCount: p.contractCount,
    appName: p.app_name ?? p.appName ?? '',
    appDescription: p.app_description ?? p.appDescription ?? '',
    appTags: p.app_tags ?? p.appTags ?? '',
    appLogoUrl: p.app_logo_url ?? p.appLogoUrl ?? '',
    appBannerUrl: p.app_banner_url ?? p.appBannerUrl ?? '',
    appRuntimeUrl: p.app_runtime_url ?? p.appRuntimeUrl ?? '',
    appLikeCount: p.app_like_count ?? p.appLikeCount ?? 0,
    appDislikeCount: p.app_dislike_count ?? p.appDislikeCount ?? 0,
    appPublishedAt: p.app_published_at ?? p.appPublishedAt ?? null,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeContract(c: any): Contract {
  return {
    id: c.id,
    contractId: c.contract_id ?? c.contractId ?? '',
    projectId: c.project_id ?? c.projectId ?? '',
    sessionId: c.session_id ?? c.sessionId ?? '',
    userId: c.user_id ?? c.userId ?? '',
    network: c.network,
    wasmPath: c.wasm_path ?? c.wasmPath ?? null,
    sourceAccount: c.source_account ?? c.sourceAccount ?? null,
    name: c.contract_alias ?? c.name ?? null,
    deployedAt: c.deployed_at ?? c.deployedAt ?? Date.now(),
    status: 'deployed' as const,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeFileNode(n: any): FileNode {
  return {
    name: n.name,
    path: n.path,
    isDirectory: n.isDirectory ?? n.type === 'dir',
    children: n.children?.map(normalizeFileNode),
  }
}

// ── API ────────────────────────────────────────────────────────────────────

export const api = {
  health: () => get<HealthStatus>('/health'),
  stats: () => get<Stats>('/stats'),

  // Projects
  getProjects: async (userId: string): Promise<Project[]> => {
    const res = await get<{ projects: unknown[] }>(`/projects?userId=${encodeURIComponent(userId)}`)
    return res.projects.map(normalizeProject)
  },

  createProject: async (body: {
    userId: string
    name: string
    description?: string
    network: 'testnet' | 'mainnet' | 'futurenet' | 'local'
  }): Promise<Project> => {
    const res = await post<unknown>('/projects', body)
    return normalizeProject(res)
  },

  updateProject: async (id: string, body: {
    spec?: string
    appName?: string
    appDescription?: string
    appTags?: string
    appLogoUrl?: string
    appBannerUrl?: string
    appRuntimeUrl?: string
    appLikeCount?: number
    appDislikeCount?: number
    appPublishedAt?: number | null
  }): Promise<Project> => {
    const res = await patch<unknown>(`/projects/${id}`, body)
    return normalizeProject(res)
  },

  getProject: async (id: string): Promise<{ project: Project; contracts: Contract[] }> => {
    const res = await get<{ project: unknown; contracts: unknown[] }>(`/projects/${id}`)
    return {
      project: normalizeProject(res.project),
      contracts: res.contracts.map(normalizeContract),
    }
  },

  getContracts: async (projectId: string): Promise<Contract[]> => {
    const res = await get<{ contracts: unknown[] }>(`/projects/${projectId}/contracts`)
    return res.contracts.map(normalizeContract)
  },

  reactToApp: async (projectId: string, type: 'like' | 'dislike'): Promise<Project> => {
    const res = await post<unknown>(`/projects/${projectId}/reaction`, { type })
    return normalizeProject(res)
  },

  // Sessions
  getSessions: async (userId: string, projectId?: string): Promise<SessionSummary[]> => {
    let url = `/sessions?userId=${encodeURIComponent(userId)}`
    if (projectId) url += `&projectId=${encodeURIComponent(projectId)}`
    const res = await get<{ sessions: SessionSummary[] }>(url)
    return res.sessions
  },

  getMessages: async (sessionId: string): Promise<{
    messages: import('../types').ChatMessage[]
    projectSpec?: string
  }> => {
    const res = await get<{
      messages: Array<{
        role: string
        content: string
        createdAt: number
        toolUses?: Array<{ id: string; name: string; input: unknown; status: string; result?: string }>
      }>
      projectSpec?: string
    }>(`/sessions/${sessionId}/messages`)
    return {
      messages: res.messages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
        timestamp: new Date(m.createdAt).toISOString(),
        toolUses: m.toolUses?.map((t) => ({
          id: t.id,
          name: t.name,
          input: t.input,
          status: t.status as 'success' | 'error' | 'running',
          result: t.result,
        })),
      })),
      projectSpec: res.projectSpec,
    }
  },

  // Workspace: files
  getFiles: async (projectId: string): Promise<FileNode[]> => {
    const res = await get<{ files: unknown[] }>(`/workspace/${projectId}/files`)
    return res.files.map(normalizeFileNode)
  },

  getFile: async (projectId: string, filePath: string): Promise<string> => {
    const res = await get<{ content: string }>(`/workspace/${projectId}/file?path=${encodeURIComponent(filePath)}`)
    return res.content
  },

  saveFile: async (projectId: string, filePath: string, content: string): Promise<void> => {
    await put(`/workspace/${projectId}/file?path=${encodeURIComponent(filePath)}`, { content })
  },

  // Workspace: build & test
  buildContract: (projectId: string): Promise<BuildResult> =>
    post(`/workspace/${projectId}/build`, {}),

  runTests: (projectId: string): Promise<BuildResult> =>
    post(`/workspace/${projectId}/test`, {}),

  listWasmArtifacts: async (projectId: string): Promise<string[]> => {
    const res = await get<{ files: string[] }>(`/workspace/${projectId}/artifacts/wasm`)
    return res.files
  },

  deployContract: (projectId: string, body: {
    wasmPath: string
    source: string
    contractAlias?: string
    network?: string
    sessionId?: string
  }): Promise<BuildResult> =>
    post(`/workspace/${projectId}/deploy`, body),

  getContractAbi: async (projectId: string, contractId: string, network?: string): Promise<{
    success: boolean
    output: string
    functions: ContractFunctionAbi[]
  }> =>
    get(`/workspace/${projectId}/contracts/${contractId}/abi${network ? `?network=${encodeURIComponent(network)}` : ''}`),

  invokeContract: (projectId: string, contractId: string, body: {
    functionName: string
    params?: Record<string, string>
    source: string
    network?: string
    sendTransaction?: boolean
  }): Promise<BuildResult> =>
    post(`/workspace/${projectId}/contracts/${contractId}/invoke`, body),

  getRuntimeInfo: (projectId: string): Promise<{ available: boolean; url?: string }> =>
    get(`/workspace/${projectId}/runtime-info`),

  getLogs: async (sessionId: string): Promise<string[]> => {
    const res = await get<{ logs: Array<{ message: string }> }>(`/sessions/${sessionId}/logs`)
    return res.logs.map((l) => l.message)
  },

  // Accept the spec and transition the session to code phase
  acceptSpec: (sessionId: string): Promise<{ ok: boolean; phase: string }> =>
    post(`/sessions/${sessionId}/accept`, {}),

  // Chat (raw fetch — caller handles SSE)
  chat: (body: {
    message: string
    sessionId?: string
    projectId?: string
    userId?: string
    network?: string
    agentMode?: 'contract' | 'ui'
  }) =>
    fetch(`${BASE}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
}
