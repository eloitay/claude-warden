"use strict";

// src/parser.ts
var import_shell_quote = require("shell-quote");
var import_path = require("path");
var ENV_PREFIX_REGEX = /^[A-Za-z_][A-Za-z0-9_]*=/;
var SUBSHELL_REGEX = /\$\(|`/;
var HEREDOC_REGEX = /<<-?\s*['"]?\w+['"]?/;
function splitOnOperators(input) {
  const segments = [];
  let current = "";
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
    if (ch === "\\" && !inSingle) {
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
      if (two === "&&" || two === "||" || two === "|&") {
        segments.push(current);
        current = "";
        i += 2;
        continue;
      }
      if (ch === "|" || ch === ";") {
        segments.push(current);
        current = "";
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
function parseSegment(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const tokens = (0, import_shell_quote.parse)(trimmed);
    const stringTokens = [];
    for (const token of tokens) {
      if (typeof token === "string") {
        stringTokens.push(token);
      }
    }
    const envPrefixes = [];
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
    let command = remaining[0];
    if (command.includes("/")) {
      command = (0, import_path.basename)(command);
    }
    return {
      command,
      args: remaining.slice(1),
      envPrefixes,
      raw: trimmed
    };
  } catch {
    return null;
  }
}
function parseCommand(input) {
  if (!input || !input.trim()) {
    return { commands: [], hasSubshell: false, parseError: false };
  }
  const hasSubshell = SUBSHELL_REGEX.test(input);
  const hasHeredoc = HEREDOC_REGEX.test(input);
  if (hasHeredoc) {
    const firstLine = input.split("\n")[0];
    const segments2 = splitOnOperators(firstLine.split("<<")[0]);
    const commands2 = [];
    for (const seg of segments2) {
      const parsed = parseSegment(seg);
      if (parsed) commands2.push(parsed);
    }
    if (commands2.length > 0) {
      return { commands: commands2, hasSubshell: true, parseError: false };
    }
    return { commands: [], hasSubshell: true, parseError: true };
  }
  const segments = splitOnOperators(input);
  const commands = [];
  let parseError = false;
  for (const segment of segments) {
    const parsed = parseSegment(segment);
    if (parsed) {
      if ((parsed.command === "sh" || parsed.command === "bash" || parsed.command === "zsh") && parsed.args.length >= 2 && parsed.args[0] === "-c") {
        const innerCommand = parsed.args[1];
        const innerResult = parseCommand(innerCommand);
        if (innerResult.parseError) {
          parseError = true;
        } else {
          commands.push(...innerResult.commands);
          if (innerResult.hasSubshell) {
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

// src/evaluator.ts
function evaluate(parsed, config) {
  if (parsed.parseError) {
    return { decision: "ask", reason: "Could not parse command safely", details: [] };
  }
  if (parsed.commands.length === 0) {
    return { decision: "allow", reason: "Empty command", details: [] };
  }
  if (parsed.hasSubshell && config.askOnSubshell) {
    return { decision: "ask", reason: "Command contains subshell/command substitution", details: [] };
  }
  const details = [];
  for (const cmd of parsed.commands) {
    details.push(evaluateCommand(cmd, config));
  }
  const decisions = details.map((d) => d.decision);
  if (decisions.includes("deny")) {
    const denied = details.filter((d) => d.decision === "deny");
    return {
      decision: "deny",
      reason: denied.map((d) => `${d.command}: ${d.reason}`).join("; "),
      details
    };
  }
  if (decisions.includes("ask")) {
    const asked = details.filter((d) => d.decision === "ask");
    return {
      decision: "ask",
      reason: asked.map((d) => `${d.command}: ${d.reason}`).join("; "),
      details
    };
  }
  return { decision: "allow", reason: "All commands are safe", details };
}
function evaluateCommand(cmd, config) {
  const { command, args } = cmd;
  for (const gp of config.globalDeny || []) {
    if (new RegExp(gp.pattern).test(cmd.raw)) {
      return { command, args, decision: "deny", reason: gp.reason, matchedRule: "globalDeny" };
    }
  }
  if (config.alwaysDeny?.includes(command)) {
    return { command, args, decision: "deny", reason: `"${command}" is blocked`, matchedRule: "alwaysDeny" };
  }
  if (config.alwaysAllow?.includes(command)) {
    return { command, args, decision: "allow", reason: `"${command}" is safe`, matchedRule: "alwaysAllow" };
  }
  const rule = config.rules.find((r) => r.command === command);
  if (rule) {
    return evaluateRule(cmd, rule);
  }
  return { command, args, decision: config.defaultDecision, reason: `No rule for "${command}"`, matchedRule: "default" };
}
function evaluateRule(cmd, rule) {
  const { command, args } = cmd;
  const argsJoined = args.join(" ");
  for (const pattern of rule.argPatterns || []) {
    const m = pattern.match;
    let matched = true;
    if (m.noArgs !== void 0) {
      matched = matched && m.noArgs === (args.length === 0);
    }
    if (m.argsMatch && matched) {
      matched = m.argsMatch.some((re) => new RegExp(re).test(argsJoined));
    }
    if (m.anyArgMatches && matched) {
      matched = args.some((arg) => m.anyArgMatches.some((re) => new RegExp(re).test(arg)));
    }
    if (m.argCount && matched) {
      if (m.argCount.min !== void 0) matched = matched && args.length >= m.argCount.min;
      if (m.argCount.max !== void 0) matched = matched && args.length <= m.argCount.max;
    }
    if (m.not) matched = !matched;
    if (matched) {
      return {
        command,
        args,
        decision: pattern.decision,
        reason: pattern.reason || pattern.description || `Matched pattern for "${command}"`,
        matchedRule: `${command}:argPattern`
      };
    }
  }
  return {
    command,
    args,
    decision: rule.default,
    reason: `Default for "${command}"`,
    matchedRule: `${command}:default`
  };
}

// src/rules.ts
var import_fs = require("fs");
var import_yaml = require("yaml");
var import_os = require("os");
var import_path2 = require("path");

// src/defaults.ts
var DEFAULT_CONFIG = {
  defaultDecision: "ask",
  askOnSubshell: true,
  alwaysAllow: [
    // Read-only file operations
    "cat",
    "head",
    "tail",
    "less",
    "more",
    "wc",
    "sort",
    "uniq",
    "tee",
    "diff",
    "comm",
    "cut",
    "paste",
    "tr",
    "fold",
    "expand",
    "unexpand",
    "column",
    "rev",
    "tac",
    "nl",
    "od",
    "xxd",
    "file",
    "stat",
    // Search/find
    "grep",
    "egrep",
    "fgrep",
    "rg",
    "ag",
    "ack",
    "find",
    "fd",
    "fzf",
    "locate",
    "which",
    "whereis",
    "type",
    "command",
    // Directory listing
    "ls",
    "dir",
    "tree",
    "exa",
    "eza",
    "lsd",
    // Path/string utilities
    "basename",
    "dirname",
    "realpath",
    "readlink",
    "echo",
    "printf",
    "true",
    "false",
    "test",
    "[",
    // Date/time
    "date",
    "cal",
    // Environment info
    "env",
    "printenv",
    "uname",
    "hostname",
    "whoami",
    "id",
    "pwd",
    // Process viewing (read-only)
    "ps",
    "top",
    "htop",
    "uptime",
    "free",
    "df",
    "du",
    "lsof",
    // Text processing
    "sed",
    "awk",
    "jq",
    "yq",
    "xargs",
    "seq",
    // Pagers and formatters
    "bat",
    "pygmentize",
    "highlight",
    // Version managers (read-only)
    "nvm",
    "fnm",
    "nvm",
    "rbenv",
    "pyenv",
    // Misc safe
    "cd",
    "pushd",
    "popd",
    "dirs",
    "hash",
    "alias",
    "sleep",
    "wait",
    "time",
    "md5",
    "md5sum",
    "sha256sum",
    "shasum",
    "cksum",
    "base64",
    "openssl"
  ],
  alwaysDeny: [
    "sudo",
    "su",
    "doas",
    "mkfs",
    "fdisk",
    "dd",
    "shutdown",
    "reboot",
    "halt",
    "poweroff",
    "iptables",
    "ip6tables",
    "nft",
    "useradd",
    "userdel",
    "usermod",
    "groupadd",
    "groupdel",
    "crontab",
    "systemctl",
    "service",
    "launchctl"
  ],
  globalDeny: [
    { pattern: "rm\\s+-[^\\s]*r[^\\s]*f|rm\\s+-[^\\s]*f[^\\s]*r", reason: "Recursive force delete" },
    { pattern: ">\\/dev\\/sd|>\\/dev\\/nvme|>\\/dev\\/hd", reason: "Direct write to block device" },
    { pattern: "chmod\\s+-R\\s+777", reason: "Recursively setting world-writable permissions" },
    { pattern: ":\\(\\)\\s*\\{", reason: "Fork bomb pattern detected" }
  ],
  rules: [
    // --- Node.js ecosystem ---
    {
      command: "node",
      default: "ask",
      argPatterns: [
        { match: { anyArgMatches: ["^--(version|help)$", "^-[vhep]$"] }, decision: "allow", description: "Version/help flags" },
        { match: { anyArgMatches: ["^-e$", "^--eval"] }, decision: "ask", reason: "Evaluating inline code" },
        { match: { noArgs: true }, decision: "ask", reason: "Interactive REPL" }
      ]
    },
    {
      command: "npx",
      default: "ask",
      argPatterns: [
        {
          match: { anyArgMatches: ["^(jest|vitest|tsx|ts-node|tsc|eslint|prettier|rimraf|mkdirp|concurrently|turbo|next|nuxt|vite|astro|playwright|cypress|mocha|nyc|c8|nodemon|ts-jest|tsup|esbuild|rollup|webpack|prisma|drizzle-kit|typeorm|knex|sequelize-cli|tailwindcss|postcss|autoprefixer|lint-staged|husky|changeset|semantic-release|lerna|nx|create-react-app|create-next-app|create-vite|degit|storybook|wrangler|netlify|vercel)$"] },
          decision: "allow",
          description: "Well-known dev tools"
        },
        { match: { anyArgMatches: ["^--(version|help)$", "^-[vh]$"] }, decision: "allow", description: "Version/help flags" }
      ]
    },
    {
      command: "bunx",
      default: "ask",
      argPatterns: [
        {
          match: { anyArgMatches: ["^(jest|vitest|tsx|tsc|eslint|prettier|turbo|next|vite|astro|playwright|prisma|drizzle-kit|tsup|esbuild|tailwindcss|storybook|wrangler)$"] },
          decision: "allow",
          description: "Well-known dev tools"
        }
      ]
    },
    {
      command: "npm",
      default: "allow",
      argPatterns: [
        { match: { anyArgMatches: ["^(publish|unpublish|deprecate|owner|access|token|adduser|login)$"] }, decision: "ask", reason: "Registry modification" }
      ]
    },
    { command: "pnpm", default: "allow", argPatterns: [{ match: { anyArgMatches: ["^publish$"] }, decision: "ask", reason: "Publishing" }] },
    { command: "yarn", default: "allow", argPatterns: [{ match: { anyArgMatches: ["^publish$"] }, decision: "ask", reason: "Publishing" }] },
    {
      command: "bun",
      default: "ask",
      argPatterns: [
        { match: { anyArgMatches: ["^(install|add|remove|run|test|build|init|create|pm|x|upgrade|link|unlink)$"] }, decision: "allow", description: "Standard bun commands" },
        { match: { anyArgMatches: ["^--(version|help)$"] }, decision: "allow" }
      ]
    },
    // --- Python ---
    {
      command: "python",
      default: "ask",
      argPatterns: [
        { match: { anyArgMatches: ["^--(version|help)$", "^-V$"] }, decision: "allow" }
      ]
    },
    {
      command: "python3",
      default: "ask",
      argPatterns: [
        { match: { anyArgMatches: ["^--(version|help)$", "^-V$"] }, decision: "allow" }
      ]
    },
    { command: "pip", default: "allow" },
    { command: "pip3", default: "allow" },
    { command: "uv", default: "allow" },
    { command: "pipx", default: "ask" },
    // --- Git ---
    {
      command: "git",
      default: "allow",
      argPatterns: [
        { match: { argsMatch: ["push\\s+--force", "push\\s+-f\\b"] }, decision: "ask", reason: "Force push can overwrite remote history" },
        { match: { argsMatch: ["reset\\s+--hard"] }, decision: "ask", reason: "Hard reset discards changes" },
        { match: { anyArgMatches: ["^clean$"] }, decision: "ask", reason: "git clean removes untracked files" }
      ]
    },
    { command: "gh", default: "allow" },
    // --- Build tools ---
    { command: "make", default: "allow" },
    { command: "cmake", default: "allow" },
    { command: "cargo", default: "allow" },
    { command: "go", default: "allow" },
    { command: "rustup", default: "allow" },
    { command: "tsc", default: "allow" },
    { command: "turbo", default: "allow" },
    { command: "nx", default: "allow" },
    { command: "lerna", default: "allow" },
    // --- Docker ---
    {
      command: "docker",
      default: "ask",
      argPatterns: [
        { match: { anyArgMatches: ["^(ps|images|logs|inspect|stats|top|version|info)$"] }, decision: "allow", description: "Read-only docker commands" },
        { match: { anyArgMatches: ["^(build|run|compose|exec|pull|stop|start|restart|create)$"] }, decision: "ask", reason: "Docker state-changing operation" },
        { match: { anyArgMatches: ["^(system\\s+prune|container\\s+prune|image\\s+prune)$"] }, decision: "ask", reason: "Docker prune operations" }
      ]
    },
    { command: "docker-compose", default: "ask" },
    { command: "kubectl", default: "ask" },
    // --- File operations ---
    {
      command: "rm",
      default: "ask",
      argPatterns: [
        { match: { argsMatch: ["-[^\\s]*r"] }, decision: "ask", reason: "Recursive delete" },
        { match: { argCount: { max: 3 }, not: false }, decision: "allow", description: "Deleting a small number of non-recursive files" }
      ]
    },
    { command: "mkdir", default: "allow" },
    { command: "touch", default: "allow" },
    { command: "cp", default: "allow" },
    { command: "mv", default: "allow" },
    { command: "ln", default: "allow" },
    { command: "chmod", default: "ask" },
    { command: "chown", default: "ask" },
    // --- Network ---
    { command: "curl", default: "allow" },
    { command: "wget", default: "allow" },
    { command: "ssh", default: "ask" },
    { command: "scp", default: "ask" },
    { command: "rsync", default: "ask" },
    // --- Package managers ---
    { command: "brew", default: "allow" },
    { command: "apt", default: "ask" },
    { command: "apt-get", default: "ask" },
    { command: "yum", default: "ask" },
    { command: "dnf", default: "ask" },
    { command: "pacman", default: "ask" },
    // --- Terraform / IaC ---
    { command: "terraform", default: "ask", argPatterns: [
      { match: { anyArgMatches: ["^(plan|validate|fmt|show|state|output|providers|version|graph|console)$"] }, decision: "allow", description: "Read-only terraform commands" }
    ] }
  ]
};

// src/rules.ts
var USER_CONFIG_PATHS = [
  (0, import_path2.join)((0, import_os.homedir)(), ".claude", "warden.yaml"),
  (0, import_path2.join)((0, import_os.homedir)(), ".claude", "warden.json")
];
var PROJECT_CONFIG_NAMES = [
  ".claude/warden.yaml",
  ".claude/warden.json"
];
function loadConfig(cwd) {
  const config = structuredClone(DEFAULT_CONFIG);
  for (const configPath of USER_CONFIG_PATHS) {
    if (tryMergeConfigFile(config, configPath)) break;
  }
  if (cwd) {
    for (const name of PROJECT_CONFIG_NAMES) {
      if (tryMergeConfigFile(config, (0, import_path2.join)(cwd, name))) break;
    }
  }
  return config;
}
function tryMergeConfigFile(config, filePath) {
  if (!(0, import_fs.existsSync)(filePath)) return false;
  try {
    const raw = (0, import_fs.readFileSync)(filePath, "utf-8");
    const parsed = filePath.endsWith(".yaml") || filePath.endsWith(".yml") ? (0, import_yaml.parse)(raw) : JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      mergeConfig(config, parsed);
      return true;
    }
  } catch {
  }
  return false;
}
function mergeConfig(base, override) {
  if (override.alwaysAllow) {
    base.alwaysAllow = [...base.alwaysAllow || [], ...override.alwaysAllow];
  }
  if (override.alwaysDeny) {
    base.alwaysDeny = [...base.alwaysDeny || [], ...override.alwaysDeny];
  }
  if (override.globalDeny) {
    base.globalDeny = [...base.globalDeny || [], ...override.globalDeny];
  }
  if (override.defaultDecision) {
    base.defaultDecision = override.defaultDecision;
  }
  if (override.askOnSubshell !== void 0) {
    base.askOnSubshell = override.askOnSubshell;
  }
  if (override.rules) {
    for (const userRule of override.rules) {
      const idx = base.rules.findIndex((r) => r.command === userRule.command);
      if (idx >= 0) {
        base.rules[idx] = userRule;
      } else {
        base.rules.push(userRule);
      }
    }
  }
}

// src/index.ts
async function main() {
  let raw = "";
  for await (const chunk of process.stdin) {
    raw += chunk;
  }
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    process.exit(0);
  }
  if (input.tool_name !== "Bash") {
    process.exit(0);
  }
  const command = input.tool_input?.command;
  if (!command || typeof command !== "string") {
    process.exit(0);
  }
  const config = loadConfig(input.cwd);
  const parsed = parseCommand(command);
  const result = evaluate(parsed, config);
  if (result.decision === "allow") {
    const output = {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        permissionDecisionReason: `[warden] ${result.reason}`
      }
    };
    process.stdout.write(JSON.stringify(output));
    process.exit(0);
  }
  if (result.decision === "deny") {
    process.stderr.write(`[warden] Blocked: ${result.reason}
`);
    process.exit(2);
  }
  process.exit(0);
}
main().catch(() => process.exit(0));
