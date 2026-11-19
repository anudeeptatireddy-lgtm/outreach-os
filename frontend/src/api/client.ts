// Typed API client. Every call goes through `request`, which talks to the FastAPI backend
// (cookie session, JSON) or, when VITE_MOCK=1, to the in-memory mock in ./mock.ts.
import type {
  AddProspectsBody,
  AddProspectsResult,
  AnalyticsOverview,
  BulkApproveResult,
  Campaign,
  CampaignPatch,
  Event,
  Health,
  IntegrationName,
  ManualContactBody,
  Message,
  MessagePatch,
  MessageStatus,
  NewCampaign,
  Playbook,
  PlaybookInput,
  PlaybookSummary,
  PlaybookTemplate,
  ProspectDetail,
  ProspectRow,
  ProspectStatus,
  SecretsBody,
  Session,
  Settings,
  SettingsPatch,
  Suppression,
  TestResult,
  WorkerTick,
} from "./types";

export const MOCK = import.meta.env.VITE_MOCK === "1";

export class ApiError extends Error {
  status: number;
  detail: string;
  errors: string[];
  constructor(status: number, detail: string, errors: string[] = []) {
    super(detail);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
    this.errors = errors;
  }
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** No sign-in: a 401 means the browser lost its guest cookie, so reload and get a fresh workspace. */
function redirectToLogin() {
  if (typeof window === "undefined" || !window.location.pathname.startsWith("/app")) return;
  try {
    if (sessionStorage.getItem("guest-reload")) return; // cookies blocked: don't loop
    sessionStorage.setItem("guest-reload", "1");
  } catch {
    return;
  }
  window.location.reload();
}

let mockModule: Promise<typeof import("./mock")> | null = null;

async function request<T>(method: Method, path: string, body?: unknown, opts: { noRedirect?: boolean } = {}): Promise<T> {
  if (MOCK) {
    mockModule ??= import("./mock");
    const m = await mockModule;
    try {
      return (await m.mockRequest(method, path, body)) as T;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401 && !opts.noRedirect) redirectToLogin();
      throw e;
    }
  }

  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: "include",
      headers: body !== undefined ? { "Content-Type": "application/json", Accept: "application/json" } : { Accept: "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your connection and try again.");
  }

  if (res.status === 401) {
    if (!opts.noRedirect) redirectToLogin();
    throw new ApiError(401, "not_authenticated");
  }

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    const d = (data && typeof data === "object" ? data : {}) as { detail?: unknown; errors?: unknown };
    const detail = typeof d.detail === "string" ? d.detail : `Request failed (${res.status})`;
    const errors = Array.isArray(d.errors) ? d.errors.map(String) : [];
    throw new ApiError(res.status, detail, errors);
  }
  return data as T;
}

