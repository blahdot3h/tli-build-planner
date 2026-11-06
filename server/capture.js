// Screenshots of the game for what the log never records: talent trees when a login cuts them off,
// the follower and its skills, prism and item tooltips, the dummy's debuffs. Taken by the planner when
// the log shows such a page opening, or with the UI's capture button; read afterwards to fill in the
// character. Windows only (PowerShell, .NET's screen copy) of the primary monitor, where the game runs.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

const KEEP = 300; // newest screenshots kept on disk

export class Captures {
  constructor(dir) {
    this.dir = dir;
    this.indexFile = path.join(dir, 'index.json');
    fs.mkdirSync(dir, { recursive: true });
    try {
      this.items = JSON.parse(fs.readFileSync(this.indexFile, 'utf8'));
    } catch {
      this.items = [];
    }
  }

  // Newest first; one character's when a playerId is given
  list(playerId = null, limit = 60) {
    return this.items.filter((c) => !playerId || c.playerId === playerId).slice(-limit).reverse();
  }

  file(name) {
    const item = this.items.find((c) => c.file === name);
    return item ? path.join(this.dir, item.file) : null;
  }

  // { label: what's on screen ("Talent tree: Magister"), reason: 'auto' | 'button', playerId }
  take({ label = 'Game screen', reason = 'button', playerId = null } = {}) {
    const takenAt = Date.now();
    const slug = label.replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'screen';
    const file = `${new Date(takenAt).toISOString().replace(/[:.]/g, '-')}-${slug}.png`;
    const out = path.join(this.dir, file).replace(/'/g, "''");
    const ps = [
      'Add-Type -AssemblyName System.Windows.Forms, System.Drawing',
      '$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds',
      '$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height',
      '$g = [System.Drawing.Graphics]::FromImage($bmp)',
      '$g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)',
      `$bmp.Save('${out}', [System.Drawing.Imaging.ImageFormat]::Png)`,
      '$g.Dispose(); $bmp.Dispose()',
    ].join('; ');
    return new Promise((resolve, reject) => {
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true }, (err) => {
        if (err) return reject(new Error(`Screenshot failed: ${err.message}`));
        const item = { file, label, reason, playerId, takenAt };
        this.items.push(item);
        for (const old of this.items.splice(0, Math.max(0, this.items.length - KEEP))) fs.rm(path.join(this.dir, old.file), { force: true }, () => {});
        fs.writeFileSync(this.indexFile, JSON.stringify(this.items, null, 1));
        resolve(item);
      });
    });
  }
}
