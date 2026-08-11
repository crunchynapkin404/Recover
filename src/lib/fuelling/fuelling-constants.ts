/**
 * Every number the fuelling model uses, with its source and confidence.
 *
 * Phase 2a swept the repo's 77 *exported* constants and closed on that basis.
 * This directory had none — the values below were inline literals inside
 * `calculate.ts` — so the sweep never reached them, even though the figures
 * are rendered to the athlete (`components/train/fuelling-card.tsx`) and
 * handed to the coach (`get_week_plan`, via `fuellingFromSession`). Naming
 * them is the point: a named constant is greppable, is inside the discipline
 * 2a already enforces, and can be found by the next sweep.
 *
 * **v0.94.0 changed no value.** Each number is exactly what it was when it
 * was a literal; only its provenance is new.
 *
 * ## What this model does and does not know
 *
 * It knows session duration, an intensity band, and body mass. It does not
 * know sweat rate, gut tolerance, heat, altitude, or what the athlete ate
 * yesterday. These are **general guidance, not a personalised prescription**,
 * and the confidence ratings below say so per figure rather than in a
 * blanket disclaimer.
 *
 * ## The structure is sourced, not just the values
 *
 * Worth stating because it is the strongest evidence the model is coherent:
 * post-exercise it uses deliberately sub-optimal carbohydrate factors for
 * short sessions **and** always adds protein. That is precisely the case the
 * literature identifies for carbohydrate–protein co-ingestion — protein
 * enhances glycogen storage specifically when carbohydrate intake is at or
 * below ~0.8 g/kg/h. The shape of the model matches the shape of the
 * evidence.
 *
 * ## References
 *
 * - Jeukendrup A. "A Step Towards Personalized Sports Nutrition: Carbohydrate
 *   Intake During Exercise." Sports Medicine 44 (Suppl 1), 2014.
 *   <https://link.springer.com/article/10.1007/s40279-014-0148-z>
 * - Jeukendrup A. "The new carbohydrate intake recommendations."
 *   <https://pubmed.ncbi.nlm.nih.gov/23765351/>
 * - Alghannam et al. "Restoration of Muscle Glycogen and Functional Capacity:
 *   Role of Post-Exercise Carbohydrate and Protein Co-Ingestion." Nutrients
 *   10(2), 2018. <https://www.mdpi.com/2072-6643/10/2/253>
 */

import type { Range } from "./types";

type DurationBand = "short" | "medium" | "long";

/**
 * Session-length bands, in minutes.
 *
 * Source: the duration boundaries in the carbohydrate literature — the
 * recommendations themselves are stated per duration ("~1 h", "1-2 h",
 * "2-3 h"), so the bands mirror the evidence rather than being chosen
 * independently. 60 and 120 are the natural cut points of that framing.
 * Confidence: Medium.
 * Scope: applies to a single session, not a day's total.
 */
export const DURATION_BAND_MINS = { short: 60, medium: 120 } as const;

/**
 * Session length assumed when the workout carries no duration, in minutes.
 *
 * Source: Invented. It lands the session in the `short` band, which is the
 * conservative choice — the short band recommends the least during-session
 * carbohydrate (0-20 g/h), so an unknown session cannot produce an
 * over-feeding recommendation.
 * Confidence: Low, and deliberately visible: reaching this value also sets
 * `FuellingGuidance.confidence` to `low` and pushes "duration missing;
 * conservative fallback used" into `assumptions`, so the athlete is told
 * rather than handed a number that looks measured.
 */
export const ASSUMED_DURATION_MINS = 60;

/**
 * Carbohydrate to take BEFORE a session, in grams.
 *
 * Source: Invented. Plausible practice, scaled to session length, but no
 * single citation was found for these particular bands — pre-exercise
 * guidance in the literature is usually given as g/kg over a multi-hour
 * window before exercise, which is a different question from "what should I
 * eat before this session". Labelled honestly rather than attached to a
 * citation that does not cover it.
 * Confidence: Low.
 */
export const BEFORE_CARBS_G: Record<DurationBand, Range> = {
  short: { min: 20, max: 30 },
  medium: { min: 30, max: 50 },
  long: { min: 50, max: 70 },
};

/**
 * Carbohydrate DURING a session, grams per hour. The best-sourced figures in
 * this file.
 *
 * Source: Jeukendrup (2014, and the intake-recommendations summary). Under
 * roughly an hour a mouth rinse or small amounts suffice, which is why the
 * short band starts at 0; ~30 g/h is described as probably sufficient for
 * 1-2 h; a single carbohydrate source oxidises at up to ~60 g/h, the
 * recommendation for 2-3 h. Each band here sits on that guidance.
 * Confidence: Medium — the ranges are real recommendations, but they are
 * population guidance and this model cannot account for gut tolerance.
 */
export const DURING_CARBS_G_PER_HOUR: Record<DurationBand, Range> = {
  short: { min: 0, max: 20 },
  medium: { min: 30, max: 45 },
  long: { min: 45, max: 60 },
};

