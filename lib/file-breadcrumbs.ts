import {
  getFileDirectory,
  getRelativeFilePath,
  joinFilePath,
  normalizeFilePathSlashes,
} from "@/lib/file-paths";

export type FileBreadcrumbSegment = {
  label: string;
  /** Absolute path for this segment; directories are revealable. */
  path: string;
  kind: "root" | "directory" | "file";
};

/**
 * Build clickable breadcrumb segments for a workspace file.
 * Root (cwd basename or drive) + intermediate directories + final file.
 */
export function buildFileBreadcrumbs(filePath: string, cwd?: string): FileBreadcrumbSegment[] {
  const normalizedFile = normalizeFilePathSlashes(filePath);
  const relative = getRelativeFilePath(normalizedFile, cwd);
  const parts = relative.split("/").filter(Boolean);
  if (parts.length === 0) {
    return [{ label: normalizedFile, path: normalizedFile, kind: "file" }];
  }

  const segments: FileBreadcrumbSegment[] = [];
  const normalizedCwd = cwd ? normalizeFilePathSlashes(cwd).replace(/\/$/, "") : "";

  if (normalizedCwd) {
    const rootLabel = normalizedCwd.split("/").filter(Boolean).pop() ?? normalizedCwd;
    segments.push({ label: rootLabel, path: normalizedCwd, kind: "root" });
  }

  let acc = normalizedCwd;
  for (let i = 0; i < parts.length; i += 1) {
    const label = parts[i];
    acc = acc ? joinFilePath(acc, label) : label;
    const isLast = i === parts.length - 1;
    segments.push({
      label,
      path: acc,
      kind: isLast ? "file" : "directory",
    });
  }

  return segments;
}

export function directoryPathForBreadcrumb(segment: FileBreadcrumbSegment): string | null {
  if (segment.kind === "file") return getFileDirectory(segment.path) || null;
  return segment.path;
}
