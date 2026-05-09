import { create } from "zustand";

export interface MemoryItem {
  id: string;
  memory_type: string;
  content: string;
  confidence: number;
  created_at: number;
  updated_at: number;
  access_count: number;
  status: string;
}

export interface MemoryStats {
  total: number;
  byType: Record<string, number>;
  byStatus: Record<string, number>;
}

export interface EpisodeItem {
  id: string;
  agent_id: string;
  conversation_id: string | null;
  task_id: string;
  title: string;
  summary: string;
  outcome: string;
  time_range_start: number;
  time_range_end: number;
  tools_used: string[];
  files_touched: string[];
  importance: number;
  created_at: number;
  updated_at: number;
}

export interface DailySummaryItem {
  id: string;
  agent_id: string;
  date: string;
  timezone: string;
  summary: string;
  highlights: string[];
  episode_ids: string[];
  memory_change_ids: string[];
  open_questions: string[];
  created_at: number;
  updated_at: number;
}

export interface MemoryReviewItem {
  id: string;
  agent_id: string;
  type: string;
  status: "pending" | "accepted" | "rejected";
  title: string;
  proposed_content: string;
  target_memory_ids: string[];
  source_event_ids: string[];
  confidence: number;
  reason: string;
  created_at: number;
  reviewed_at: number | null;
}

export interface MemoryDecisionSnapshot {
  id: string;
  content: string;
  memory_type: string;
  status: string;
  confidence: number;
  updated_at: number;
}

export interface MemoryDecisionItem {
  id: string;
  agent_id: string;
  dream_run_id: string | null;
  type: string;
  status: "applied" | "skipped" | "failed" | "undone";
  title: string;
  reason: string;
  confidence: number;
  target_memory_ids: string[];
  created_memory_ids: string[];
  source_event_ids: string[];
  before_snapshot: MemoryDecisionSnapshot[];
  after_snapshot: MemoryDecisionSnapshot[];
  created_at: number;
  applied_at: number | null;
  undone_at: number | null;
  error: string | null;
}

export interface DreamRunItem {
  id: string;
  agent_id: string;
  date: string;
  timezone: string;
  trigger: "scheduled" | "manual";
  dry_run: boolean;
  status: "running" | "completed" | "failed";
  started_at: number;
  completed_at: number | null;
  error: string | null;
}

export interface DreamRunResult {
  dryRun: boolean;
  date: string;
  dreamRun: DreamRunItem;
  summary: DailySummaryItem;
  dedupe: {
    scannedCount: number;
    duplicateGroups: unknown[];
    inactiveMemoryIds: string[];
  };
  decisions: MemoryDecisionItem[];
  decisionCount: number;
  pendingReviewCount: number;
}

interface MemoryState {
  memories: MemoryItem[];
  stats: MemoryStats | null;
  episodes: EpisodeItem[];
  dailySummaries: DailySummaryItem[];
  reviewItems: MemoryReviewItem[];
  memoryDecisions: MemoryDecisionItem[];
  dreamRuns: DreamRunItem[];
  dreamResult: DreamRunResult | null;
  loading: boolean;
  detailsLoading: boolean;
  dreamLoading: boolean;
  page: number;
  pageSize: number;
  total: number;
  filterType: string | null;
  searchQuery: string;

  fetchMemories: () => Promise<void>;
  fetchStats: () => Promise<void>;
  fetchEpisodes: () => Promise<void>;
  fetchDailySummaries: () => Promise<void>;
  fetchReviewItems: (status?: MemoryReviewItem["status"]) => Promise<void>;
  fetchMemoryDecisions: (status?: MemoryDecisionItem["status"]) => Promise<void>;
  fetchDreamRuns: () => Promise<void>;
  fetchMemoryWorkspace: () => Promise<void>;
  runDreamDryRun: () => Promise<void>;
  runDreamRealRun: () => Promise<void>;
  acceptReviewItem: (id: string) => Promise<void>;
  rejectReviewItem: (id: string) => Promise<void>;
  undoMemoryDecision: (id: string) => Promise<void>;
  searchMemories: (query: string) => Promise<void>;
  setFilterType: (type: string | null) => void;
  setPage: (page: number) => void;
  deleteMemory: (id: string) => Promise<void>;
  updateMemory: (id: string, content: string) => Promise<void>;
  addMemory: (content: string, memoryType: string) => Promise<void>;
}

