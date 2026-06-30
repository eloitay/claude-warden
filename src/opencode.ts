import { wardenEval } from './core';
import type { Decision } from './types';

interface OpenCodePluginContext {
  directory: string;
  project: { id: string; worktree: string };
  [key: string]: unknown;
}

interface ToolExecuteBeforeInput {
  tool: string;
  sessionID: string;
  callID: string;
}

interface ToolExecuteBeforeOutput {
  args: { command?: string; [key: string]: unknown };
}

type Plugin = (ctx: OpenCodePluginContext) => Promise<{
  'tool.execute.before'?: (
    input: ToolExecuteBeforeInput,
    output: ToolExecuteBeforeOutput,
  ) => Promise<void>;
}>;

const TOOL_NAME_MAP: Record<string, string> = {
  bash: 'Bash',
  shell: 'Bash',
};

export const WardenPlugin: Plugin = async (ctx) => {
  return {
    'tool.execute.before': async (input, output) => {
      const mappedTool = TOOL_NAME_MAP[input.tool];
      if (!mappedTool) return;

      const command = output.args.command;
      if (!command || typeof command !== 'string') return;

      const result = wardenEval(command, { cwd: ctx.directory });

      if (result.decision === 'deny') {
        throw new Error(`[warden] Blocked: ${result.reason}`);
      }
    },
  };
};

export default WardenPlugin;
