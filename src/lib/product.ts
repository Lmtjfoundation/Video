/**
 * What Vueio makes: 4K motion graphics (moving shapes, living backgrounds, kinetic type, drawn by Vueio's own
 * motion-graphics engine at 2160×3840 vertical or 3840×2160 widescreen) and cinematic films and series (AI-filmed
 * footage with a recurring cast, character voices and lip sync: the Episode Studio, the Film Engine, Series, the
 * Director, movies and music videos, in Full HD). Building with NEXT_PUBLIC_VUEIO_CINEMATIC=off switches the
 * cinematic tools off again (hidden from the menus, their pages sent to Make and their API routes closed); nothing
 * is deleted either way. Safe in the browser.
 */
export const CINEMATIC = process.env.NEXT_PUBLIC_VUEIO_CINEMATIC !== "off";
export const MOTION_ONLY = !CINEMATIC;

/** Pages of the cinematic tools (and everything under them). */
export const CINEMATIC_PAGES = ["/episodes", "/video-lab", "/story-video", "/writers", "/series", "/movie-maker", "/movies", "/director", "/film-engine", "/stories", "/video-tools"];
/** Their API routes. */
export const CINEMATIC_APIS = ["/api/episodes", "/api/video-lab", "/api/story-video", "/api/series", "/api/movie-maker", "/api/movies", "/api/films", "/api/director", "/api/film-engine", "/api/stories", "/api/video-tools"];

export const isCinematicPath = (path: string) => MOTION_ONLY && [...CINEMATIC_PAGES, ...CINEMATIC_APIS].some((p) => path === p || path.startsWith(p + "/"));

/** Video frame size: motion graphics are drawn in 4K; filmed (cinematic) videos are full HD. */
export const videoSize = (landscape: boolean, motion = MOTION_ONLY): [number, number] => (motion ? (landscape ? [3840, 2160] : [2160, 3840]) : landscape ? [1920, 1080] : [1080, 1920]);

export const MOTION_ONLY_MESSAGE = "Vueio makes motion graphics in 4K. Cinematic AI footage, movies and series aren't available.";
