import { describe, expect, it } from "vitest";
import {
  REVIEW_SCHEMA,
  canConfirm,
  mergeAnnotations,
  newAnnotation,
  reviewSchema,
  reviewUpdateSchema,
  type Annotation,
} from "./review";

const SESSION = "11111111-1111-4111-8111-111111111111";
const HASH = "a".repeat(64);
const T0 = "2026-10-22T10:00:00.000Z";
const T1 = "2026-10-22T10:05:00.000Z";
const T2 = "2026-10-22T10:10:00.000Z";
const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const annotation = (over: Partial<Annotation> = {}): Annotation => ({
  id: uuid(1),
  mode: "range",
  start_s: 10,
  end_s: 14.5,
  tags: ["wrong_verse"],
  type: "wrong_verse",
  description: "",
  expected_ref: null,
  target_index: null,
  status: "confirmed",
  tester: "Awa",
  created_at: T0,
  updated_at: T0,
  ...over,
});
const review = (annotations: unknown[], schema = REVIEW_SCHEMA) => ({
  schema,
  session_id: SESSION,
  audio_sha256: HASH,
  prediction_sha256: null,
  annotations,
  updated_at: T0,
});

describe("aqr.review/2", () => {
  it("accepte une revue v2 complète", () => {
    const parsed = reviewSchema.parse(review([annotation()]));
    expect(parsed.schema).toBe("aqr.review/2");
    expect(parsed.annotations[0].tags).toEqual(["wrong_verse"]);
  });
  it("accepte une puce inconnue (liste modifiée depuis) mais pas plus de 30", () => {
    expect(
      reviewSchema.safeParse(review([annotation({ tags: ["ancienne_puce"] })]))
        .success,
    ).toBe(true);
    const many = Array.from({ length: 31 }, (_, i) => `tag_${i}`);
    expect(
      reviewSchema.safeParse(review([annotation({ tags: many })])).success,
    ).toBe(false);
  });
  it("refuse une puce dupliquée ou mal formée", () => {
    expect(
      reviewSchema.safeParse(
        review([annotation({ tags: ["wrong_verse", "wrong_verse"] })]),
      ).success,
    ).toBe(false);
    expect(
      reviewSchema.safeParse(review([annotation({ tags: ["Pas Valide!"] })]))
        .success,
    ).toBe(false);
  });
  it("exige un testeur valide (pas d'e-mail)", () => {
    expect(
      reviewSchema.safeParse(review([annotation({ tester: "a@b.fr" })]))
        .success,
    ).toBe(false);
    expect(
      reviewSchema.safeParse(review([annotation({ tester: "A" })])).success,
    ).toBe(false);
  });
  it("refuse une plage inversée ou vide", () => {
    for (const end_s of [10, 9, null])
      expect(
        reviewSchema.safeParse(review([annotation({ end_s })])).success,
      ).toBe(false);
  });
  it("refuse une référence attendue mal formée", () => {
    expect(
      reviewSchema.safeParse(review([annotation({ expected_ref: "2-255" })]))
        .success,
    ).toBe(false);
    expect(
      reviewSchema.safeParse(review([annotation({ expected_ref: "2:255" })]))
        .success,
    ).toBe(true);
  });
  it("exige une puce ou un commentaire pour un signalement confirmé", () => {
    const empty = annotation({ tags: [], description: "   " });
    expect(reviewSchema.safeParse(review([empty])).success).toBe(false);
    expect(
      reviewSchema.safeParse(review([{ ...empty, status: "draft" as const }]))
        .success,
    ).toBe(true);
    expect(
      reviewSchema.safeParse(
        review([{ ...empty, description: "Le lecteur reprend." }]),
      ).success,
    ).toBe(true);
  });
  it("limite le commentaire à 3000 caractères", () => {
    expect(
      reviewSchema.safeParse(
        review([annotation({ description: "x".repeat(3001) })]),
      ).success,
    ).toBe(false);
  });
});

describe("lecture rétro-compatible d'aqr.review/1", () => {
  const v1 = (type: string, over: Record<string, unknown> = {}) => ({
    id: uuid(7),
    mode: "point",
    start_s: 31.2,
    end_s: null,
    type,
    description: "La voix arrive avant l'affichage.",
    expected_ref: null,
    target_index: null,
    status: "confirmed",
    updated_at: T1,
    ...over,
  });
  it("migre vers v2 avec des tags dérivés du type et un testeur « inconnu »", () => {
    const parsed = reviewSchema.parse(
      review([v1("wrong_verse")], "aqr.review/1"),
    );
    const [a] = parsed.annotations;
    expect(parsed.schema).toBe("aqr.review/2");
    expect(a.tags).toEqual(["wrong_verse"]);
    expect(a.tester).toBe("inconnu");
    expect(a.created_at).toBe(T1);
    expect(a.type).toBe("wrong_verse");
  });
  it("dérive une puce pour chacun des 5 types historiques", () => {
    const expected: Record<string, string> = {
      wrong_verse: "wrong_verse",
      missing_verse: "missing_verse",
      repetition: "repetition_missed",
      timing: "display_offset",
      other: "other",
    };
    for (const [type, tag] of Object.entries(expected)) {
      const [a] = reviewSchema.parse(
        review([v1(type)], "aqr.review/1"),
      ).annotations;
      expect(a.tags).toEqual([tag]);
      expect(a.type).toBe(type);
    }
  });
  it("refuse toujours un type historique inconnu", () => {
    expect(
      reviewSchema.safeParse(review([v1("inventé")], "aqr.review/1")).success,
    ).toBe(false);
  });
  it("refuse un schéma inconnu", () => {
    expect(reviewSchema.safeParse(review([], "aqr.review/9")).success).toBe(
      false,
    );
  });
});

