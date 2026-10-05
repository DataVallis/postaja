/** Parses a comma/space separated email list (e.g. SUPERADMIN_EMAILS). Lower-cased, trimmed, de-duplicated. */
export function parseEmailList(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(/[,\s]+/)
      .map((e) => normalizeEmail(e))
      .filter((e) => e.includes("@")),
  );
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
