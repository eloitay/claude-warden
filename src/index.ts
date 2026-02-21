import { parseCommand } from './parser';
import { evaluate } from './evaluator';
import { loadConfig } from './rules';
import type { HookInput, HookOutput } from './types';

async function main() {
  let raw = '';
  for await (const chunk of process.stdin) {
    raw += chunk;
  }

  let input: HookInput;
  try {
    input = JSON.parse(raw);
  } catch {
    // Can't parse input — don't interfere
    process.exit(0);
  }

  if (input.tool_name !== 'Bash') {
    process.exit(0);
  }

  const command = input.tool_input?.command;
  if (!command || typeof command !== 'string') {
    process.exit(0);
  }

  const config = loadConfig(input.cwd);
  const parsed = parseCommand(command);
  const result = evaluate(parsed, config);

  if (result.decision === 'allow') {
    const output: HookOutput = {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: `[warden] ${result.reason}`,
      },
    };
    process.stdout.write(JSON.stringify(output));
    process.exit(0);
  }

  if (result.decision === 'deny') {
    process.stderr.write(`[warden] Blocked: ${result.reason}\n`);
    process.exit(2);
  }

  // decision === 'ask' — fall through to normal permission prompt
  // Return nothing, exit 0 — this means "no opinion", user gets prompted as usual
  process.exit(0);
}

main().catch(() => process.exit(0));
