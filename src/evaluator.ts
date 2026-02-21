import type {
  ParseResult, WardenConfig, EvalResult, Decision,
  CommandEvalDetail, ParsedCommand, CommandRule,
} from './types';
import { parseCommand } from './parser';

export function evaluate(parsed: ParseResult, config: WardenConfig): EvalResult {
  if (parsed.parseError) {
    return { decision: 'ask', reason: 'Could not parse command safely', details: [] };
  }

  if (parsed.commands.length === 0) {
    return { decision: 'allow', reason: 'Empty command', details: [] };
  }

  if (parsed.hasSubshell && config.askOnSubshell) {
    return { decision: 'ask', reason: 'Command contains subshell/command substitution', details: [] };
  }

  const details: CommandEvalDetail[] = [];
  for (const cmd of parsed.commands) {
    details.push(evaluateCommand(cmd, config));
  }

  // Combine: deny > ask > allow
  const decisions = details.map(d => d.decision);

  if (decisions.includes('deny')) {
    const denied = details.filter(d => d.decision === 'deny');
    return {
      decision: 'deny',
      reason: denied.map(d => `${d.command}: ${d.reason}`).join('; '),
      details,
    };
  }

  if (decisions.includes('ask')) {
    const asked = details.filter(d => d.decision === 'ask');
    return {
      decision: 'ask',
      reason: asked.map(d => `${d.command}: ${d.reason}`).join('; '),
      details,
    };
  }

  return { decision: 'allow', reason: 'All commands are safe', details };
}

function evaluateCommand(cmd: ParsedCommand, config: WardenConfig): CommandEvalDetail {
  const { command, args } = cmd;

  // 1. Global deny patterns (regex on raw command)
  for (const gp of config.globalDeny || []) {
    if (new RegExp(gp.pattern).test(cmd.raw)) {
      return { command, args, decision: 'deny', reason: gp.reason, matchedRule: 'globalDeny' };
    }
  }

  // 2. Always deny
  if (config.alwaysDeny?.includes(command)) {
    return { command, args, decision: 'deny', reason: `"${command}" is blocked`, matchedRule: 'alwaysDeny' };
  }

  // 3. Always allow
  if (config.alwaysAllow?.includes(command)) {
    return { command, args, decision: 'allow', reason: `"${command}" is safe`, matchedRule: 'alwaysAllow' };
  }

  // 4. SSH host whitelisting with recursive remote command evaluation
  if ((command === 'ssh' || command === 'scp' || command === 'rsync') && config.trustedSSHHosts?.length) {
    const sshResult = evaluateSSHCommand(cmd, config);
    if (sshResult) return sshResult;
  }

  // 5. Command-specific rules
  const rule = config.rules.find(r => r.command === command);
  if (rule) {
    return evaluateRule(cmd, rule);
  }

  // 6. Default
  return { command, args, decision: config.defaultDecision, reason: `No rule for "${command}"`, matchedRule: 'default' };
}

function evaluateRule(cmd: ParsedCommand, rule: CommandRule): CommandEvalDetail {
  const { command, args } = cmd;
  const argsJoined = args.join(' ');

  for (const pattern of rule.argPatterns || []) {
    const m = pattern.match;
    let matched = true;

    if (m.noArgs !== undefined) {
      matched = matched && (m.noArgs === (args.length === 0));
    }

    if (m.argsMatch && matched) {
      matched = m.argsMatch.some(re => new RegExp(re).test(argsJoined));
    }

    if (m.anyArgMatches && matched) {
      matched = args.some(arg => m.anyArgMatches!.some(re => new RegExp(re).test(arg)));
    }

    if (m.argCount && matched) {
      if (m.argCount.min !== undefined) matched = matched && args.length >= m.argCount.min;
      if (m.argCount.max !== undefined) matched = matched && args.length <= m.argCount.max;
    }

    if (m.not) matched = !matched;

    if (matched) {
      return {
        command, args,
        decision: pattern.decision,
        reason: pattern.reason || pattern.description || `Matched pattern for "${command}"`,
        matchedRule: `${command}:argPattern`,
      };
    }
  }

  // No pattern matched → use rule default
  return {
    command, args,
    decision: rule.default,
    reason: `Default for "${command}"`,
    matchedRule: `${command}:default`,
  };
}

/** SSH flags that consume the next argument (skip it when extracting host). */
const SSH_FLAGS_WITH_VALUE = new Set([
  '-b', '-c', '-D', '-E', '-e', '-F', '-I', '-i', '-J', '-L',
  '-l', '-m', '-O', '-o', '-p', '-Q', '-R', '-S', '-W', '-w',
]);

/** Convert a glob pattern (with `*` wildcards) to a RegExp. */
function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

function matchesHost(host: string, patterns: string[]): boolean {
  return patterns.some(p => globToRegex(p).test(host));
}

interface SSHParseResult {
  host: string | null;
  remoteCommand: string | null;
}

function parseSSHArgs(args: string[]): SSHParseResult {
  let host: string | null = null;
  const remoteArgs: string[] = [];
  let i = 0;

  while (i < args.length) {
    const arg = args[i];
    if (SSH_FLAGS_WITH_VALUE.has(arg)) {
      i += 2; // skip flag and its value
      continue;
    }
    if (arg.startsWith('-')) {
      i++; // boolean flag
      continue;
    }
    // First positional arg is host
    if (!host) {
      host = arg.includes('@') ? arg.split('@').pop()! : arg;
      i++;
      // Remaining positional args are the remote command
      while (i < args.length) {
        remoteArgs.push(args[i]);
        i++;
      }
      break;
    }
    i++;
  }

  return {
    host,
    remoteCommand: remoteArgs.length > 0 ? remoteArgs.join(' ') : null,
  };
}

/** Extract host from scp/rsync args like `[user@]host:path`. */
function extractHostFromRemotePath(args: string[]): string | null {
  for (const arg of args) {
    const match = arg.match(/^(?:[^@]+@)?([^:]+):/);
    if (match) return match[1];
  }
  return null;
}

function evaluateSSHCommand(cmd: ParsedCommand, config: WardenConfig): CommandEvalDetail | null {
  const { command, args } = cmd;
  const trustedHosts = config.trustedSSHHosts || [];

  if (command === 'scp' || command === 'rsync') {
    const host = extractHostFromRemotePath(args);
    if (host && matchesHost(host, trustedHosts)) {
      return {
        command, args,
        decision: 'allow',
        reason: `Trusted SSH host "${host}"`,
        matchedRule: 'trustedSSHHosts',
      };
    }
    return null; // fall through to normal rules
  }

  // ssh
  const { host, remoteCommand } = parseSSHArgs(args);
  if (!host || !matchesHost(host, trustedHosts)) return null;

  // Trusted host, no remote command
  if (!remoteCommand) {
    return {
      command, args,
      decision: 'allow',
      reason: `Trusted SSH host "${host}" (interactive)`,
      matchedRule: 'trustedSSHHosts',
    };
  }

  // Trusted host with remote command — recursively evaluate
  const parsed = parseCommand(remoteCommand);
  const result = evaluate(parsed, config);
  return {
    command, args,
    decision: result.decision,
    reason: `Trusted SSH host "${host}": ${result.reason}`,
    matchedRule: 'trustedSSHHosts',
  };
}
