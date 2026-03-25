import { writable, derived } from "svelte/store";

export type Route =
  | "dashboard"
  | "sessions"
  | "memories"
  | "search"
  | "plans"
  | "agents"
  | "skills";

export const currentRoute = writable<Route>("dashboard");
export const routeParams = writable<Record<string, string>>({});

export function navigate(route: Route, params: Record<string, string> = {}) {
  currentRoute.set(route);
  routeParams.set(params);
}
