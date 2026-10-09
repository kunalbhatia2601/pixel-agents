/**
 * Decides, before a task starts, whether it will change code (cut a branch + worktree) or only
 * look and answer (run read-only in the user's own checkout). One cheap model call, one word back.
 */

/** Small and fast: the decision is a single word. */
export const ROUTER_MODEL = 'haiku';

const ROUTER_SYSTEM_PROMPT = `You route coding tasks. Reply with exactly one word: true or false.
true = doing the task requires changing anything in the repository: write, edit, fix, refactor, add, delete or rename files, generate code, run migrations, or make commits.
false = the task only needs looking: answer a question, explain, review, summarize, list or find things, or draft text in the reply (a commit message, PR description, plan or estimate) without changing files.
If unsure, reply true.`;

/** "false" (in any case, optionally with trailing text) means no branch; anything else, including errors, means branch. */
export function parseRouterAnswer(text: string): boolean {
  return !/^\s*false\b/i.test(text);
}

export async function needsBranch(title: string, prompt: string): Promise<boolean> {
  try {
    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    let answer = '';
    for await (const message of query({
      prompt: `Task title: ${title}\n\nTask:\n${prompt}`,
      options: {
        model: ROUTER_MODEL,
        systemPrompt: ROUTER_SYSTEM_PROMPT,
        tools: [],
        maxTurns: 1,
        settingSources: [],
        // No transcript: the office would otherwise adopt the router as an agent.
        persistSession: false,
      },
    })) {
      if (message.type === 'result' && message.subtype === 'success') answer = message.result;
    }
    return parseRouterAnswer(answer);
  } catch (err) {
    // A failed router must not strand the task; a branch is the safe default.
    console.warn('[Pixel Agents] Task router failed, cutting a branch:', err);
    return true;
  }
}
