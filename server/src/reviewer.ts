import type {
  Project,
  ReviewComment,
  ReviewRecord,
  ReviewSeverity,
  Task,
} from '../../core/src/messages.js';

/** Automatic QA rounds per task before the owner is pulled in, unless the project says otherwise. */
export const DEFAULT_MAX_REVIEW_ROUNDS = 3;

const SEVERITIES: ReviewSeverity[] = ['blocker', 'major', 'minor', 'nit'];
/** Comments at these severities send the work back to the dev. */
const BLOCKING: ReadonlySet<ReviewSeverity> = new Set(['blocker', 'major']);

/** JSON schema the reviewer's final answer must match (SDK structured output). */
export const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['approved', 'summary', 'comments', 'testsRun'],
  properties: {
    approved: {
      type: 'boolean',
      description: 'true only when there are no blocker or major comments',
    },
    summary: { type: 'string', description: 'What was reviewed and the overall assessment' },
    testsRun: {
      type: 'array',
      items: { type: 'string' },
      description: 'Each test/command run and its outcome, including the edge-case tests you wrote',
    },
    comments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'title', 'detail'],
        properties: {
          severity: { type: 'string', enum: SEVERITIES },
          title: { type: 'string' },
          detail: {
            type: 'string',
            description: 'What is wrong and the concrete failure scenario',
          },
          file: {
            type: 'string',
            description: 'Repo-relative path (prefix the repo folder in workspaces)',
          },
          line: { type: 'number' },
          suggestion: { type: 'string', description: 'How to fix it' },
        },
      },
    },
  },
} as const;

export interface Verdict {
  approved: boolean;
  summary: string;
  comments: ReviewComment[];
  testsRun: string[];
}

/** Untrusted model output → a verdict; approval is re-derived so a blocker can never slip through. */
export function parseVerdict(raw: unknown): Verdict {
  if (!raw || typeof raw !== 'object') throw new Error('The reviewer returned no verdict');
  const v = raw as Record<string, unknown>;
  const comments: ReviewComment[] = (Array.isArray(v.comments) ? v.comments : [])
    .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
    .map((c) => ({
      severity: SEVERITIES.includes(c.severity as ReviewSeverity)
        ? (c.severity as ReviewSeverity)
        : 'major',
      title: String(c.title ?? 'Untitled'),
      detail: String(c.detail ?? ''),
      file: typeof c.file === 'string' ? c.file : undefined,
      line: typeof c.line === 'number' ? c.line : undefined,
      suggestion: typeof c.suggestion === 'string' ? c.suggestion : undefined,
    }));
  return {
    approved: v.approved === true && !comments.some((c) => BLOCKING.has(c.severity)),
    summary: String(v.summary ?? ''),
    comments,
    testsRun: Array.isArray(v.testsRun) ? v.testsRun.map(String) : [],
  };
}

function formatComment(c: ReviewComment, i: number): string {
  const where = c.file ? ` (${c.file}${c.line ? `:${c.line}` : ''})` : '';
  const fix = c.suggestion ? `\n   Suggested fix: ${c.suggestion}` : '';
  return `${i + 1}. [${c.severity.toUpperCase()}] ${c.title}${where}\n   ${c.detail}${fix}`;
}

/** The QA verdict as the dev's next message. */
export function feedbackMessage(record: ReviewRecord, maxRounds: number): string {
  const comments = record.comments ?? [];
  return [
    `QA review round ${record.round} of ${maxRounds}: changes requested.`,
    '',
    record.summary ?? '',
    '',
    'Comments:',
    ...comments.map(formatComment),
    '',
    'Fix every BLOCKER and MAJOR. For MINOR and NIT, fix them or say briefly why not.',
    'Add or update tests that cover the fixes, run the test command, and commit your changes on this branch.',
    'Then reply with what you changed for each comment. Your work goes back to QA after that.',
  ].join('\n');
}

/** Appended to the reviewer's system prompt: who it is, what it reviews, and how deeply. */
export function reviewerBrief(
  task: Task,
  project: Project,
  ctx: {
    reviewDir: string;
    repoDirs: Array<{ name: string; dir: string; base: string; testCommand?: string }>;
    devSummary?: string;
    docsDir: string;
    memoryDir: string;
    round: number;
  },
): string {
  const previous = (task.reviews ?? []).filter((r) => !r.error);
  const lines = [
    `# You are the QA reviewer for the project "${project.name}"`,
    "Review a developer agent's work like a senior engineer reviewing a pull request (in the style of CodeAnt): thorough, specific, evidence-based.",
    '',
    `## The task: ${task.title}`,
    task.prompt ?? '(original instructions unavailable)',
    '',
    ctx.devSummary ? `## The developer's own summary\n${ctx.devSummary}\n` : '',
    '## Where the work is',
    `You have your own copy of the task branch \`${task.branch}\` at ${ctx.reviewDir} (detached; changes here are thrown away after your review).`,
    ...ctx.repoDirs.map(
      (r) =>
        `- ${r.dir}: review \`git diff ${r.base.slice(0, 12)}..HEAD\` (everything the task changed)${r.testCommand ? `; test command: \`${r.testCommand}\`` : ''}`,
    ),
    `Project docs: ${ctx.docsDir}. Notes from past tasks: ${ctx.memoryDir}. Read what is relevant before judging.`,
    'Read files with the Read, Glob and Grep tools (they need no approval); use the shell to run code and tests.',
    '',
    '## How to review',
    '1. Understand the task completely, then read the full diff and the code around every change (callers, callees, related modules). Do not review the diff in isolation.',
    '2. Check that the change does exactly what the task asked: nothing missing, nothing unrelated.',
    '3. Think through what-if scenarios: empty, null and boundary inputs, errors and failures, concurrency, large data, and the existing behaviour that must keep working.',
    '4. Run the existing tests. Then write focused extra tests for the risky cases you found, in your copy, and run them. Report each with its outcome.',
    "5. Check error handling, security (injection, auth, secrets, unsafe input), performance, and consistency with this codebase's conventions.",
    '',
    '## Severity',
    '- blocker: wrong behaviour, data loss, security hole, crash, or the task is not done.',
    '- major: a real bug in a realistic case, a missing test for risky logic, or a clear regression risk.',
    '- minor: worth fixing, but safe to ship.',
    '- nit: style or naming.',
    'Approve only when there are no blocker or major comments. Every comment needs a concrete scenario and, where possible, a file, line and suggested fix. Do not invent problems you did not verify.',
  ];
  if (previous.length) {
    lines.push(
      '',
      `## Earlier review rounds (this is round ${ctx.round})`,
      'Verify each earlier comment was actually fixed, then review any new changes.',
      ...previous.map(
        (r) =>
          `Round ${r.round} (${r.approved ? 'approved' : 'changes requested'}): ${r.summary ?? ''}\n${(r.comments ?? []).map(formatComment).join('\n')}`,
      ),
    );
  }
  lines.push(
    '',
    "Do not modify the developer's worktree, commit, push or switch branches. Finish with the verdict.",
  );
  return lines.filter((l) => l !== '').join('\n');
}
