import { openSync, closeSync, fstatSync, lstatSync, constants } from 'node:fs';
import { dirname, basename } from 'node:path';
import { evidencePath } from './path-policy.js';

// Opening/closing another descriptor for a SQLite inode can drop this process's
// POSIX locks. Refuse overlapping helper lifetimes before opening that inode.
const activePaths = new Set(), activeInodes = new Set();
const inodeKey = stat => `${stat.dev}:${stat.ino}`;

// A retained directory descriptor narrows ancestor races. SQLite still opens a
// pathname and may canonicalize it: a trusted OS identity boundary is required.
export function prepareSqlitePath(path, { existingOnly = false } = {}) {
  const absolute = evidencePath(path);
  if (activePaths.has(absolute)) throw new Error('SQLITE_ALREADY_OPEN_IN_PROCESS');
  let ownedInode;
  let directory = openSync('/', constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    for (const component of dirname(absolute).split('/').filter(Boolean)) {
      const next = openSync(`/proc/self/fd/${directory}/${component}`, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      const ancestor = fstatSync(directory);
      if ((ancestor.mode & 0o022) && !(ancestor.mode & 0o1000)) { closeSync(next); throw new Error('SQLITE_UNTRUSTED_ANCESTOR'); }
      closeSync(directory); directory = next;
    }
    const parent = fstatSync(directory);
    if (parent.uid !== process.getuid() || (parent.mode & 0o022)) throw new Error('SQLITE_PRIVATE_DIRECTORY_REQUIRED');
    const target = `/proc/self/fd/${directory}/${basename(absolute)}`;
    let file;
    try {
      try { if (activeInodes.has(inodeKey(lstatSync(target)))) throw new Error('SQLITE_ALREADY_OPEN_IN_PROCESS'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      activePaths.add(absolute);
      try { file = openSync(target, existingOnly ? constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK : constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
      catch (error) { if (error.code !== 'EEXIST') throw error; file = openSync(target, constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
      const identity = fstatSync(file);
      if (!identity.isFile() || identity.nlink !== 1 || identity.uid !== process.getuid() || (identity.mode & 0o077)) throw new Error('UNSAFE_SQLITE_FILE');
      ownedInode = inodeKey(identity); activeInodes.add(ownedInode);
      // Never close a second descriptor after SQLite acquires POSIX locks.
      closeSync(file); file = undefined;
      const verify = () => {
        const now = lstatSync(target), current = lstatSync(absolute), dir = lstatSync(dirname(absolute));
        if (!now.isFile() || now.nlink !== 1 || now.uid !== identity.uid || (now.mode & 0o077) || dir.uid !== parent.uid || (dir.mode & 0o022) || now.dev !== identity.dev || now.ino !== identity.ino || current.dev !== identity.dev || current.ino !== identity.ino || dir.dev !== parent.dev || dir.ino !== parent.ino) throw new Error('SQLITE_PATH_IDENTITY_CHANGED');
        for (const suffix of ['-journal','-wal','-shm']) {
          try { const s = lstatSync(target + suffix); if (!s.isFile() || s.nlink !== 1 || s.uid !== identity.uid || (s.mode & 0o077)) throw new Error('UNSAFE_SQLITE_COMPANION'); }
          catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
      };
      verify();
      let closed = false;
      return { target, verify, close: () => { if (!closed) { closed = true; activePaths.delete(absolute); activeInodes.delete(ownedInode); closeSync(directory); } } };
    } finally { if (file !== undefined) closeSync(file); }
  } catch (error) { activePaths.delete(absolute); if (ownedInode) activeInodes.delete(ownedInode); closeSync(directory); throw error; }
}
