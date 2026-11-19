// TanStack Query hooks over the typed client. Keys are shared so mutations can invalidate them.
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api } from "./client";
import type { MessageStatus, ProspectStatus } from "./types";

export const qk = {
  me: ["me"] as const,
  settings: ["settings"] as const,
  playbooks: ["playbooks"] as const,
  playbookTemplates: ["playbooks", "templates"] as const,
  playbook: (id: number) => ["playbook", id] as const,
  campaigns: ["campaigns"] as const,
  campaign: (id: number) => ["campaign", id] as const,
  prospects: (campaignId: number, status = "", q = "") => ["prospects", campaignId, status, q] as const,
  prospect: (id: number) => ["prospect", id] as const,
  messages: (status = "", campaignId?: number) => ["messages", status, campaignId ?? null] as const,
  message: (id: number) => ["message", id] as const,
  overview: (campaignId?: number) => ["overview", campaignId ?? null] as const,
  activity: (prospectId?: number, limit = 50) => ["activity", prospectId ?? null, limit] as const,
  suppressions: ["suppressions"] as const,
};

/** Everything that changes when the pipeline moves. */
export function invalidateWork(qc: QueryClient) {
  for (const k of ["prospects", "prospect", "messages", "message", "campaigns", "campaign", "overview", "activity"]) {
    void qc.invalidateQueries({ queryKey: [k] });
  }
}

export const useSettings = () => useQuery({ queryKey: qk.settings, queryFn: api.settings });
export const usePlaybooks = () => useQuery({ queryKey: qk.playbooks, queryFn: api.playbooks });
export const usePlaybookTemplates = () => useQuery({ queryKey: qk.playbookTemplates, queryFn: api.playbookTemplates, staleTime: 60_000 });
export const usePlaybook = (id: number) => useQuery({ queryKey: qk.playbook(id), queryFn: () => api.playbook(id), enabled: Number.isFinite(id) });
export const useCampaigns = () => useQuery({ queryKey: qk.campaigns, queryFn: api.campaigns });
export const useCampaign = (id: number) => useQuery({ queryKey: qk.campaign(id), queryFn: () => api.campaign(id), enabled: Number.isFinite(id) });
export const useProspects = (campaignId: number, status: ProspectStatus | "" = "", q = "", refetchInterval?: number | false) =>
  useQuery({
    queryKey: qk.prospects(campaignId, status, q),
    queryFn: () => api.prospects(campaignId, { status, q }),
    enabled: Number.isFinite(campaignId),
    refetchInterval,
    placeholderData: (prev) => prev,
  });
export const useProspect = (id: number, refetchInterval?: number | false) =>
  useQuery({ queryKey: qk.prospect(id), queryFn: () => api.prospect(id), enabled: Number.isFinite(id), refetchInterval });
export const useMessages = (status: MessageStatus | "" = "", campaignId?: number) =>
  useQuery({ queryKey: qk.messages(status, campaignId), queryFn: () => api.messages({ status, campaign_id: campaignId }) });
export const useOverview = (campaignId?: number) => useQuery({ queryKey: qk.overview(campaignId), queryFn: () => api.overview(campaignId) });
export const useActivity = (prospectId?: number, limit = 50) =>
  useQuery({ queryKey: qk.activity(prospectId, limit), queryFn: () => api.activity({ prospect_id: prospectId, limit }) });
export const useSuppressions = () => useQuery({ queryKey: qk.suppressions, queryFn: api.suppressions });

export { useQueryClient };
