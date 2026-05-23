import { writable } from "svelte/store";

/** Count of memories awaiting review — drives the Sidebar badge. */
export const pendingReviewCount = writable<number>(0);
