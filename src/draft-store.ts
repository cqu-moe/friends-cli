import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { FriendsError, FriendsErrorCode } from "./errors.js";
import {
  checkVolunteerCertificationMaterials,
  parseVolunteerCertificationDraft,
  type MaterialFileFacts,
  type VolunteerCertificationDraft,
} from "./drafts.js";

export class DraftRevisionConflictError extends FriendsError {
  readonly currentRevision: number;
  readonly conflictPath: string;

  constructor(currentRevision: number, conflictPath: string) {
    super({
      code: FriendsErrorCode.UpstreamBusiness,
      message: `Draft revision conflict: current revision ${currentRevision}; the challenged draft was saved to ${conflictPath}`,
    });
    this.name = "DraftRevisionConflictError";
    this.currentRevision = currentRevision;
    this.conflictPath = conflictPath;
  }
}

interface DraftStoreOptions {
  root?: string;
}

function localError(message: string, code: FriendsErrorCode = FriendsErrorCode.NetworkProtocol): FriendsError {
  return new FriendsError({ code, message });
}

function assertDraftId(id: string): void {
  if (typeof id !== "string" || id === "" || id === "." || id === ".." || /[\\/\r\n\0]/.test(id)) {
    throw localError("Invalid certification draft ID", FriendsErrorCode.InvalidInput);
  }
}

function draftRoot(options: DraftStoreOptions): string {
  return resolve(
    options.root ??
      process.env.FRIENDS_DRAFT_HOME ??
      join(process.env.FRIENDS_HOME ?? join(homedir(), ".local", "state", "friends-cli"), "drafts"),
  );
}

