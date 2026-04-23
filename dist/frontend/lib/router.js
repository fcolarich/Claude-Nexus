import { writable } from "svelte/store";
export const currentRoute = writable("dashboard");
export const routeParams = writable({});
export function navigate(route, params = {}) {
    currentRoute.set(route);
    routeParams.set(params);
}
//# sourceMappingURL=router.js.map