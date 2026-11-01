/** Shared row helpers. Rows arrive snake_case from SQLite; the contract is camelCase. */
export type Row = Record<string, unknown>;

export const str = (row: Row, key: string): string => String(row[key]);
export const optStr = (row: Row, key: string): string | null => (row[key] == null ? null : String(row[key]));
export const num = (row: Row, key: string): number => Number(row[key]);
export const json = <T>(row: Row, key: string): T => JSON.parse(String(row[key])) as T;
