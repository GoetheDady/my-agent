import type { Database } from "bun:sqlite";
import { updateAssistantToolPart } from "../../channels/session-api";
import { appendEvent } from "../../events/event-log";
import type { MemoryExtractionJob } from "./types";

export function completeExtractTool(input: {
  job: MemoryExtractionJob;
  database: Database;
  toolCallId: string;
  addedMemoryIds: string[];
  summary: string;
}): void {
  updateAssistantToolPart(
    input.job.assistantMessageId,
    input.toolCallId,
    {
      state: "output-available",
      output: {
        addedCount: input.addedMemoryIds.length,
        memoryIds: input.addedMemoryIds,
        summary: input.summary,
      },
    },
    input.database,
  );
  appendEvent({
    agent_id: input.job.agentId,
    task_id: input.job.taskId,
    conversation_id: input.job.conversationId,
    type: "memory.extract.completed",
    payload: {
      count: input.addedMemoryIds.length,
      memoryIds: input.addedMemoryIds,
      assistantMessageId: input.job.assistantMessageId,
      summary: input.summary,
    },
  }, input.database);
}

export function completeReconsolidateTool(input: {
  job: MemoryExtractionJob;
  database: Database;
  toolCallId: string;
  updatedMemoryIds: string[];
  retrievedMemoryIds: string[];
  evidenceEventIds: string[];
  summary: string;
}): void {
  updateAssistantToolPart(
    input.job.assistantMessageId,
    input.toolCallId,
    {
      state: "output-available",
      output: {
        updatedCount: input.updatedMemoryIds.length,
        memoryIds: input.updatedMemoryIds,
        retrievedMemoryIds: input.retrievedMemoryIds,
        evidenceEventIds: input.evidenceEventIds,
        summary: input.summary,
      },
    },
    input.database,
  );
  appendEvent({
    agent_id: input.job.agentId,
    task_id: input.job.taskId,
    conversation_id: input.job.conversationId,
    type: "memory.reconsolidate.completed",
    payload: {
      updatedCount: input.updatedMemoryIds.length,
      memoryIds: input.updatedMemoryIds,
      retrievedMemoryIds: input.retrievedMemoryIds,
      evidenceEventIds: input.evidenceEventIds,
      summary: input.summary,
    },
  }, input.database);
}

export function failMemoryToolParts(input: {
  job: MemoryExtractionJob;
  database: Database;
  extractToolCallId: string;
  reconsolidateToolCallId?: string;
  retrievedMemoryIds: string[];
  error: unknown;
}): void {
  const message = input.error instanceof Error ? input.error.message : String(input.error);
  updateAssistantToolPart(
    input.job.assistantMessageId,
    input.extractToolCallId,
    { state: "output-error", errorText: message },
    input.database,
  );
  appendEvent({
    agent_id: input.job.agentId,
    task_id: input.job.taskId,
    conversation_id: input.job.conversationId,
    type: "memory.extract.failed",
    payload: { error: message, assistantMessageId: input.job.assistantMessageId },
  }, input.database);

  if (!input.reconsolidateToolCallId) return;
  updateAssistantToolPart(
    input.job.assistantMessageId,
    input.reconsolidateToolCallId,
    { state: "output-error", errorText: message },
    input.database,
  );
  appendEvent({
    agent_id: input.job.agentId,
    task_id: input.job.taskId,
    conversation_id: input.job.conversationId,
    type: "memory.reconsolidate.failed",
    payload: { error: message, memoryIds: input.retrievedMemoryIds },
  }, input.database);
}
