import { describe, it, expect } from 'vitest';
import { WardenPlugin } from '../opencode';

const mockCtx = {
  directory: process.cwd(),
  project: { id: 'test', worktree: process.cwd() },
};

async function callPlugin(tool: string, command: string) {
  const plugin = await WardenPlugin(mockCtx);
  const hook = plugin['tool.execute.before']!;
  const input = { tool, sessionID: 'test-session', callID: 'test-call' };
  const output = { args: { command } };
  try {
    await hook(input, output);
    return { blocked: false };
  } catch (err: any) {
    return { blocked: true, message: err.message };
  }
}

describe('OpenCode plugin adapter', () => {
  it('allows safe bash commands', async () => {
    const result = await callPlugin('bash', 'ls -la');
    expect(result.blocked).toBe(false);
  });

  it('blocks dangerous commands', async () => {
    const result = await callPlugin('bash', 'shutdown -h now');
    expect(result.blocked).toBe(true);
    expect(result.message).toContain('[warden]');
  });

  it('allows pipelines of safe commands', async () => {
    const result = await callPlugin('bash', 'cat file | grep pattern | wc -l');
    expect(result.blocked).toBe(false);
  });

  it('ignores non-bash tools', async () => {
    const result = await callPlugin('edit', '/some/file.ts');
    expect(result.blocked).toBe(false);
  });

  it('ignores non-bash tools like read', async () => {
    const result = await callPlugin('read', '/some/file.ts');
    expect(result.blocked).toBe(false);
  });

  it('maps "shell" tool name to bash evaluation', async () => {
    const result = await callPlugin('shell', 'shutdown -h now');
    expect(result.blocked).toBe(true);
  });

  it('handles missing command gracefully', async () => {
    const plugin = await WardenPlugin(mockCtx);
    const hook = plugin['tool.execute.before']!;
    const result = { blocked: false };
    try {
      await hook(
        { tool: 'bash', sessionID: 's', callID: 'c' },
        { args: {} },
      );
    } catch {
      result.blocked = true;
    }
    expect(result.blocked).toBe(false);
  });

  it('exports default and named export', async () => {
    const mod = await import('../opencode');
    expect(mod.WardenPlugin).toBeDefined();
    expect(mod.default).toBe(mod.WardenPlugin);
  });
});
