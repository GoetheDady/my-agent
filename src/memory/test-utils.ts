import type { Memory } from "./store";

/**
 * 创建测试用 Memory 对象。
 *
 * 测试里大量使用内存 mock store，不应依赖真实 LanceDB 或 embedding 服务；
 * 这个 helper 保持各测试构造的 Memory 形状一致。
 *
 * @param overrides 需要覆盖的字段。
 * @returns 完整 Memory 对象。
 */
export function createTestMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: "memory-1",
    user_id: "default",
    agent_id: "default",
    memory_type: "fact",
    content: "用户正在开发 my-agent 项目",
    embedding: [],
    source_session_id: "",
    source_text: "",
    status: "active",
    confidence: 0.9,
    created_at: 1,
    updated_at: 1,
    last_accessed_at: 1,
    access_count: 0,
    embedding_model: "test",
    embedding_dim: 0,
    ...overrides,
  };
}