function qs(params: Record<string, string | number | null | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

export const api = {
  // Auth
  guest: () => request<Session>("POST", "/api/auth/guest", {}, { noRedirect: true }),
  me: () => request<Session>("GET", "/api/auth/me", undefined, { noRedirect: true }),

  health: () => request<Health>("GET", "/api/health"),

  // Settings
  settings: () => request<Settings>("GET", "/api/settings"),
  patchSettings: (b: SettingsPatch) => request<Settings>("PATCH", "/api/settings", b),
  putSecrets: (b: SecretsBody) => request<Settings>("PUT", "/api/settings/secrets", b),
  testIntegration: (name: IntegrationName) => request<TestResult>("POST", `/api/settings/test/${name}`, {}),

  // Playbooks
  playbooks: () => request<PlaybookSummary[]>("GET", "/api/playbooks"),
  playbookTemplates: () => request<PlaybookTemplate[]>("GET", "/api/playbooks/templates"),
  createPlaybook: (b: { template: "sprinto" | "blank"; name?: string }) => request<Playbook>("POST", "/api/playbooks", b),
  generatePlaybook: (website: string) => request<Playbook>("POST", "/api/playbooks/generate", { website }),
  playbook: (id: number) => request<Playbook>("GET", `/api/playbooks/${id}`),
  putPlaybook: (id: number, b: PlaybookInput) => request<Playbook>("PUT", `/api/playbooks/${id}`, b),
  duplicatePlaybook: (id: number) => request<Playbook>("POST", `/api/playbooks/${id}/duplicate`, {}),
  deletePlaybook: (id: number) => request<{ ok: true }>("DELETE", `/api/playbooks/${id}`),

  // Campaigns
  campaigns: () => request<Campaign[]>("GET", "/api/campaigns"),
  createCampaign: (b: NewCampaign) => request<Campaign>("POST", "/api/campaigns", b),
  campaign: (id: number) => request<Campaign>("GET", `/api/campaigns/${id}`),
  patchCampaign: (id: number, b: CampaignPatch) => request<Campaign>("PATCH", `/api/campaigns/${id}`, b),
  deleteCampaign: (id: number) => request<{ ok: true }>("DELETE", `/api/campaigns/${id}`),
  addProspects: (id: number, b: AddProspectsBody) => request<AddProspectsResult>("POST", `/api/campaigns/${id}/prospects`, b),
  exportCampaignUrl: (id: number) => `/api/campaigns/${id}/export.csv`,

  // Prospects
  prospects: (campaignId: number, params: { status?: ProspectStatus | ""; q?: string } = {}) =>
    request<ProspectRow[]>("GET", `/api/campaigns/${campaignId}/prospects${qs(params)}`),
  prospect: (id: number) => request<ProspectDetail>("GET", `/api/prospects/${id}`),
  rerunProspect: (id: number) => request<ProspectRow>("POST", `/api/prospects/${id}/rerun`, {}),
  overrideProspect: (id: number) => request<ProspectRow>("POST", `/api/prospects/${id}/override`, {}),
  setContact: (id: number, b: ManualContactBody) => request<ProspectRow>("PUT", `/api/prospects/${id}/contact`, b),
  deleteProspect: (id: number) => request<{ ok: true }>("DELETE", `/api/prospects/${id}`),

  // Messages
  messages: (params: { status?: MessageStatus | ""; campaign_id?: number } = {}) =>
    request<Message[]>("GET", `/api/messages${qs(params)}`),
  message: (id: number) => request<Message>("GET", `/api/messages/${id}`),
  patchMessage: (id: number, b: MessagePatch) => request<Message>("PATCH", `/api/messages/${id}`, b),
  approveMessage: (id: number, send_at: string | null = null, force = false) =>
    request<Message>("POST", `/api/messages/${id}/approve`, force ? { send_at, force: true } : { send_at }),
  rejectMessage: (id: number) => request<Message>("POST", `/api/messages/${id}/reject`, {}),
  regenerateMessage: (id: number, instructions?: string) =>
    request<Message>("POST", `/api/messages/${id}/regenerate`, instructions ? { instructions } : {}),
  markReplied: (id: number) => request<Message>("POST", `/api/messages/${id}/mark-replied`, {}),
  bulkApprove: (ids: number[]) => request<BulkApproveResult>("POST", "/api/messages/bulk-approve", { ids }),

  // Worker: on Vercel there is no background worker; the open dashboard pumps this.
  workerTick: () => request<WorkerTick>("POST", "/api/worker/tick", {}),

  // Analytics and activity
  overview: (campaignId?: number) => request<AnalyticsOverview>("GET", `/api/analytics/overview${qs({ campaign_id: campaignId })}`),
  activity: (params: { limit?: number; prospect_id?: number } = {}) => request<Event[]>("GET", `/api/activity${qs({ limit: params.limit ?? 50, prospect_id: params.prospect_id })}`),

  // Suppressions
  suppressions: () => request<Suppression[]>("GET", "/api/suppressions"),
  addSuppression: (b: { value: string; reason?: string }) => request<Suppression>("POST", "/api/suppressions", b),
  deleteSuppression: (id: number) => request<{ ok: true }>("DELETE", `/api/suppressions/${id}`),
};

/** Download the campaign CSV. Real backend: navigate to the file URL. Mock: build it locally. */
export async function downloadCampaignCsv(id: number, filename = `campaign-${id}.csv`) {
  if (MOCK) {
    const m = await import("./mock");
    const csv = m.mockExportCsv(id);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  const a = document.createElement("a");
  a.href = api.exportCampaignUrl(id);
  a.download = filename;
  a.click();
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.detail;
  if (e instanceof Error) return e.message;
  return "Something went wrong";
}
