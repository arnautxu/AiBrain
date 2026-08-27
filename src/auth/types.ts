export type AuthProvider = "demo" | "local";
export type AuthMode = "demo" | "supabase" | "unavailable";

export type AuthSession = {
  provider: AuthProvider;
  user: {
    id: string;
    name: string;
    email: string;
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
  tenantId: string;
  tenantName: string;
  productName: string;
  description: string;
};
