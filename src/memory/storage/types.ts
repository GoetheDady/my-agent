export interface Memory {
  id: string;
  user_id: string;
  agent_id: string;
  memory_type: string;
  content: string;
  embedding: number[];
  source_session_id: string;
  source_text: string;
  status: string;
  confidence: number;
  created_at: number;
  updated_at: number;
  last_accessed_at: number;
  access_count: number;
  embedding_model: string;
  embedding_dim: number;
}

export interface MemorySnapshotRestore {
  id: string;
  content: string;
  memory_type: string;
  status: string;
  confidence: number;
  updated_at?: number;
}
