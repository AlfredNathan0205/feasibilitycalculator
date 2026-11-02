/**
 * CPL's named people and the roles they hold. Edit this file (or, later, the
 * role-holder admin screen) when the org changes. Roles come from
 * rolesSeed in roles.ts.
 *
 * Pauline Holmes (General Manager) holds the veto: she may veto any open
 * requirement on any brief. No requirement is routed to her, so nothing
 * waits on her. CPL has left any other approval role for her open.
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
  {
    upn: "chloe.ogden@cplaromas.com",
    displayName: "Chloe Ogden",
    roles: ["account_manager"],
  },
  {
    upn: "pauline.holmes@cplaromas.com",
    displayName: "Pauline Holmes",
    roles: ["approver", "general_manager"],
  },
];