describe("newAnnotation", () => {
  it("crée un brouillon vide au nom du testeur", () => {
    const a = newAnnotation({
      id: uuid(3),
      tester: "Awa",
      start: 101.2,
      end: 106.4,
      now: T1,
      targetIndex: 4,
    });
    expect(a).toMatchObject({
      id: uuid(3),
      mode: "range",
      start_s: 101.2,
      end_s: 106.4,
      status: "draft",
      tags: [],
      description: "",
      tester: "Awa",
      created_at: T1,
      updated_at: T1,
      target_index: 4,
      type: "other",
    });
  });
  it("crée un point quand il n'y a pas de fin", () => {
    const a = newAnnotation({
      id: uuid(4),
      tester: "Awa",
      start: 31.2,
      end: null,
      now: T1,
    });
    expect(a.mode).toBe("point");
    expect(a.end_s).toBeNull();
  });
});

describe("canConfirm", () => {
  it("vrai avec une puce, ou avec un commentaire non vide", () => {
    expect(canConfirm({ tags: ["noise"], description: "" })).toBe(true);
    expect(canConfirm({ tags: [], description: " Écho. " })).toBe(true);
  });
  it("faux sans puce ni commentaire", () => {
    expect(canConfirm({ tags: [], description: "  " })).toBe(false);
  });
});

describe("mergeAnnotations (plusieurs testeurs, une seule revue)", () => {
  it("garde les signalements des autres testeurs", () => {
    const awa = annotation({ id: uuid(1), tester: "Awa" });
    const moussa = annotation({ id: uuid(2), tester: "Moussa", start_s: 40 });
    const merged = mergeAnnotations([awa], [moussa], []);
    expect(merged.map((a) => a.id).sort()).toEqual([uuid(1), uuid(2)].sort());
  });
  it("ne ressuscite pas un signalement absent de l'envoi : il reste tel quel", () => {
    const awa = annotation({ id: uuid(1) });
    expect(mergeAnnotations([awa], [], [])).toEqual([awa]);
  });
  it("conflit : le dernier updated_at gagne, par identifiant", () => {
    const old = annotation({ description: "vieux", updated_at: T0 });
    const fresh = annotation({ description: "récent", updated_at: T2 });
    expect(mergeAnnotations([old], [fresh], [])[0].description).toBe("récent");
    expect(mergeAnnotations([fresh], [old], [])[0].description).toBe("récent");
  });
  it("égalité d'horodatage : l'envoi le plus récent l'emporte", () => {
    const a = annotation({ description: "A", updated_at: T1 });
    const b = annotation({ description: "B", updated_at: T1 });
    expect(mergeAnnotations([a], [b], [])[0].description).toBe("B");
  });
  it("le nom du testeur d'origine et la date de création ne se réécrivent pas", () => {
    const original = annotation({ tester: "Moussa", created_at: T0 });
    const edited = annotation({
      tester: "Awa",
      created_at: T2,
      updated_by: "Awa",
      description: "corrigé",
      updated_at: T2,
    });
    const [a] = mergeAnnotations([original], [edited], []);
    expect(a.tester).toBe("Moussa");
    expect(a.created_at).toBe(T0);
    expect(a.updated_by).toBe("Awa");
    expect(a.description).toBe("corrigé");
  });
  it("supprime les identifiants demandés", () => {
    const a = annotation({ id: uuid(1) });
    const b = annotation({ id: uuid(2), start_s: 50 });
    expect(mergeAnnotations([a, b], [], [uuid(1)]).map((x) => x.id)).toEqual([
      uuid(2),
    ]);
  });
  it("une suppression l'emporte sur un envoi du même identifiant", () => {
    const a = annotation({ id: uuid(1) });
    expect(mergeAnnotations([], [a], [uuid(1)])).toEqual([]);
  });
  it("recalcule le type historique d'après le premier tag", () => {
    const a = annotation({ tags: ["start_late"], type: "other" });
    expect(mergeAnnotations([], [a], [])[0].type).toBe("timing");
  });
  it("trie par instant de début", () => {
    const late = annotation({ id: uuid(1), start_s: 90, end_s: 95 });
    const early = annotation({ id: uuid(2), start_s: 5, end_s: 8 });
    expect(mergeAnnotations([late], [early], []).map((a) => a.start_s)).toEqual(
      [5, 90],
    );
  });
});

describe("reviewUpdateSchema (PUT)", () => {
  it("accepte une revue accompagnée des identifiants supprimés", () => {
    const parsed = reviewUpdateSchema.parse({
      ...review([annotation()]),
      deleted_ids: [uuid(9)],
    });
    expect(parsed.deleted_ids).toEqual([uuid(9)]);
  });
  it("vaut une liste vide sans deleted_ids", () => {
    expect(reviewUpdateSchema.parse(review([])).deleted_ids).toEqual([]);
  });
  it("refuse un identifiant supprimé qui n'est pas un UUID", () => {
    expect(
      reviewUpdateSchema.safeParse({
        ...review([]),
        deleted_ids: ["../x"],
      }).success,
    ).toBe(false);
  });
});
