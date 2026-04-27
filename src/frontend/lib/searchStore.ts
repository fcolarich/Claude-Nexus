import { writable } from "svelte/store";
import type { SearchResult } from "./api";

interface SearchState {
  query: string;
  typeFilter: string;
  results: SearchResult[];
  searched: boolean;
}

export const searchStore = writable<SearchState>({
  query: "",
  typeFilter: "",
  results: [],
  searched: false,
});
