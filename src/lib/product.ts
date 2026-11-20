/**
 * What Vueio makes. It makes motion graphics only, in 4K: every video is drawn by Vueio's own motion-graphics engine
 * (moving shapes, living backgrounds, kinetic type) at 2160×3840 vertical or 3840×2160 widescreen. The cinematic tools
 * (AI-filmed footage, movies, series, the Director, the Film Engine, Smart Shot, music videos and AI video edits) are
 * switched off: hidden from the menus, their pages sent to Make and their API routes closed. Nothing is deleted;
 * building with NEXT_PUBLIC_VUEIO_CINEMATIC=on brings them back. Safe in the browser.
 */
export const CINEMATIC = process.env.NEXT_PUBLIC_VUEIO_CINEMATIC === "on";
export const MOTION_ONLY = !CINEMATIC;

/** Pages of the cinematic tools (and everything under them). */
export const CINEMATIC_PAGES = ["/video-lab", "/story-video", "/writers", "/series", "/movie-maker", "/movies", "/director", "/film-engine", "/stories", "/video-tools"];
/** Their API routes. */
export const CINEMATIC_APIS = ["/api/video-lab", "/api/story-video", "/api/series", "/api/movie-maker", "/api/movies", "/api/films", "/api/director", "/api/film-engine", "/api/stories", "/api/video-tools"];

export const isCinematicPath = (path: string) => MOTION_ONLY && [...CINEMATIC_PAGES, ...CINEMATIC_APIS].some((p) => path === p || path.startsWith(p + "/"));

/** Video frame size: 4K in motion-graphics-only mode, else full HD. */
export const videoSize = (landscape: boolean): [number, number] => (MOTION_ONLY ? (landscape ? [3840, 2160] : [2160, 3840]) : landscape ? [1920, 1080] : [1080, 1920]);

export const MOTION_ONLY_MESSAGE = "Vueio makes motion graphics in 4K. Cinematic AI footage, movies and series aren't available.";
