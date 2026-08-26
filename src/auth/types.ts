export type UserRole = "owner" | "member";
export type AuthProvider = "demo" | "local" | "supabase";
export type AuthMode = "demo" | "supabase" | "unavailable";

export type AuthSession = {
  provider: AuthProvider;
  user: {
    id: string;
    name: string;
    email: string;
    role: UserRole;
  };
  tenant: {
    id: string;
    name: string;
  };
  expiresAt: string;
};

export type DemoAccount = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  tenantId: string;
  tenantName: string;
  productName: string;
  description: string;
};
