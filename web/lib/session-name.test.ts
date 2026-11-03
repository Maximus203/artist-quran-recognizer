import { describe, expect, it } from "vitest";
import {
  cleanFilename,
  cleanUserName,
  contentLabel,
  defaultSessionName,
  formatStamp,
  normalizeSearch,
} from "./session-name";
import { SURAH_NAMES, surahName } from "./surahs";

const UTC = "UTC";
const created = "2026-10-22T17:51:03.000Z";

describe("nom par défaut", () => {
  it("retire l'extension", () => {
    expect(
      defaultSessionName("Yusuf 12 récitation.mp3", created, "file", UTC),
    ).toBe("Yusuf 12 récitation");
  });

  it("retire l'identifiant de vidéo [xxxxxxxxxxx], les _ et les - répétés", () => {
    expect(
      defaultSessionName(
        "Surah_Yusuf__--_Mishary [dQw4w9WgXcQ].m4a",
        created,
        "file",
        UTC,
      ),
    ).toBe("Surah Yusuf - Mishary");
  });

  it("retire les horodatages de fichier", () => {
    expect(
      defaultSessionName(
        "Cours tajwid 2026-10-20T17-58-52-469.webm",
        created,
        "file",
        UTC,
      ),
    ).toBe("Cours tajwid");
    expect(
      defaultSessionName("khutba_20261020-175852.wav", created, "file", UTC),
    ).toBe("khutba");
  });

  it("garde les tirets internes aux mots", () => {
    expect(cleanFilename("Al-Fatiha - Al-Afasy.mp3")).toBe(
      "Al-Fatiha - Al-Afasy",
    );
  });

  it("enregistrement au micro : nom horodaté, quel que soit le nom de fichier", () => {
    expect(
      defaultSessionName(
        "2026-10-22T17-51-03-120.webm",
        created,
        "microphone",
        UTC,
      ),
    ).toBe("Enregistrement du 22 oct. à 17:51");
  });

  it("repli horodaté quand rien de lisible ne reste", () => {
    for (const name of [
      "2026-10-20T17-58-52-469.webm",
      "[dQw4w9WgXcQ].mp3",
      "123456.wav",
      "___---.mp3",
      "audio 3.mp3",
      "recording.webm",
      "9662e376-3d89-42ff-9035-f532430f7c10.mp3",
      ".mp3",
    ])
      expect(defaultSessionName(name, created, "file", UTC), name).toBe(
        "Audio du 22 oct. à 17:51",
      );
  });

  it("tronque un nom très long", () => {
    const name = defaultSessionName(
      `${"mot ".repeat(100)}.mp3`,
      created,
      "file",
      UTC,
    );
    expect(name.length).toBeLessThanOrEqual(120);
    expect(name.endsWith("…")).toBe(true);
  });

  it("conserve les lettres arabes", () => {
    expect(cleanFilename("سورة يوسف.mp3")).toBe("سورة يوسف");
  });
});

describe("date en français", () => {
  it("formate jour, mois abrégé et heure sur 24 h", () => {
    expect(formatStamp("2026-01-05T08:05:00Z", UTC)).toBe("5 janv. à 08:05");
    expect(formatStamp("2026-12-31T23:59:00Z", UTC)).toBe("31 déc. à 23:59");
    expect(formatStamp("2026-10-22T00:07:00Z", UTC)).toBe("22 oct. à 00:07");
  });
});

describe("nom choisi par l'utilisateur", () => {
  it("replie les espaces et refuse le vide ou l'excès", () => {
    expect(cleanUserName("  Mon   test\n du soir ")).toBe("Mon test du soir");
    expect(cleanUserName("   ")).toBeNull();
    expect(cleanUserName("x".repeat(121))).toBeNull();
    expect(cleanUserName(42)).toBeNull();
    expect(cleanUserName("a\u0000b")).toBe("a b");
  });
});

