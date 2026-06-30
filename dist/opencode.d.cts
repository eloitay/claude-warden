interface OpenCodePluginContext {
    directory: string;
    project: {
        id: string;
        worktree: string;
    };
    [key: string]: unknown;
}
interface ToolExecuteBeforeInput {
    tool: string;
    sessionID: string;
    callID: string;
}
interface ToolExecuteBeforeOutput {
    args: {
        command?: string;
        [key: string]: unknown;
    };
}
type Plugin = (ctx: OpenCodePluginContext) => Promise<{
    'tool.execute.before'?: (input: ToolExecuteBeforeInput, output: ToolExecuteBeforeOutput) => Promise<void>;
}>;
declare const WardenPlugin: Plugin;

export { WardenPlugin, WardenPlugin as default };
