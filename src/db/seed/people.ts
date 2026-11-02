/**
 * CPL's named people and the roles they hold. Edit this file (or, later, the
 * role-holder admin screen) when the org changes. Roles come from
 * rolesSeed in roles.ts.
 *
 * Pauline Holmes is deliberately provisioned with no roles: CPL has said she
 * is a division head "with approvals" but has not yet said which requests
 * route to her. Add her role here once confirmed.
 */
export interface Person {
  upn: string; // lower-case; matched case-insensitively at sign-in
  displayName: string;
  roles: string[];
}

export const people: Person[] = [
  {
    upn: "alfred.muthunathan@cplaromas.com",
    displayName: "Alfred Muthunathan",
    roles: ["admin"],
  },
  { upn: "simon.roper@cplaromas.com", displayName: "Simon Roper", roles: ["admin"] },
  { upn: "tia.oneill@cplaromas.com", displayName: "Tia O'Neil", roles: ["admin"] },
  {
    upn: "claire.holland@cplaromas.com",
    displayName: "Claire Holland",
    roles: ["approver", "commercial_director"],
  },
  {
    upn: "jo.lambert@cplaromas.com",
    displayName: "Jo Lambert",
    roles: ["approver", "development_director", "ppd_manager", "analytical_manager"],
  },
  {
    upn: "selena.wagstaff@cplaromas.com",
    displayName: "Selena Wagstaff",
    roles: ["approver", "divisional_head_marketing"],
  },
  { upn: "pauline.holmes@cplaromas.com", displayName: "Pauline Holmes", roles: [] },
];
