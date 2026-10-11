// Who sells Postaja (owner, 2026-10-09): shown to customers (demo pages now; legal pages and the landing with TASK-035)
// and set as the business details in Stripe, which issues the invoices (TASK-036, ADR-074).
export const SELLER = {
  name: "David Tacer s.p.",
  address: "Robindvor 39, 2370 Dravograd, Slovenija",
  taxNumber: "36130800",
  vatId: "SI36130800",
  registrationNumber: "6560024000",
  vatPayer: true,
} as const;
