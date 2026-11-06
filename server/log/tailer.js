import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { StringDecoder } from 'node:string_decoder';

const CHUNK = 1 << 20;

// Reads lines appended to the log since the last poll. The file is opened only for the
// duration of each read so the game can always rotate it. UE renames UE_game.log to a
// backup when the game starts, so a new file id or a shrinking file means "start over".
//
// Events: 'reset' ({ reason: 'opened' | 'rotated' }), 'lines' (string[]), 'missing'
export class LogTailer extends EventEmitter {
  constructor(filePath) {
    super();
    this.filePath = filePath;
    this.exists = false;
    this.fileId = null;
    this.size = 0;
    this.mtimeMs = 0;
    this.lastReadAt = null;
    this.lastError = null;
    this.lastLine = null;
    this.restart();
  }

  // Next poll re-reads the file from the top
  restart() {
    this.offset = 0;
    this.partial = '';
    this.decoder = new StringDecoder('utf8');
  }

  // Returns the number of complete lines emitted.
  poll() {
    let stat;
    try {
      stat = fs.statSync(this.filePath);
    } catch (err) {
      this.lastError = err.code === 'ENOENT' ? null : err.message;
      if (this.exists) {
        this.exists = false;
        this.emit('missing');
      }
      return 0;
    }

    const fileId = `${stat.ino}:${stat.birthtimeMs}`;
    if (!this.exists || fileId !== this.fileId || stat.size < this.offset) {
      const reason = this.fileId === null ? 'opened' : 'rotated';
      this.exists = true;
      this.fileId = fileId;
      this.restart();
      this.emit('reset', { reason });
    }
    this.size = stat.size;
    this.mtimeMs = stat.mtimeMs;
    if (stat.size === this.offset) return 0;

    let emitted = 0;
    let fd;
    try {
      fd = fs.openSync(this.filePath, 'r');
      const buf = Buffer.allocUnsafe(CHUNK);
      while (this.offset < stat.size) {
        const n = fs.readSync(fd, buf, 0, Math.min(CHUNK, stat.size - this.offset), this.offset);
        if (n <= 0) break;
        let text = this.decoder.write(buf.subarray(0, n));
        if (this.offset === 0) text = text.replace(/^﻿/, '');
        this.offset += n;
        const lines = (this.partial + text).split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
        this.partial = lines.pop();
        if (lines.length) {
          emitted += lines.length;
          this.lastLine = lines[lines.length - 1];
          this.emit('lines', lines);
        }
      }
      this.lastReadAt = Date.now();
      this.lastError = null;
    } catch (err) {
      this.lastError = err.message;
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
    return emitted;
  }

  // Last complete line currently in the file, read independently of the tailer's position.
  // Used to prove the tailer is caught up with what the game has written.
  readLastLine() {
    const fd = fs.openSync(this.filePath, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      const len = Math.min(size, 256 * 1024);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, size - len);
      const lines = buf.toString('utf8').split('\n');
      lines.pop(); // partial (or empty) text after the final newline
      const last = lines.pop();
      return last === undefined ? null : last.replace(/\r$/, '');
    } finally {
      fs.closeSync(fd);
    }
  }
}
