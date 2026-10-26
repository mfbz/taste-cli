// Reads a small file that must be only its owner's (the credentials file) without the usual races: it
// is opened once, without following a symlink and without blocking on a pipe, and the checks run on
// that open file, so it can't be swapped between the check and the read. Adapted from turbine-cli: it
// throws a reason rather than a catalogue error, because a bad credentials file reads as signed out.
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
} from "node:fs";

type Reason = "missing" | "unreadable" | "too-open" | "invalid";

// Group and others: any of their read, write or execute bits.
const NOT_OWNER_ONLY = 0o077;
// Flags that don't exist on a platform (O_NOFOLLOW, O_NONBLOCK on Windows) are simply left out.
const FLAGS =
  constants.O_RDONLY |
  (constants.O_NOFOLLOW ?? 0) |
  (constants.O_NONBLOCK ?? 0);

class PrivateFileError extends Error {
  readonly reason: Reason;

  constructor(reason: Reason, options?: { cause?: unknown }) {
    super(`private file ${reason}`, options);
    this.name = "PrivateFileError";
    this.reason = reason;
  }
}

function readPrivateFile(
  path: string,
  options: { maxBytes: number; platform: NodeJS.Platform }
): string {
  let fd: number;
  try {
    fd = openSync(path, FLAGS);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // ELOOP: the path is a symlink, which a private file never needs to be.
    const reason =
      code === "ENOENT"
        ? "missing"
        : code === "ELOOP"
          ? "invalid"
          : "unreadable";
    throw new PrivateFileError(reason, { cause: error });
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > options.maxBytes)
      throw new PrivateFileError("invalid");
    // Windows has no POSIX modes; NTFS permissions are the user's to set.
    if (options.platform !== "win32" && (stat.mode & NOT_OWNER_ONLY) !== 0)
      throw new PrivateFileError("too-open");
    return readFileSync(fd, "utf8");
  } catch (error) {
    if (error instanceof PrivateFileError) throw error;
    throw new PrivateFileError("unreadable", { cause: error });
  } finally {
    closeSync(fd);
  }
}

export { PrivateFileError, readPrivateFile };
