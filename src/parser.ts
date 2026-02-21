import { parse as shellParse } from 'shell-quote';
import { basename } from 'path';
import type { ParsedCommand, ParseResult } from './types';

const ENV_PREFIX_REGEX = /^[A-Za-z_][A-Za-z0-9_]*=/;
const SUBSHELL_REGEX = /\$\(|`/;
const HEREDOC_REGEX = /<<-?\s*['"]?\w+['"]?/;

/**
 * Split a command string on shell operators (|, &&, ||, ;)
 * while respecting single/double quotes and backslash escapes.
 */
function splitOnOperators(input: string): string[] {
  const segments: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    if (escaped) {
      current += ch;
      escaped = false;
      i++;
      continue;
    }

    if (ch === '\\' && !inSingle) {
      escaped = true;
      current += ch;
      i++;
      continue;
    }

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      current += ch;
      i++;
      continue;
    }

    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      current += ch;
      i++;
      continue;
    }

    if (!inSingle && !inDouble) {
      const two = input.slice(i, i + 2);
      if (two === '&&' || two === '||' || two === '|&') {
        segments.push(current);
        current = '';
        i += 2;
        continue;
      }
      if (ch === '|' || ch === ';') {
        segments.push(current);
        current = '';
        i++;
        continue;
      }
    }

    current += ch;
    i++;
  }

  if (current.trim()) segments.push(current);
  return segments;
}

/**
 * Parse a single command segment (no pipes/chains) into a ParsedCommand.
 */
function parseSegment(raw: string): ParsedCommand | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    const tokens = shellParse(trimmed);
    const stringTokens: string[] = [];

    for (const token of tokens) {
      if (typeof token === 'string') {
        stringTokens.push(token);
      }
      // shell-quote redirect/glob/operator objects are skipped
    }

    // Separate env prefixes from command + args
    const envPrefixes: string[] = [];
    let commandStart = 0;
    for (let i = 0; i < stringTokens.length; i++) {
      if (ENV_PREFIX_REGEX.test(stringTokens[i])) {
        envPrefixes.push(stringTokens[i]);
        commandStart = i + 1;
      } else {
        break;
      }
    }

    const remaining = stringTokens.slice(commandStart);
    if (remaining.length === 0) return null;

    // Normalize command: use basename if it's a path
    let command = remaining[0];
    if (command.includes('/')) {
      command = basename(command);
    }

    return {
      command,
      args: remaining.slice(1),
      envPrefixes,
      raw: trimmed,
    };
  } catch {
    return null;
  }
}

/**
 * Parse a full shell command string into individual commands.
 */
export function parseCommand(input: string): ParseResult {
  if (!input || !input.trim()) {
    return { commands: [], hasSubshell: false, parseError: false };
  }

  const hasSubshell = SUBSHELL_REGEX.test(input);
  const hasHeredoc = HEREDOC_REGEX.test(input);

  // Heredocs are hard to parse reliably — flag as parse error to trigger "ask"
  if (hasHeredoc) {
    // Still try to extract the base command for evaluation
    const firstLine = input.split('\n')[0];
    const segments = splitOnOperators(firstLine.split('<<')[0]);
    const commands: ParsedCommand[] = [];
    for (const seg of segments) {
      const parsed = parseSegment(seg);
      if (parsed) commands.push(parsed);
    }
    // If we got at least a base command, return it with hasSubshell flag
    // so the evaluator can decide
    if (commands.length > 0) {
      return { commands, hasSubshell: true, parseError: false };
    }
    return { commands: [], hasSubshell: true, parseError: true };
  }

  const segments = splitOnOperators(input);
  const commands: ParsedCommand[] = [];
  let parseError = false;

  for (const segment of segments) {
    const parsed = parseSegment(segment);
    if (parsed) {
      // Handle `sh -c "..."` / `bash -c "..."` — recursively parse the -c argument
      if (
        (parsed.command === 'sh' || parsed.command === 'bash' || parsed.command === 'zsh') &&
        parsed.args.length >= 2 &&
        parsed.args[0] === '-c'
      ) {
        const innerCommand = parsed.args[1];
        const innerResult = parseCommand(innerCommand);
        if (innerResult.parseError) {
          parseError = true;
        } else {
          commands.push(...innerResult.commands);
          if (innerResult.hasSubshell) {
            // Propagate subshell flag
            return { commands: [...commands, ...innerResult.commands], hasSubshell: true, parseError };
          }
        }
      } else {
        commands.push(parsed);
      }
    }
  }

  return { commands, hasSubshell, parseError };
}
