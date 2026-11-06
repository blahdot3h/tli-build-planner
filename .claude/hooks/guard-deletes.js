// PreToolUse hook for Bash/PowerShell: ask before a command deletes anything outside this repo.
// Deleting inside the repo, and every other command, falls through to the allow rules in
// settings.local.json (no prompt). Reads the hook payload as JSON on stdin.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..').toLowerCase();

// Delete verbs: PowerShell cmdlets and aliases, POSIX tools, git, and file APIs in inline scripts
const DELETE =
  /(^|[\s;|&({])(remove-item|rm|del|erase|rd|rmdir|ri|unlink|shred)(?=[\s;|&)]|$)|\bgit\s+(rm|clean)\b|::Delete\(|\bfs\.(rm|rmSync|unlink|unlinkSync|rmdir|rmdirSync)\b|\bshutil\.rmtree\b|\bos\.(remove|unlink|rmdir)\b/i;
// Absolute paths (C:\..., C:/..., \\server\..., Git Bash /c/...) and paths that climb out with ..
// Quoted strings are checked whole first, since paths like "S:\TLI Build Planner" contain spaces.
const QUOTED = /(["'])(.*?)\1/g;
const ABS = String.raw`(?:[a-z]:[\\/]|\\\\|\/[a-z]\/)`;
const QUOTED_PATH = new RegExp(`^(?:${ABS}|\\.\\.)`, 'i');
const ABS_PATH = new RegExp(`(?<![\\w.])${ABS}[^"'\\s;|&)]*`, 'gi');
const UP_PATH = /(?<![\w])\.\.(?:[\\/][^"'\s;|&)]*)?/g;
// Locations that only resolve at run time
const ENV_PATH = /\$env:|%\w+%|\$HOME\b|\$\{?(TMP|TEMP|HOME|USERPROFILE)\b|(?<![\w])~[\\/]/i;

let raw = '';
for await (const chunk of process.stdin) raw += chunk;const input = JSON.parse(raw);
const command = String(input.tool_input?.command ?? '');
if (!DELETE.test(command)) process.exit(0);

const cwd = input.cwd || REPO;
const isInside = (p) => {
  const full = path.resolve(cwd, p.replace(/^\/([a-z])\//i, '$1:/')).toLowerCase();
  return full === REPO || full.startsWith(REPO + path.sep);
};

const quoted = [...command.matchAll(QUOTED)].map((m) => m[2]).filter((s) => QUOTED_PATH.test(s));
const unquoted = command.replace(QUOTED, ' ');
const paths = [...quoted, ...[...unquoted.matchAll(ABS_PATH), ...unquoted.matchAll(UP_PATH)].map((m) => m[0])];
const outside = paths.filter((p) => !isInside(p));
let reason = null;
if (outside.length) reason = `deletes or references a path outside the repo: ${outside[0]}`;
else if (ENV_PATH.test(command)) reason = 'deletes a path built from an environment variable';
else if (!isInside(cwd)) reason = `runs a delete from outside the repo (${cwd})`;

if (reason) {
  console.log(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: `This command ${reason}.` },
    }),
  );
}
