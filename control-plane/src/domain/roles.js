export const Roles = Object.freeze({
  OWNER: "OWNER",
  SENIOR_PM: "SENIOR_PM",
  PM: "PM",
});

export function isKnownRole(role) {
  return Object.values(Roles).includes(role);
}
