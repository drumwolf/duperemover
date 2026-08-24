#!/usr/bin/env node
import * as fs from "fs";
import * as path from "path";

const TRASH_DIR_NAME = "duplicates_trash";

// Matches e.g. "IMG_1820 (1).mov" -> captures "IMG_1820" and ".mov".
// The " (1)" must sit directly before the extension, at the end of the name.
const DUPLICATE_PATTERN = /^(IMG_.*) \(1\)(\.[^./]+)$/;

interface Args {
  targetDir: string;
  shouldDelete: boolean;
}

interface Candidate {
  candidateName: string;
  originalName: string;
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  let shouldDelete = false;

  for (const arg of argv) {
    if (arg === "--delete") {
      shouldDelete = true;
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown flag: ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  if (positional.length !== 1) {
    throw new Error("Usage: duperemover <subdirectory> [--delete]");
  }

  return { targetDir: positional[0], shouldDelete };
}

function filesInDirectory(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
}

function findDuplicateCandidates(fileNames: string[]): Candidate[] {
  const fileSet = new Set(fileNames);
  const candidates: Candidate[] = [];

  for (const name of fileNames) {
    const match = name.match(DUPLICATE_PATTERN);
    if (!match) continue;

    const originalName = match[1] + match[2];
    if (fileSet.has(originalName)) {
      candidates.push({ candidateName: name, originalName });
    }
  }

  return candidates;
}

function filesAreIdentical(pathA: string, pathB: string): boolean {
  if (fs.statSync(pathA).size !== fs.statSync(pathB).size) {
    return false;
  }

  const CHUNK_SIZE = 1024 * 1024;
  const fdA = fs.openSync(pathA, "r");
  const fdB = fs.openSync(pathB, "r");

  try {
    const bufA = Buffer.alloc(CHUNK_SIZE);
    const bufB = Buffer.alloc(CHUNK_SIZE);
    let bytesRead: number;

    do {
      bytesRead = fs.readSync(fdA, bufA, 0, CHUNK_SIZE, null);
      const bytesReadB = fs.readSync(fdB, bufB, 0, CHUNK_SIZE, null);

      if (bytesRead !== bytesReadB) {
        return false;
      }
      if (!bufA.subarray(0, bytesRead).equals(bufB.subarray(0, bytesRead))) {
        return false;
      }
    } while (bytesRead > 0);

    return true;
  } finally {
    fs.closeSync(fdA);
    fs.closeSync(fdB);
  }
}

function moveToTrash(dir: string, fileName: string): void {
  const trashDir = path.join(dir, TRASH_DIR_NAME);
  if (!fs.existsSync(trashDir)) {
    fs.mkdirSync(trashDir);
  }

  const src = path.join(dir, fileName);
  const dest = path.join(trashDir, fileName);

  try {
    fs.renameSync(src, dest);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EXDEV") {
      fs.copyFileSync(src, dest);
      fs.unlinkSync(src);
    } else {
      throw err;
    }
  }
}

function main(): void {
  const { targetDir, shouldDelete } = parseArgs(process.argv.slice(2));

  const resolvedDir = path.resolve(targetDir);
  if (!fs.statSync(resolvedDir).isDirectory()) {
    throw new Error(`${targetDir} is not a directory`);
  }

  const candidates = findDuplicateCandidates(filesInDirectory(resolvedDir));

  if (candidates.length === 0) {
    console.log("No '(1)' files with a matching original filename were found.");
    return;
  }

  let dupeCount = 0;

  for (const { candidateName, originalName } of candidates) {
    const candidatePath = path.join(resolvedDir, candidateName);
    const originalPath = path.join(resolvedDir, originalName);

    if (!filesAreIdentical(candidatePath, originalPath)) {
      console.log(`SKIP   ${candidateName} — differs from ${originalName}, not a duplicate.`);
      continue;
    }

    dupeCount++;

    if (shouldDelete) {
      moveToTrash(resolvedDir, candidateName);
      console.log(`MOVED  ${candidateName} -> ${TRASH_DIR_NAME}/ (duplicate of ${originalName})`);
    } else {
      console.log(
        `DUPE   ${candidateName} is identical to ${originalName} (dry-run, use --delete to move it to ${TRASH_DIR_NAME}/)`
      );
    }
  }

  if (!shouldDelete && dupeCount > 0) {
    console.log(`\n${dupeCount} duplicate(s) found. Re-run with --delete to move them to ${TRASH_DIR_NAME}/.`);
  }
}

main();
