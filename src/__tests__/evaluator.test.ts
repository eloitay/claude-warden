import { describe, it, expect } from 'vitest';
import { evaluate } from '../evaluator';
import { parseCommand } from '../parser';
import { DEFAULT_CONFIG } from '../defaults';

function eval_(cmd: string) {
  return evaluate(parseCommand(cmd), DEFAULT_CONFIG);
}

describe('evaluator', () => {
  describe('always-allow commands', () => {
    it('allows cat', () => {
      expect(eval_('cat file.txt').decision).toBe('allow');
    });

    it('allows ls -la', () => {
      expect(eval_('ls -la').decision).toBe('allow');
    });

    it('allows grep pattern file', () => {
      expect(eval_('grep foo bar.txt').decision).toBe('allow');
    });

    it('allows jq', () => {
      expect(eval_('jq .name package.json').decision).toBe('allow');
    });

    it('allows echo', () => {
      expect(eval_('echo hello').decision).toBe('allow');
    });
  });

  describe('always-deny commands', () => {
    it('denies sudo', () => {
      expect(eval_('sudo apt install').decision).toBe('deny');
    });

    it('denies shutdown', () => {
      expect(eval_('shutdown -h now').decision).toBe('deny');
    });

    it('denies crontab', () => {
      expect(eval_('crontab -e').decision).toBe('deny');
    });
  });

  describe('global deny patterns', () => {
    it('denies rm -rf', () => {
      expect(eval_('rm -rf /').decision).toBe('deny');
    });

    it('denies rm -fr', () => {
      expect(eval_('rm -fr /tmp/stuff').decision).toBe('deny');
    });

    it('denies chmod -R 777', () => {
      expect(eval_('chmod -R 777 /var/www').decision).toBe('deny');
    });
  });

  describe('conditional rules', () => {
    it('allows node --version', () => {
      expect(eval_('node --version').decision).toBe('allow');
    });

    it('asks for node script.js', () => {
      expect(eval_('node script.js').decision).toBe('ask');
    });

    it('allows npx jest', () => {
      expect(eval_('npx jest').decision).toBe('allow');
    });

    it('allows npx vitest', () => {
      expect(eval_('npx vitest --coverage').decision).toBe('allow');
    });

    it('asks for npx unknown-package', () => {
      expect(eval_('npx unknown-package').decision).toBe('ask');
    });

    it('allows npm install', () => {
      expect(eval_('npm install').decision).toBe('allow');
    });

    it('allows npm run build', () => {
      expect(eval_('npm run build').decision).toBe('allow');
    });

    it('asks for npm publish', () => {
      expect(eval_('npm publish').decision).toBe('ask');
    });

    it('allows git status', () => {
      expect(eval_('git status').decision).toBe('allow');
    });

    it('allows git commit', () => {
      expect(eval_('git commit -m "feat: add feature"').decision).toBe('allow');
    });

    it('asks for git push --force', () => {
      expect(eval_('git push --force origin main').decision).toBe('ask');
    });

    it('asks for git reset --hard', () => {
      expect(eval_('git reset --hard HEAD~1').decision).toBe('ask');
    });

    it('allows bun install', () => {
      expect(eval_('bun install').decision).toBe('allow');
    });

    it('allows bun run test', () => {
      expect(eval_('bun run test').decision).toBe('allow');
    });

    it('allows rm single file (few args)', () => {
      const result = eval_('rm temp.txt');
      expect(result.decision).toBe('allow');
    });

    it('asks for rm -r', () => {
      expect(eval_('rm -r directory').decision).toBe('ask');
    });

    it('allows docker ps', () => {
      expect(eval_('docker ps').decision).toBe('allow');
    });

    it('asks for docker run', () => {
      expect(eval_('docker run ubuntu').decision).toBe('ask');
    });
  });

  describe('pipelines', () => {
    it('allows cat | grep | wc pipeline', () => {
      expect(eval_('cat file.txt | grep pattern | wc -l').decision).toBe('allow');
    });

    it('allows ls | sort | head pipeline', () => {
      expect(eval_('ls -la | sort -k5 | head -20').decision).toBe('allow');
    });

    it('denies pipeline with sudo', () => {
      expect(eval_('echo hello | sudo tee /etc/config').decision).toBe('deny');
    });

    it('asks when pipeline has unknown command', () => {
      expect(eval_('cat file.txt | custom-tool').decision).toBe('ask');
    });
  });

  describe('chains', () => {
    it('allows safe chain with &&', () => {
      expect(eval_('mkdir -p dir && touch dir/file').decision).toBe('allow');
    });

    it('denies chain with dangerous command', () => {
      expect(eval_('echo done && sudo rm -rf /').decision).toBe('deny');
    });

    it('asks for chain with unknown command', () => {
      expect(eval_('npm run build && deploy-script').decision).toBe('ask');
    });
  });

  describe('env prefixes', () => {
    it('evaluates command after env prefix', () => {
      expect(eval_('NODE_ENV=production npm run build').decision).toBe('allow');
    });

    it('evaluates npx after env prefix', () => {
      expect(eval_('NODE_OPTIONS="--max-old-space-size=4096" npx jest').decision).toBe('allow');
    });
  });

  describe('subshells', () => {
    it('asks for commands with $()', () => {
      expect(eval_('echo $(whoami)').decision).toBe('ask');
    });

    it('asks for commands with backticks', () => {
      expect(eval_('echo `date`').decision).toBe('ask');
    });
  });

  describe('edge cases', () => {
    it('allows empty command', () => {
      expect(eval_('').decision).toBe('allow');
    });

    it('asks for unknown command', () => {
      expect(eval_('totally-unknown-command').decision).toBe('ask');
    });

    it('handles command with path', () => {
      // /usr/bin/node --version → node --version → allow
      expect(eval_('/usr/bin/node --version').decision).toBe('allow');
    });
  });
});
