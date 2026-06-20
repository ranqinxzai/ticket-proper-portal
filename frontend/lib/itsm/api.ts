/** Typed API helpers for the ITSM platform (P0 foundation; expanded per phase). */

import { itsmClient, pickResults } from "./client";
import type { Helpdesk, ItsmUser, LoginResponse } from "./types";

export const authApi = {
  login: (username: string, password: string) =>
    itsmClient.post<LoginResponse>("/auth/login/", { username, password }, { anon: true }),
  me: () => itsmClient.get<ItsmUser>("/auth/me/"),
};

export const helpdesksApi = {
  list: async (): Promise<Helpdesk[]> =>
    pickResults<Helpdesk>(await itsmClient.get("/helpdesks/")),
};
