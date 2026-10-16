export type UserRole = "ADMIN" | "EMPLOYEE";

export type User = {
  id: string;
  hubUserId?: string;
  name: string;
  email: string;
  role: UserRole;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};
