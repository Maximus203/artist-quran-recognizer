export type ChainResult =
  | { ok: true; lines: number }
  | { ok: false; badLine: number };
export type Group = {
  signature: string;
  level: "warn" | "error";
  count: number;
  first: string;
  last: string;
  days: number;
};
export type Report = {
  groups: Group[];
  chain: Array<{ file: string } & ChainResult>;
  recurring: Group[];
  missing: boolean;
};
export function verifyChain(text: string): ChainResult;
export function signature(entry: { scope?: string; msg?: string }): string;
export function summarize(
  dir: string,
  options?: { minDays?: number; minCount?: number },
): Report;
export function render(result: Report): string;
export function exitCode(result: Report): number;
