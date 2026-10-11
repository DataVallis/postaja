/** UI theme (TASK-011): dark by default, light on request. Stored in a cookie so the server renders the right one. */
export const THEME_COOKIE = "postaja-theme";
export type Theme = "dark" | "light";
export const resolveTheme = (v: string | undefined): Theme => (v === "light" ? "light" : "dark");