export const useMemoryStore = create<MemoryState>((set, get) => ({
  memories: [],
  stats: null,
  episodes: [],
  dailySummaries: [],
  reviewItems: [],
  memoryDecisions: [],
  dreamRuns: [],
  dreamResult: null,
  loading: false,
  detailsLoading: false,
  dreamLoading: false,
  page: 1,
  pageSize: 20,
  total: 0,
  filterType: null,
  searchQuery: "",

  fetchMemories: async () => {
    set({ loading: true });
    try {
      const { page, pageSize, filterType, searchQuery } = get();
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        status: "active",
      });
      if (filterType) params.set("type", filterType);
      if (searchQuery) params.set("search", searchQuery);

      const res = await fetch(`/api/memories?${params}`);
      if (!res.ok) throw new Error("获取记忆列表失败");
      const data = (await res.json()) as { memories: MemoryItem[]; total: number };
      set({ memories: data.memories, total: data.total, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  fetchStats: async () => {
    try {
      const res = await fetch("/api/memories/stats");
      if (!res.ok) throw new Error("获取统计失败");
      const stats = (await res.json()) as MemoryStats;
      set({ stats });
    } catch {
      // silent
    }
  },

  fetchEpisodes: async () => {
    set({ detailsLoading: true });
    try {
      const res = await fetch("/api/memories/episodes?limit=20");
      if (!res.ok) throw new Error("获取经历记录失败");
      const data = (await res.json()) as { episodes: EpisodeItem[] };
      set({ episodes: data.episodes, detailsLoading: false });
    } catch {
      set({ detailsLoading: false });
    }
  },

  fetchDailySummaries: async () => {
    set({ detailsLoading: true });
    try {
      const res = await fetch("/api/memories/daily-summaries?limit=7");
      if (!res.ok) throw new Error("获取每日总结失败");
      const data = (await res.json()) as { summaries: DailySummaryItem[] };
      set({ dailySummaries: data.summaries, detailsLoading: false });
    } catch {
      set({ detailsLoading: false });
    }
  },

  fetchReviewItems: async (status = "pending") => {
    set({ detailsLoading: true });
    try {
      const params = new URLSearchParams({ status, limit: "20" });
      const res = await fetch(`/api/memories/reviews?${params}`);
      if (!res.ok) throw new Error("获取待审查建议失败");
      const data = (await res.json()) as { items: MemoryReviewItem[] };
      set({ reviewItems: data.items, detailsLoading: false });
    } catch {
      set({ detailsLoading: false });
    }
  },

  fetchMemoryDecisions: async (status) => {
    set({ detailsLoading: true });
    try {
      const params = new URLSearchParams({ limit: "30" });
      if (status) params.set("status", status);
      const res = await fetch(`/api/memories/decisions?${params}`);
      if (!res.ok) throw new Error("获取记忆整理记录失败");
      const data = (await res.json()) as { decisions: MemoryDecisionItem[] };
      set({ memoryDecisions: data.decisions, detailsLoading: false });
    } catch {
      set({ detailsLoading: false });
    }
  },

  fetchDreamRuns: async () => {
    set({ detailsLoading: true });
    try {
      const res = await fetch("/api/memories/dream/runs?limit=20");
      if (!res.ok) throw new Error("获取梦整理运行记录失败");
      const data = (await res.json()) as { runs: DreamRunItem[] };
      set({ dreamRuns: data.runs, detailsLoading: false });
    } catch {
      set({ detailsLoading: false });
    }
  },

  fetchMemoryWorkspace: async () => {
    await Promise.all([
      get().fetchMemories(),
      get().fetchStats(),
      get().fetchEpisodes(),
      get().fetchDailySummaries(),
      get().fetchMemoryDecisions(),
      get().fetchDreamRuns(),
    ]);
  },

  runDreamDryRun: async () => {
    set({ dreamLoading: true, dreamResult: null });
    try {
      const res = await fetch("/api/memories/dream/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dryRun: true }),
      });
      if (!res.ok) throw new Error("梦整理试运行失败");
      const result = (await res.json()) as DreamRunResult;
      set({ dreamResult: result, dreamLoading: false });
      await Promise.all([
        get().fetchDailySummaries(),
        get().fetchMemoryDecisions(),
        get().fetchDreamRuns(),
        get().fetchMemories(),
        get().fetchStats(),
      ]);
    } catch {
      set({ dreamLoading: false });
    }
  },

  runDreamRealRun: async () => {
    set({ dreamLoading: true, dreamResult: null });
    try {
      const res = await fetch("/api/memories/dream/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dryRun: false }),
      });
      if (!res.ok) throw new Error("梦整理真实运行失败");
      const result = (await res.json()) as DreamRunResult;
      set({ dreamResult: result, dreamLoading: false });
      await Promise.all([
        get().fetchDailySummaries(),
        get().fetchMemoryDecisions(),
        get().fetchDreamRuns(),
        get().fetchMemories(),
        get().fetchStats(),
      ]);
    } catch {
      set({ dreamLoading: false });
    }
  },

  acceptReviewItem: async (id) => {
    await fetch(`/api/memories/reviews/${id}/accept`, { method: "POST" });
    await get().fetchReviewItems();
  },

  rejectReviewItem: async (id) => {
    await fetch(`/api/memories/reviews/${id}/reject`, { method: "POST" });
    await get().fetchReviewItems();
  },

  undoMemoryDecision: async (id) => {
    await fetch(`/api/memories/decisions/${id}/undo`, { method: "POST" });
    await Promise.all([
      get().fetchMemoryDecisions(),
      get().fetchMemories(),
      get().fetchStats(),
    ]);
  },

  searchMemories: async (query: string) => {
    set({ searchQuery: query, page: 1 });
    const state = get();
    const params = new URLSearchParams({
      page: "1",
      pageSize: String(state.pageSize),
      status: "active",
    });
    if (state.filterType) params.set("type", state.filterType);
    if (query) params.set("search", query);

    set({ loading: true });
    try {
      const res = await fetch(`/api/memories?${params}`);
      if (!res.ok) throw new Error("搜索失败");
      const data = (await res.json()) as { memories: MemoryItem[]; total: number };
      set({ memories: data.memories, total: data.total, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  setFilterType: (type) => {
    set({ filterType: type, page: 1 });
    get().fetchMemories();
  },

  setPage: (page) => {
    set({ page });
    get().fetchMemories();
  },

  deleteMemory: async (id) => {
    await fetch(`/api/memories/${id}`, { method: "DELETE" });
    get().fetchMemories();
    get().fetchStats();
  },

  updateMemory: async (id, content) => {
    await fetch(`/api/memories/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content }),
    });
    get().fetchMemories();
  },

  addMemory: async (content, memoryType) => {
    await fetch("/api/memories", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content, memory_type: memoryType }),
    });
    get().fetchMemories();
    get().fetchStats();
  },
}));
