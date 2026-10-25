/** The 23 languages the engine speaks (Chatterbox Multilingual), for voiceovers and dubbing. Safe in the browser. */
export const SPEECH_LANGUAGES: Record<string, string> = {
  en: "English", es: "Spanish", fr: "French", de: "German", it: "Italian", pt: "Portuguese", nl: "Dutch", pl: "Polish",
  ru: "Russian", tr: "Turkish", ar: "Arabic", he: "Hebrew", hi: "Hindi", ja: "Japanese", ko: "Korean", zh: "Chinese",
  ms: "Malay", sw: "Swahili", el: "Greek", da: "Danish", fi: "Finnish", no: "Norwegian", sv: "Swedish",
};
export const isSpeechLanguage = (code: unknown): code is string => typeof code === "string" && code in SPEECH_LANGUAGES;
