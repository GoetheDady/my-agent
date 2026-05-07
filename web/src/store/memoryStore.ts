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

interface MemoryState {
  memories: MemoryItem[];
  stats: MemoryStats | null;
  loading: boolean;
  page: number;
  pageSize: number;
  total: number;
  filterType: string | null;
  searchQuery: string;

  fetchMemories: () => Promise<void>;
  fetchStats: () => Promise<void>;
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
  loading: false,
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