async function assertOutsideRepository(path: string): Promise<void> {
  let existing = path;
  const missing: string[] = [];
  while (!(await lstat(existing).catch(() => null))) {
    missing.unshift(existing.slice(dirname(existing).length + 1));
    existing = dirname(existing);
  }
  let directory = resolve(await realpath(existing), ...missing);
  while (true) {
    if (await lstat(join(directory, ".git")).catch(() => null)) {
      throw localError("The certification draft path must be outside a Git repository", FriendsErrorCode.InvalidInput);
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
}

async function secureRoot(root: string): Promise<void> {
  if (process.platform === "win32") {
    throw localError("Certification draft storage requires POSIX permissions in this version", FriendsErrorCode.InvalidInput);
  }
  await assertOutsideRepository(root);
  const existing = await lstat(root).catch(() => null);
  if (existing && (!existing.isDirectory() || existing.isSymbolicLink() || (existing.mode & 0o777) !== 0o700)) {
    throw localError("Use a dedicated draft directory with mode 0700", FriendsErrorCode.InvalidInput);
  }
  if (!existing) await mkdir(root, { recursive: true, mode: 0o700 });
}

async function assertDraftFile(path: string): Promise<void> {
  const existing = await lstat(path).catch(() => null);
  if (existing && (!existing.isFile() || existing.isSymbolicLink() || (existing.mode & 0o777) !== 0o600)) {
    throw localError("The certification draft file is unsafe", FriendsErrorCode.InvalidInput);
  }
}

async function atomicWrite(path: string, value: unknown): Promise<void> {
  const temporary = join(dirname(path), `.${basename(path)}-${randomUUID()}.json`);
  try {
    await writeFile(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: "wx" });
    await chmod(temporary, 0o600);
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function readDraft(path: string): Promise<VolunteerCertificationDraft> {
  await assertDraftFile(path);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw localError("The certification draft file is invalid");
  }
  try {
    return parseVolunteerCertificationDraft(parsed);
  } catch (error) {
    if (error instanceof FriendsError) throw localError(`The certification draft file is invalid: ${error.message}`);
    throw error;
  }
}

async function withLock<T>(lockPath: string, operation: () => Promise<T>): Promise<T> {
  try {
    await mkdir(lockPath, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      if (!(await lstat(lockPath).catch(() => null))) {
        return withLock(lockPath, operation);
      }
    }
    throw localError("The certification draft is locked by another operation", FriendsErrorCode.UpstreamBusiness);
  }
  try {
    return await operation();
  } finally {
    await rm(lockPath, { recursive: true, force: true });
  }
}

async function sha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export function createCertificationDraftStore(options: DraftStoreOptions = {}) {
  const root = draftRoot(options);

  async function prepare(): Promise<string> {
    await secureRoot(root);
    return root;
  }

  return {
    path(id: string): string {
      assertDraftId(id);
      return join(root, `${id}.json`);
    },
    async save(draftInput: unknown, saveOptions?: { expectedRevision?: number }): Promise<string> {
      const draft = parseVolunteerCertificationDraft(draftInput);
      const storageRoot = await prepare();
      const path = this.path(draft.id);
      await assertOutsideRepository(path);
      return withLock(join(storageRoot, `.${draft.id}.lock`), async () => {
        const existing = await lstat(path).catch(() => null);
        const current = existing === null ? null : await readDraft(path);
        const currentRevision = current?.revision ?? -1;
        const expectedRevision = saveOptions?.expectedRevision ?? draft.revision - 1;
        if (currentRevision !== expectedRevision) {
          const conflictPath = join(storageRoot, `${draft.id}.conflict.${expectedRevision}-${draft.revision}.${randomUUID()}.json`);
          await atomicWrite(conflictPath, draft);
          throw new DraftRevisionConflictError(currentRevision, conflictPath);
        }
        if (draft.revision !== currentRevision + 1) {
          throw localError("Draft revision must advance exactly once", FriendsErrorCode.InvalidInput);
        }
        if (current && JSON.stringify(current.binding) !== JSON.stringify(draft.binding)) {
          throw localError("A stored draft cannot change its account, organization or activity binding", FriendsErrorCode.InvalidInput);
        }
        await atomicWrite(path, draft);
        return path;
      });
    },
    async savePatchConflict(id: string, expectedRevision: number, change: unknown): Promise<string> {
      assertDraftId(id);
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
        throw localError("Expected revision must be a non-negative integer", FriendsErrorCode.InvalidInput);
      }
      const storageRoot = await prepare();
      const path = this.path(id);
      return withLock(join(storageRoot, `.${id}.lock`), async () => {
        const current = await readDraft(path);
        const conflictPath = join(
          storageRoot,
          `${id}.conflict.${expectedRevision}-${current.revision}.${randomUUID()}.json`,
        );
        await atomicWrite(conflictPath, {
          kind: "volunteer-certification-patch-conflict",
          draftId: id,
          expectedRevision,
          currentRevision: current.revision,
          change,
        });
        throw new DraftRevisionConflictError(current.revision, conflictPath);
      });
    },
    async load(id: string): Promise<VolunteerCertificationDraft> {
      assertDraftId(id);
      await prepare();
      return readDraft(this.path(id));
    },
    async list(): Promise<Array<{ id: string; revision: number; activityId: string; includedCount: number }>> {
      await prepare();
      const names = await readdir(root);
      const drafts = await Promise.all(names
        .filter((name) => /^[^./]+\.json$/.test(name))
        .map(async (name) => readDraft(join(root, name))));
      return drafts.map((draft) => ({
        id: draft.id,
        revision: draft.revision,
        activityId: draft.activity.id,
        includedCount: draft.includedStudentNos.length,
      }));
    },
    async checkMaterials(id: string) {
      const draft = await this.load(id);
      const facts: Record<string, MaterialFileFacts> = {};
      for (const material of draft.materials) {
        if (material.kind !== "local-file" || facts[material.path] !== undefined) continue;
        const stat = await lstat(material.path).catch(() => null);
        if (stat === null) facts[material.path] = { exists: false };
        else if (!stat.isFile() || stat.isSymbolicLink()) {
          facts[material.path] = { exists: true, regularFile: false, size: 0, sha256: "" };
        } else {
          facts[material.path] = {
            exists: true,
            regularFile: true,
            size: stat.size,
            sha256: await sha256(material.path),
          };
        }
      }
      return checkVolunteerCertificationMaterials(draft, facts);
    },
  };
}
