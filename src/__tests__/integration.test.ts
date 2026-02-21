import { describe, it, expect } from 'vitest';
import { parseCommand } from '../parser';
import { evaluate } from '../evaluator';
import { DEFAULT_CONFIG } from '../defaults';
import type { WardenConfig } from '../types';

/** Simulate the full pipeline: parse → evaluate with default config */
function warden(command: string) {
  const parsed = parseCommand(command);
  return evaluate(parsed, DEFAULT_CONFIG);
}

function wardenWithSSH(command: string, trustedHosts: string[]) {
  const config: WardenConfig = { ...structuredClone(DEFAULT_CONFIG), trustedSSHHosts: trustedHosts };
  return evaluate(parseCommand(command), config);
}

describe('integration: realistic commands', () => {
  describe('common safe patterns that currently prompt', () => {
    it('cat a.txt | wc -l → allow', () => {
      expect(warden('cat a.txt | wc -l').decision).toBe('allow');
    });

    it('cat file | grep pattern | sort | uniq -c | head -20 → allow', () => {
      expect(warden('cat file | grep pattern | sort | uniq -c | head -20').decision).toBe('allow');
    });

    it('git log --oneline | head -10 → allow', () => {
      expect(warden('git log --oneline | head -10').decision).toBe('allow');
    });

    it('npm run build && npm test → allow', () => {
      expect(warden('npm run build && npm test').decision).toBe('allow');
    });

    it('pnpm install && pnpm run build → allow', () => {
      expect(warden('pnpm install && pnpm run build').decision).toBe('allow');
    });

    it('mkdir -p src/components && touch src/components/Button.tsx → allow', () => {
      expect(warden('mkdir -p src/components && touch src/components/Button.tsx').decision).toBe('allow');
    });

    it('ls -la | wc -l → allow', () => {
      expect(warden('ls -la | wc -l').decision).toBe('allow');
    });

    it('grep -r "TODO" src/ | wc -l → allow', () => {
      expect(warden('grep -r "TODO" src/ | wc -l').decision).toBe('allow');
    });
  });

  describe('npx/bunx with known tools', () => {
    it('npx jest --coverage → allow', () => {
      expect(warden('npx jest --coverage').decision).toBe('allow');
    });

    it('npx vitest run → allow', () => {
      expect(warden('npx vitest run').decision).toBe('allow');
    });

    it('npx tsc --noEmit → allow', () => {
      expect(warden('npx tsc --noEmit').decision).toBe('allow');
    });

    it('npx eslint src/ → allow', () => {
      expect(warden('npx eslint src/').decision).toBe('allow');
    });

    it('npx prettier --write . → allow', () => {
      expect(warden('npx prettier --write .').decision).toBe('allow');
    });

    it('npx prisma migrate dev → allow', () => {
      expect(warden('npx prisma migrate dev').decision).toBe('allow');
    });

    it('npx unknown-sketchy-package → ask', () => {
      expect(warden('npx unknown-sketchy-package').decision).toBe('ask');
    });

    it('bunx vitest run → allow', () => {
      expect(warden('bunx vitest run').decision).toBe('allow');
    });
  });

  describe('env prefix patterns', () => {
    it('NODE_ENV=production npm run build → allow', () => {
      expect(warden('NODE_ENV=production npm run build').decision).toBe('allow');
    });

    it('NODE_OPTIONS="--max-old-space-size=4096" npx jest → allow', () => {
      expect(warden('NODE_OPTIONS="--max-old-space-size=4096" npx jest').decision).toBe('allow');
    });

    it('CI=true npm test → allow', () => {
      expect(warden('CI=true npm test').decision).toBe('allow');
    });
  });

  describe('dangerous commands', () => {
    it('sudo rm -rf / → deny', () => {
      expect(warden('sudo rm -rf /').decision).toBe('deny');
    });

    it('rm -rf / → deny (global pattern)', () => {
      expect(warden('rm -rf /').decision).toBe('deny');
    });

    it('echo hello && sudo apt install malware → deny', () => {
      expect(warden('echo hello && sudo apt install malware').decision).toBe('deny');
    });

    it('chmod -R 777 /var/www → deny', () => {
      expect(warden('chmod -R 777 /var/www').decision).toBe('deny');
    });

    it('shutdown -h now → deny', () => {
      expect(warden('shutdown -h now').decision).toBe('deny');
    });
  });

  describe('ask patterns (cautious)', () => {
    it('node script.js → ask', () => {
      expect(warden('node script.js').decision).toBe('ask');
    });

    it('python manage.py runserver → ask', () => {
      expect(warden('python manage.py runserver').decision).toBe('ask');
    });

    it('docker run -it ubuntu → ask', () => {
      expect(warden('docker run -it ubuntu').decision).toBe('ask');
    });

    it('ssh user@host → ask', () => {
      expect(warden('ssh user@host').decision).toBe('ask');
    });

    it('git push --force origin main → ask', () => {
      expect(warden('git push --force origin main').decision).toBe('ask');
    });

    it('echo $(whoami) → ask (subshell)', () => {
      expect(warden('echo $(whoami)').decision).toBe('ask');
    });

    it('npm publish → ask', () => {
      expect(warden('npm publish').decision).toBe('ask');
    });
  });

  describe('SSH host whitelisting end-to-end', () => {
    const hosts = ['devserver', '*.internal.com'];

    it('ssh devserver → allow (trusted, no remote cmd)', () => {
      expect(wardenWithSSH('ssh devserver', hosts).decision).toBe('allow');
    });

    it('ssh devserver cat /etc/hosts → allow (trusted + safe cmd)', () => {
      expect(wardenWithSSH('ssh devserver cat /etc/hosts', hosts).decision).toBe('allow');
    });

    it('ssh devserver sudo rm -rf / → deny (trusted + dangerous cmd)', () => {
      expect(wardenWithSSH('ssh devserver sudo rm -rf /', hosts).decision).toBe('deny');
    });

    it('ssh unknown-host → ask (not trusted)', () => {
      expect(wardenWithSSH('ssh unknown-host', hosts).decision).toBe('ask');
    });

    it('scp file.txt devserver:/tmp/ → allow (trusted)', () => {
      expect(wardenWithSSH('scp file.txt devserver:/tmp/', hosts).decision).toBe('allow');
    });

    it('ssh -i key -p 2222 devserver ls → allow (flags skipped)', () => {
      expect(wardenWithSSH('ssh -i key -p 2222 devserver ls', hosts).decision).toBe('allow');
    });

    it('ssh devserver npm run build && echo done → allow (pipeline)', () => {
      expect(wardenWithSSH('ssh devserver npm run build', hosts).decision).toBe('allow');
    });

    it('rsync -avz src/ user@app.internal.com:/opt/ → allow (glob match)', () => {
      expect(wardenWithSSH('rsync -avz src/ user@app.internal.com:/opt/', hosts).decision).toBe('allow');
    });
  });

  describe('sh -c / bash -c recursive parsing', () => {
    it('sh -c "cat file | wc -l" → allow', () => {
      expect(warden('sh -c "cat file | wc -l"').decision).toBe('allow');
    });

    it('bash -c "npm run build && npm test" → allow', () => {
      expect(warden('bash -c "npm run build && npm test"').decision).toBe('allow');
    });

    it('sh -c "sudo rm -rf /" → deny', () => {
      expect(warden('sh -c "sudo rm -rf /"').decision).toBe('deny');
    });
  });

  describe('version/help flags always safe', () => {
    it('node --version → allow', () => {
      expect(warden('node --version').decision).toBe('allow');
    });

    it('python3 --version → allow', () => {
      expect(warden('python3 --version').decision).toBe('allow');
    });

    it('npx --help → allow', () => {
      expect(warden('npx --help').decision).toBe('allow');
    });

    it('bun --version → allow', () => {
      expect(warden('bun --version').decision).toBe('allow');
    });
  });

  describe('git operations', () => {
    it('git add . && git commit -m "feat: update" → allow', () => {
      expect(warden('git add . && git commit -m "feat: update"').decision).toBe('allow');
    });

    it('git stash && git pull --rebase && git stash pop → allow', () => {
      expect(warden('git stash && git pull --rebase && git stash pop').decision).toBe('allow');
    });

    it('git reset --hard HEAD~1 → ask', () => {
      expect(warden('git reset --hard HEAD~1').decision).toBe('ask');
    });
  });
});
