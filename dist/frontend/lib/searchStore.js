import { writable } from "svelte/store";
export const searchStore = writable({
    query: "",
    typeFilter: "",
    results: [],
    searched: false,
});
//# sourceMappingURL=searchStore.js.map