const verse = (ref: string, t0: number, status = "recognized") => ({
  kind: "verse" as const,
  ref,
  words: null,
  partial: false,
  status: status as "recognized" | "inferred" | "uncertain",
  t: [t0, t0 + 3] as [number, number],
  time_interpolated: false,
  confidence: 0.9,
  candidates: [],
  repetition: false,
});

describe("étiquette de contenu", () => {
  it("une plage continue", () => {
    const intervals = Array.from({ length: 21 }, (_, i) =>
      verse(`12:${11 + i}`, i * 4),
    );
    expect(contentLabel({ intervals })).toBe("Yusuf 12:11–31");
  });

  it("un seul verset", () => {
    expect(contentLabel({ intervals: [verse("112:1", 0)] })).toBe(
      "Al-Ikhlas 112:1",
    );
  });

  it("plusieurs sourates, dans l'ordre d'apparition", () => {
    const intervals = [
      ...Array.from({ length: 7 }, (_, i) => verse(`1:${i + 1}`, i * 4)),
      ...Array.from({ length: 5 }, (_, i) => verse(`2:${i + 1}`, 40 + i * 4)),
    ];
    expect(contentLabel({ intervals })).toBe(
      "Al-Fatiha 1:1–7 + Al-Baqara 2:1–5",
    );
  });

  it("l'ordre est celui du temps, pas celui de la numérotation", () => {
    expect(
      contentLabel({ intervals: [verse("2:1", 0), verse("1:1", 10)] }),
    ).toBe("Al-Baqara 2:1 + Al-Fatiha 1:1");
  });

  it("tronçons séparés, puis plage englobante au-delà de trois", () => {
    expect(
      contentLabel({
        intervals: [verse("12:1", 0), verse("12:2", 4), verse("12:9", 8)],
      }),
    ).toBe("Yusuf 12:1–2, 9");
    expect(
      contentLabel({
        intervals: [1, 3, 5, 7].map((v, i) => verse(`12:${v}`, i * 4)),
      }),
    ).toBe("Yusuf 12:1–7");
  });

  it("limite à trois sourates", () => {
    const intervals = [112, 113, 114, 110, 109].map((s, i) =>
      verse(`${s}:1`, i * 4),
    );
    expect(contentLabel({ intervals })).toBe(
      "Al-Ikhlas 112:1 + Al-Falaq 113:1 + An-Nas 114:1 + 2 autres",
    );
  });

  it("ignore les versets incertains, la basmala et les zones non coraniques", () => {
    const intervals = [
      verse("12:5", 0, "uncertain"),
      {
        kind: "non_quran" as const,
        label: "basmala",
        t: [0, 2] as [number, number],
        basmala: true,
        ref: "1:1" as const,
      },
      verse("12:6", 4, "inferred"),
    ];
    expect(contentLabel({ intervals })).toBe("Yusuf 12:6");
  });

  it("renvoie null sans aucun verset reconnu", () => {
    expect(contentLabel({ intervals: [] })).toBeNull();
    expect(
      contentLabel({ intervals: [verse("12:5", 0, "uncertain")] }),
    ).toBeNull();
  });
});

describe("noms de sourates", () => {
  it("en compte 114, sans doublon ni vide", () => {
    expect(SURAH_NAMES).toHaveLength(114);
    expect(new Set(SURAH_NAMES).size).toBe(114);
    expect(SURAH_NAMES.every((name) => name.trim().length > 1)).toBe(true);
  });
  it("repères", () => {
    expect(surahName(1)).toBe("Al-Fatiha");
    expect(surahName(12)).toBe("Yusuf");
    expect(surahName(36)).toBe("Ya-Sin");
    expect(surahName(114)).toBe("An-Nas");
    expect(surahName(115)).toBe("Sourate 115");
  });
});

describe("clé de recherche", () => {
  it("ignore la casse et les accents", () => {
    expect(normalizeSearch("  Récitation   d'AL-Fātiha ")).toBe(
      "recitation d'al-fatiha",
    );
  });
  it("ignore les signes diacritiques arabes", () => {
    expect(normalizeSearch("يُوسُفَ")).toBe(normalizeSearch("يوسف"));
  });
});
