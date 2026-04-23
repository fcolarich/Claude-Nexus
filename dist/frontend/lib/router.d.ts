export type Route = "dashboard" | "sessions" | "memories" | "search" | "plans" | "agents" | "skills" | "tasks";
export declare const currentRoute: import("svelte/store").Writable<Route>;
export declare const routeParams: import("svelte/store").Writable<Record<string, string>>;
export declare function navigate(route: Route, params?: Record<string, string>): void;
//# sourceMappingURL=router.d.ts.map