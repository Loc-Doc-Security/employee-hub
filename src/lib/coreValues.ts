// Loc-Doc core values (from the Wix site's core-values-data.js). Shown two per week on the
// Wednesday Meeting deck, and available for a Core Values page later.
export const CORE_VALUES: { trait: string; value: string; desc: string }[] = [
  { trait: "Defined", value: "Expectations", desc: "Don't be frustrated with unmet expectations when YOU have not clearly set them. Can the customer or teammate execute the expectations without further explanation?" },
  { trait: "Consistent", value: "Communication", desc: "Always communicate clear and important information that will impact our customers and our team." },
  { trait: "Cultivate", value: "Trust", desc: "Start small, have patience and be consistent. Consistency builds trust!" },
  { trait: "Outrageous", value: "Kindness", desc: "Treat team members, customers and your family BETTER than you want to be treated." },
  { trait: "Courageous", value: "Honesty", desc: "Handle the truth with courage early and often. Don't hide things, cover up or keep things from your teammates or customers." },
  { trait: "Refined", value: "Quality", desc: "Factory specifications are met, shortcuts are not taken. Quality over Quantity and customer satisfaction is primary." },
  { trait: "Unexpected", value: "Cleanliness", desc: "Jobsite, workspace, uniforms, tools, products, installations. Everything WE touch, should be left cleaner than when we started." },
  { trait: "Intentional", value: "Execution", desc: "Define what winning looks like and don't give up until it's finished. Prior Planning Prevents Poor Performance." },
];

// Wednesday deck discussion prompt, rotated by meeting week.
export const POSITIVE_PROMPTS = [
  "Share one good thing that happened this week — a win, big or small, personal or work.",
  "What is one thing that went right this week? Doesn't have to be huge — just something worth saying out loud.",
  "What is something positive you want to share from your week?",
  "What is one moment from this week you would want the team to know about?",
];

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h >>> 0;
}

/** Two different core values for a meeting date: the same pair for everyone, stable on reload. */
export function weeklyCoreValues(meetingDate: string) {
  const n = CORE_VALUES.length;
  const h = hash(meetingDate);
  const i = h % n;
  const j = (i + 1 + (Math.floor(h / n) % (n - 1))) % n;
  return [CORE_VALUES[i], CORE_VALUES[j]];
}

export const weeklyPrompt = (meetingDate: string) => POSITIVE_PROMPTS[hash("p" + meetingDate) % POSITIVE_PROMPTS.length];
