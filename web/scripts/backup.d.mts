export function createBackup(options: {
  root: string;
  out: string;
  dbFile?: string;
  now?: Date;
}): { dir: string; files: number; bytes: number };
export function verifyBackup(dir: string): {
  ok: boolean;
  problems: string[];
  manifest?: { files: Array<{ path: string }>; tables: Record<string, number> };
};
export function restoreBackup(options: { backup: string; target: string }): {
  dir: string;
  files: number;
};
export function pruneBackups(out: string, keep: number): string[];
