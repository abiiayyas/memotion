export type Lang = "id" | "en";

export interface Suggestion {
  /** Short text on the chip. */
  label: string;
  /** What goes into the prompt box. `[brackets]` mark what the user must replace. */
  text: string;
}

type ByLang = Record<Lang, Suggestion[]>;

const LANDSCAPE: ByLang = {
  en: [
    { label: "Product promo", text: "Make a 30 second promo for [product name]: the problem it solves, how it works in three steps, and a call to action to [visit / download / order]." },
    { label: "Explainer", text: "Explain [topic] in 60 seconds for [audience], one idea per scene, with a short voiceover." },
    { label: "Short lesson", text: "Make a short lesson about [topic]: what you will learn, three key points, and a recap." },
    { label: "Announcement", text: "Make a 15 second announcement for [event or launch] on [date] at [place], big type and one clear call to action." },
    { label: "From my website", text: "Make a 20 second video from my website [https://…]: use its colours and logo and show the main benefit." },
  ],
  id: [
    { label: "Promo produk", text: "Buat video promo 30 detik untuk [nama produk]: masalah yang diselesaikan, cara kerjanya dalam tiga langkah, dan ajakan untuk [kunjungi / unduh / pesan]." },
    { label: "Penjelasan", text: "Jelaskan [topik] dalam 60 detik untuk [target penonton], satu ide per adegan, dengan voiceover singkat." },
    { label: "Pelajaran singkat", text: "Buat pelajaran singkat tentang [topik]: apa yang akan dipelajari, tiga poin penting, dan ringkasan." },
    { label: "Pengumuman", text: "Buat video pengumuman 15 detik untuk [acara atau peluncuran] pada [tanggal] di [tempat], teks besar dan satu ajakan yang jelas." },
    { label: "Dari website saya", text: "Buat video 20 detik dari website saya [https://…]: pakai warna dan logonya, dan tampilkan manfaat utamanya." },
  ],
};

const PORTRAIT: ByLang = {
  en: [
    { label: "Reel with a hook", text: "Make a 20 second Reel about [topic]: a bold hook in the first 2 seconds, one idea, word-by-word captions, and a call to action to [follow / save / visit]." },
    { label: "One tip", text: "Make a 15 second vertical video with one tip: [the tip], large text and captions." },
    { label: "Product ad", text: "Make a 15 second vertical ad for [product] that shows [one benefit] and ends with [call to action]." },
    { label: "News in 10 s", text: "Announce [news] in a 10 second vertical video: one big line, one supporting line, and [date or place]." },
    { label: "From my website", text: "Make a 20 second vertical video from my website [https://…]: use its colours and logo and show the main benefit." },
  ],
  id: [
    { label: "Reel dengan hook", text: "Buat Reel 20 detik tentang [topik]: hook yang kuat di 2 detik pertama, satu ide, caption kata demi kata, dan ajakan untuk [follow / simpan / kunjungi]." },
    { label: "Satu tips", text: "Buat video vertikal 15 detik dengan satu tips: [tipsnya], teks besar dan caption." },
    { label: "Iklan produk", text: "Buat iklan vertikal 15 detik untuk [produk] yang menampilkan [satu manfaat] dan ditutup dengan [ajakan]." },
    { label: "Kabar 10 detik", text: "Umumkan [kabar] dalam video vertikal 10 detik: satu kalimat besar, satu kalimat pendukung, dan [tanggal atau tempat]." },
    { label: "Dari website saya", text: "Buat video vertikal 20 detik dari website saya [https://…]: pakai warna dan logonya, dan tampilkan manfaat utamanya." },
  ],
};

