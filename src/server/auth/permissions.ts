import { createAccessControl } from "better-auth/plugins/access";

/** Organization permissions (Better Auth access control). Content permissions are added with brands (TASK-005). */
export const statements = {
  organization: ["update", "delete"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
  team: ["create", "update", "delete"],
  ac: ["create", "read", "update", "delete"],
} as const;

export const ac = createAccessControl(statements);

/** Owner: members, invitations, organization profile. Never delete (disabled globally). */
export const owner = ac.newRole({
  organization: ["update"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
  team: [],
  ac: ["read"],
});

/** Editor: content only — no member or invitation management. */
export const editor = ac.newRole({
  organization: [],
  member: [],
  invitation: [],
  team: [],
  ac: ["read"],
});