/**
 * Hard ceiling on during-session carbohydrate, grams per hour.
 *
 * Source: Jeukendrup — ~90 g/h is the published upper limit, and reaching it
 * requires *multiple transportable carbohydrates* (a glucose–fructose mix),
 * because a single source saturates its transporter around 60-70 g/h. This
 * is the one number in this file that is not a design choice at all: it is
 * the literature's ceiling, quoted.
 * Confidence: Medium.
 * Scope: a ceiling after the intensity adjustment, never a target. Nothing
 * in the model recommends 90 g/h; the clamp exists so the high-intensity
 * uplift cannot push a recommendation past what is physiologically usable.
 *
 * **Currently UNREACHABLE, and kept deliberately.** The largest value the
 * model can produce is the long band's 60 plus the high-intensity uplift of
 * 15 = 75 g/h, so this clamp never fires. That was found by mutation in
 * v0.94.0 — raising it from 90 to 200 broke no test, because the assertion
 * guarding it (`<= 90`) was satisfied by 75 either way. `calculate.test.ts`
 * now pins the real bound at 75 instead.
 *
 * It stays because it is the physiological limit rather than a design knob:
 * if a future band or uplift is raised, this is what stops the model
 * recommending an intake nobody can absorb. Same reasoning as the latent
 * triathlon-confidence downgrade in `race/demand.ts` (v0.88.0) — a
 * pre-placed guard, documented as latent rather than presented as live.
 */
export const DURING_CARBS_MAX_G_PER_HOUR = 90;

/**
 * Fluid DURING a session, millilitres per hour.
 *
 * Source: Invented. Within the range of common practical advice, but fluid
 * requirement is driven by sweat rate, which varies several-fold between
 * athletes and with heat and humidity — and Recover does not measure it.
 * The literature's actual position is that intake should be individualised
 * to sweat rate, which is guidance this model cannot follow.
 * Confidence: Low. **The weakest figures in this file**, and the ones most
 * worth replacing with a measured input if sweat rate ever becomes
 * available.
 */
export const DURING_FLUID_ML_PER_HOUR: Record<DurationBand, Range> = {
  short: { min: 400, max: 600 },
  medium: { min: 500, max: 700 },
  long: { min: 600, max: 800 },
};

/**
 * Added to both ends of the fluid range for a high-intensity session, in
 * millilitres per hour, and the ceiling that caps the result.
 *
 * Source: Invented. Directionally uncontroversial — higher intensity raises
 * sweat rate — but the magnitude is a design choice, not a measured
 * relationship.
 * Confidence: Low.
 */
export const HIGH_INTENSITY_FLUID_BONUS_ML = 100;
export const DURING_FLUID_MAX_ML_PER_HOUR = 1200;

/**
 * Added to a carbohydrate range for a high-intensity session, in grams, and
 * the ceiling that caps the result.
 *
 * Source: Invented. Higher intensity does raise carbohydrate oxidation rate,
 * so the direction is sound, but +5/+15 is a design choice — and note it
 * *widens* the range as well as raising it, which encodes "less certain at
 * higher intensity" rather than a measured relationship.
 * Confidence: Low.
 * Scope: applied to before- and during-session carbohydrate. The during
 * figure is then clamped by DURING_CARBS_MAX_G_PER_HOUR, so this uplift can
 * never push a recommendation past the physiological ceiling.
 */
export const HIGH_INTENSITY_CARB_BONUS_G = { min: 5, max: 15 } as const;
export const CARB_ADJUST_MAX_G = 300;

/**
 * Carbohydrate AFTER a session, as grams per kilogram of body mass.
 *
 * Source: the post-exercise glycogen-resynthesis literature (Alghannam et
 * al., 2018). Ingesting ≥1.2 g/kg/h maximises muscle glycogen repletion, and
 * ≤0.8 g/kg/h is explicitly identified as sub-optimal for it. The `long`
 * band reaches the cited optimum; `short` and `medium` deliberately sit
 * below it, because a short easy session does not deplete enough glycogen to
 * warrant maximal repletion — and see AFTER_PROTEIN_G_PER_KG, which is what
 * the evidence says to do when carbohydrate is intentionally sub-optimal.
 * Confidence: Medium.
 */
export const AFTER_CARBS_G_PER_KG: Record<DurationBand, Range> = {
  short: { min: 0.6, max: 0.8 },
  medium: { min: 0.8, max: 1.0 },
  long: { min: 1.0, max: 1.2 },
};

/**
 * Fallback for after-session carbohydrate, in grams, when body mass is
 * unknown.
 *
 * Source: Invented — these are AFTER_CARBS_G_PER_KG evaluated against an
 * unstated "typical" athlete, which is exactly the population-norm
 * substitution the project's goal statement rules out ("baselines are the
 * athlete's own, not population norms"). It is retained because the
 * alternative is showing nothing, and `FuellingGuidance.confidence` already
 * drops to `medium` with an explicit assumption naming the missing mass.
 * Confidence: Low.
 * Scope: only reachable when `bodyMassKg` is null.
 */
export const AFTER_CARBS_G_NO_MASS: Record<DurationBand, Range> = {
  short: { min: 30, max: 45 },
  medium: { min: 45, max: 65 },
  long: { min: 60, max: 85 },
};

/**
 * Protein AFTER a session, as grams per kilogram of body mass.
 *
 * Source: the co-ingestion literature (Alghannam et al., 2018), which puts
 * the useful addition at 0.3-0.4 g/kg/h alongside carbohydrate, and finds
 * the benefit concentrated where carbohydrate intake is sub-optimal
 * (≤0.8 g/kg/h). This range sits just at/below that band.
 * Confidence: Medium.
 */
export const AFTER_PROTEIN_G_PER_KG: Range = { min: 0.25, max: 0.35 };

/**
 * Fallback for after-session protein, in grams, when body mass is unknown.
 *
 * Source: Invented, and a population norm for the same reason as
 * AFTER_CARBS_G_NO_MASS. Confidence: Low.
 */
export const AFTER_PROTEIN_G_NO_MASS: Range = { min: 20, max: 35 };