/** Ideas that fit one built-in Structure. Keys are the built-in format ids; a format of the user's own gets the general ones. */
const BY_FORMAT: Record<string, ByLang> = {
  "course-module": {
    en: [
      { label: "Lesson on a topic", text: "Make a 3 minute lesson on [topic] for [audience]: three key points, one simple diagram each, and a recap." },
      { label: "Notes to lesson", text: "Turn these notes into a course module: [paste your notes]" },
      { label: "Course intro", text: "Make a 30 second intro for [course name]: what students will learn and how long it takes." },
    ],
    id: [
      { label: "Pelajaran tentang topik", text: "Buat pelajaran 3 menit tentang [topik] untuk [target siswa]: tiga poin penting, satu diagram sederhana untuk masing-masing, dan ringkasan." },
      { label: "Catatan jadi pelajaran", text: "Ubah catatan ini menjadi modul kursus: [tempel catatan Anda]" },
      { label: "Pengantar kursus", text: "Buat pengantar 30 detik untuk [nama kursus]: apa yang akan dipelajari dan berapa lama durasinya." },
    ],
  },
  "short-hook": {
    en: [
      { label: "Reel with a hook", text: "Make a 20 second Reel with the hook \"[bold claim]\" and one idea: [idea]." },
      { label: "List of tips", text: "Give [number] tips about [topic] as a Reel: one tip every 4 seconds, with captions." },
      { label: "Reel with a call to action", text: "Make a Reel about [topic] that ends with a call to action to [follow / visit]." },
    ],
    id: [
      { label: "Reel dengan hook", text: "Buat Reel 20 detik dengan hook \"[klaim yang berani]\" dan satu ide: [ide]." },
      { label: "Daftar tips", text: "Berikan [jumlah] tips tentang [topik] sebagai Reel: satu tips tiap 4 detik, dengan caption." },
      { label: "Reel dengan ajakan", text: "Buat Reel tentang [topik] yang ditutup dengan ajakan untuk [follow / kunjungi]." },
    ],
  },
  "product-promo": {
    en: [
      { label: "Four-beat promo", text: "Promo for [product name] aimed at [audience]: problem, product, proof ([a number or a short quote]), call to action." },
      { label: "Launch teaser", text: "Make a 20 second launch teaser for [product] coming on [date]." },
      { label: "Before and after", text: "Show the change [product] makes: [the problem] before, [the result] after." },
    ],
    id: [
      { label: "Promo empat bagian", text: "Promo untuk [nama produk] untuk [target pembeli]: masalah, produk, bukti ([angka atau kutipan singkat]), ajakan bertindak." },
      { label: "Teaser peluncuran", text: "Buat teaser peluncuran 20 detik untuk [produk] yang hadir pada [tanggal]." },
      { label: "Sebelum dan sesudah", text: "Tunjukkan perubahan yang dibawa [produk]: [masalahnya] sebelum, [hasilnya] sesudah." },
    ],
  },
};

const SKILL: Record<Lang, Suggestion> = {
  en: { label: "Plan first (skill)", text: "Follow the attached skill and show me its plan before you build anything. Video: [what it is for]." },
  id: { label: "Rencana dulu (skill)", text: "Ikuti skill yang dilampirkan dan tunjukkan rencananya sebelum membuat apa pun. Video: [untuk apa video ini]." },
};

const MEDIA: Record<Lang, (name: string) => Suggestion> = {
  en: (name) => ({ label: "Use my media", text: `Make a 20 second video using @${name}: [what it should say].` }),
  id: (name) => ({ label: "Pakai media saya", text: `Buat video 20 detik memakai @${name}: [apa yang ingin disampaikan].` }),
};

export const MAX_SUGGESTIONS = 6;

/** The language of the ideas: the one chosen for replies in Settings, else the language of the system. */
export function suggestionLang(replyLanguage: "auto" | "id" | "en" | undefined, systemLanguage: string): Lang {
  if (replyLanguage === "id" || replyLanguage === "en") return replyLanguage;
  return systemLanguage.toLowerCase().startsWith("id") ? "id" : "en";
}

export interface SuggestionContext {
  lang: Lang;
  orientation: "landscape" | "portrait";
  formatId: string;
  hasSkill: boolean;
  /** Base name of the first attached media file, if any. */
  firstMedia?: string;
}

/**
 * What to offer under the empty prompt box. Most specific first: what was attached, the chosen Structure, the skill,
 * then the general ideas for the chosen shape. Never more than `MAX_SUGGESTIONS`, never two with the same label.
 */
export function suggestionsFor(ctx: SuggestionContext): Suggestion[] {
  const ordered: Suggestion[] = [
    ...(ctx.firstMedia ? [MEDIA[ctx.lang](ctx.firstMedia)] : []),
    ...(BY_FORMAT[ctx.formatId]?.[ctx.lang] ?? []),
    ...(ctx.hasSkill ? [SKILL[ctx.lang]] : []),
    ...(ctx.orientation === "portrait" ? PORTRAIT : LANDSCAPE)[ctx.lang],
  ];
  const seen = new Set<string>();
  return ordered.filter((s) => !seen.has(s.label) && seen.add(s.label)).slice(0, MAX_SUGGESTIONS);
}

/** The `[bracketed]` parts of a suggestion: what the user still has to write. */
export function placeholders(text: string): string[] {
  return text.match(/\[[^\]\n]+\]/g) ?? [];
}
