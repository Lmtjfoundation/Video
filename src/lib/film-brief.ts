import type { FilmProject } from "./writers-room";

/** The brief Movie Studio writes the movie from: the Writers' Room story and cast, scenes in order. */
export function briefFor(f: Pick<FilmProject, "title" | "logline" | "theme" | "world" | "characters" | "scenes">) {
  return `"${f.title}" — ${f.logline}
Theme: ${f.theme}
World: ${f.world.setting}. ${f.world.look}
Cast: ${f.characters.map((c) => `${c.name} (${c.role}; ${c.look})`).join("; ")}
Story, in order:
${f.scenes.map((s) => `${s.number}. ${s.summary}`).join("\n")}`.slice(0, 11_500);
}
