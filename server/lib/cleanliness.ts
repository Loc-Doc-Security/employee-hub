// Cleanliness audit questions and scoring, unchanged from the Wix version. The server computes the
// score from the answers and attached photos; it never trusts a score sent by the browser.
//
// Score per section = (questions answered yes + photos attached) / (questions + photo slots).
// Overall = the same ratio across every active section. A section is active when the employee has
// a vehicle number (vehicle) or has_office (office).

export const SECTIONS = {
  vehicle: {
    title: "{Noun}",
    checklist: [
      { key: "organized", label: "{Noun} Organized?" },
      { key: "floor", label: "Floor Clean?" },
      { key: "shelves", label: "Shelves / Key Machine Clean?" },
      { key: "cab", label: "Cab Area Clean?" },
      { key: "outside", label: "Outside of {Noun} Clean?" },
      { key: "tires", label: "Tires Inflated?" },
    ],
    photos: [
      { key: "cab", label: "Picture (Cab Area)" },
      { key: "cargo", label: "Picture (Cargo Area)" },
      { key: "outside", label: "Picture (Outside of {Noun})" },
    ],
  },
  office: {
    title: "Office",
    checklist: [
      { key: "organized", label: "Desk / Shelves / Tables Organized?" },
      { key: "floor", label: "Floor Clean / Swept?" },
      { key: "bathroom", label: "Nearest Bathroom Clean?" },
    ],
    photos: [{ key: "office", label: "Picture of Office Space" }],
  },
} as const;

export type SectionKey = keyof typeof SECTIONS;
export const SECTION_ORDER: SectionKey[] = ["vehicle", "office"];

export type Answers = Partial<Record<SectionKey, Record<string, boolean>>>;
export type Photos = Record<string, string>; // "vehicle.cab" → upload id

export function scoreAudit(active: Record<SectionKey, boolean>, answers: Answers, photos: Photos) {
  let pass = 0, total = 0, num = 0, den = 0;
  const sectionScores: Partial<Record<SectionKey, number>> = {};
  const cleanAnswers: Answers = {};
  const cleanPhotos: Photos = {};
  for (const s of SECTION_ORDER) {
    if (!active[s]) continue;
    const cfg = SECTIONS[s];
    cleanAnswers[s] = {};
    let sPass = 0, sPhotos = 0;
    for (const item of cfg.checklist) {
      const yes = answers[s]?.[item.key] === true;
      cleanAnswers[s]![item.key] = yes;
      total++;
      if (yes) { pass++; sPass++; }
    }
    for (const p of cfg.photos) {
      const id = photos[`${s}.${p.key}`];
      if (id) { cleanPhotos[`${s}.${p.key}`] = id; sPhotos++; }
    }
    const sDen = cfg.checklist.length + cfg.photos.length;
    sectionScores[s] = Math.round(((sPass + sPhotos) / sDen) * 100);
    num += sPass + sPhotos;
    den += sDen;
  }
  return {
    answers: cleanAnswers,
    photos: cleanPhotos,
    passCount: pass,
    totalCount: total,
    score: den ? Math.round((num / den) * 100) : 0,
    vehicleScore: sectionScores.vehicle ?? null,
    officeScore: sectionScores.office ?? null,
  };
}
