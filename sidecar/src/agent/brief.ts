import { brandBrief, getBrandKit } from "../brand/store.js";
import { picksBrief } from "../catalog/store.js";
import { getFormat } from "../formats/store.js";
import { getSkill } from "../skills/store.js";
import { getPreferences } from "../preferences.js";
import type { ProjectMeta } from "../projects/store.js";
import type { Brief } from "./prompt.js";

/** Read the project's chosen brand kit, format and picks. A kit, format or pick that was deleted since is simply not applied. */
export async function buildBrief(meta: ProjectMeta): Promise<Brief> {
  const kit = meta.brandKitId ? await getBrandKit(meta.brandKitId) : null;
  const brand = kit
    ? brandBrief(kit, {
        logoPath: kit.logo ? `assets/brand/${kit.logo}` : undefined,
        fontFiles: kit.customFonts.map((f) => ({ family: f.family, path: `assets/fonts/${f.file}` })),
      })
    : undefined;
  const format = meta.formatId ? await getFormat(meta.formatId) : null;
  // A skill that was removed since is simply not applied, like a format or kit.
  const skill = meta.skillId ? await getSkill(meta.skillId) : null;
  const language = getPreferences().replyLanguage;
  return { brand, format, picks: await picksBrief(meta.picks), skill, replyLanguage: language === "auto" ? undefined : language };
}
