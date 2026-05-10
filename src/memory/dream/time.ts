export function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

export function dateKey(timestamp: number, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp));
}

export function dayRange(date: string, timezone: string): { from: number; to: number } {
  const offset = timezone === "Asia/Shanghai" ? "+08:00" : "Z";
  const from = new Date(`${date}T00:00:00.000${offset}`).getTime();
  const to = new Date(`${date}T23:59:59.999${offset}`).getTime();
  return { from, to };
}
