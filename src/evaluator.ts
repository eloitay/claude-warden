import type {
  ParseResult, WardenConfig, EvalResult, Decision,
  CommandEvalDetail, ParsedCommand, CommandRule,
} from './types';

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

  // 4. Command-specific rules
  const rule = config.rules.find(r => r.command === command);
  if (rule) {
    return evaluateRule(cmd, rule);
  }

  // 5. Default
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
