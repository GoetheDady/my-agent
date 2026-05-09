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

export interface DreamRunResult {
  dryRun: boolean;
  date: string;
  summary: DailySummaryItem;
  dedupe: {
    scannedCount: number;
    duplicateGroups: unknown[];
    inactiveMemoryIds: string[];
  };
  pendingReviewCount: number;
}

interface MemoryState {
  memories: MemoryItem[];
  stats: MemoryStats | null;
  episodes: EpisodeItem[];
  dailySummaries: DailySummaryItem[];
  reviewItems: MemoryReviewItem[];
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
  fetchMemoryWorkspace: () => Promise<void>;
  runDreamDryRun: () => Promise<void>;
  acceptReviewItem: (id: string) => Promise<void>;
  rejectReviewItem: (id: string) => Promise<void>;
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

  fetchMemoryWorkspace: async () => {
    await Promise.all([
      get().fetchMemories(),
      get().fetchStats(),
      get().fetchEpisodes(),
      get().fetchDailySummaries(),
      get().fetchReviewItems(),
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
      await Promise.all([get().fetchDailySummaries(), get().fetchReviewItems()]);
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
