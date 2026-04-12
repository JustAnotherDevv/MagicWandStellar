import type { Session, ToolResult } from '../types/index.js';
import type { DatabaseStore } from '../db/index.js';

export async function updateProjectSpec(
  input: { spec: string },
  session: Session,
  db: DatabaseStore,
): Promise<ToolResult> {
  try {
    db.updateProjectSpec(session.projectId, input.spec);
    session.projectSpec = input.spec;
    return { content: 'Project specification updated successfully.', isError: false };
  } catch (err) {
    return {
      content: `Failed to update project spec: ${err instanceof Error ? err.message : String(err)}`,
      isError: true,
    };
  }
}
