/*
 * Who can do what. Shared by the server (which enforces it) and the screens (which hide what a
 * role can't use). The server checks every page, action and API route; hiding is only tidiness.
 */

export const ROLES = ["owner", "manager", "agent"] as const;
export type Role = (typeof ROLES)[number];

/** Roles the owner can hand out. There is exactly one owner: the person who set the CRM up. */
export const ASSIGNABLE_ROLES = ["manager", "agent"] as const satisfies readonly Role[];

export const ROLE_LABEL: Record<Role, string> = { owner: "Owner", manager: "Manager", agent: "Agent" };

export const ROLE_SUMMARY: Record<Role, string> = {
  owner: "Sees and controls everything, including the team and settings.",
  manager: "Sees all leads and assigns them. Can't change settings or the team.",
  agent: "Sees only the leads assigned to them. Can't import, export or delete.",
};

export type Permission =
  /** See every lead, not only one's own. */
  | "leads.all"
  /** Assign or reassign a lead to someone. */
  | "leads.assign"
  /** Bring leads in from a sheet. */
  | "leads.import"
  /** Clear a "needs attention" flag and switch automatic WhatsApp on or off for a lead. */
  | "leads.control"
  /** Open and close site-visit slots. */
  | "visits.slots"
  /** Add or edit projects and accept new figures. */
  | "projects.edit"
  /** The Channels screen: lead counts and money spent per channel. */
  | "insights"
  /** Templates and WhatsApp settings. */
  | "settings"
  /** Add, deactivate and reset team members. */
  | "team";

const ALLOWED: Record<Permission, readonly Role[]> = {
  "leads.all": ["owner", "manager"],
  "leads.assign": ["owner", "manager"],
  "leads.import": ["owner", "manager"],
  "leads.control": ["owner", "manager"],
  "visits.slots": ["owner", "manager"],
  "projects.edit": ["owner", "manager"],
  insights: ["owner", "manager"],
  settings: ["owner"],
  team: ["owner"],
};

export function can(role: Role | null | undefined, permission: Permission): boolean {
  return !!role && ALLOWED[permission].includes(role);
}

export function isRole(v: unknown): v is Role {
  return typeof v === "string" && (ROLES as readonly string[]).includes(v);
}
