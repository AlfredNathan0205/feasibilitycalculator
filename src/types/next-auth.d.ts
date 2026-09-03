import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session extends DefaultSession {
    userId: string;
    accessRoles: string[];
    approvalAuthorityRoles: string[];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId?: string;
    accessRoles?: string[];
    approvalAuthorityRoles?: string[];
  }
}
