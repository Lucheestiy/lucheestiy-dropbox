import { dropprFetch } from "./api";
import { isLoggedIn } from "./auth";

interface AdminConfig {
  root?: string;
  username_pattern?: string;
  password_min_length?: number;
  password_rules?: any;
}

class AdminService {
  public isAdmin: boolean | null = null;
  public config: AdminConfig = {
    root: "/users",
    password_min_length: 8,
  };
  private checkPromise: Promise<boolean> | null = null;

  async check(): Promise<boolean> {
    if (!isLoggedIn()) {
      this.isAdmin = false;
      return false;
    }
    if (this.isAdmin !== null) return this.isAdmin;
    if (this.checkPromise) return this.checkPromise;

    this.checkPromise = dropprFetch("/api/droppr/users", {})
      .then(async (res) => {
        if (!res.ok) {
          this.isAdmin = false;
          return false;
        }
        try {
          const data = await res.json();
          this.config = { ...this.config, ...data };
          this.isAdmin = true;
          return true;
        } catch {
          this.isAdmin = false;
          return false;
        }
      })
      .catch(() => {
        this.isAdmin = false;
        return false;
      })
      .finally(() => {
        this.checkPromise = null;
      });

    return this.checkPromise;
  }
}

export const adminService = new AdminService();
