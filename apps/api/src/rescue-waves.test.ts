import { describe, expect, it } from "vitest";
import { currentWave, openTo, planWaveSeconds, waveOf } from "./rescue";

const t0 = new Date("2026-11-23T12:00:00Z");
const at = (s: number) => new Date(t0.getTime() + s * 1000);
const r = (queue: string[], waveSize = 1, waveSeconds = 45) => ({ queue, waveSize, waveSeconds, createdAt: t0 });

describe("diffusion par vagues (du plus proche au plus éloigné)", () => {
  it("le premier de la file voit l'appel tout de suite, les suivants chacun à son tour", () => {
    const q = r(["a", "b", "c"]);
    expect(openTo(q, "a", at(0))).toBe(true);
    expect(openTo(q, "b", at(44))).toBe(false);
    expect(openTo(q, "b", at(45))).toBe(true);
    expect(openTo(q, "c", at(89))).toBe(false);
    expect(openTo(q, "c", at(90))).toBe(true);
  });
  it("plusieurs sauveteurs par vague", () => {
    const q = r(["a", "b", "c", "d", "e"], 2, 30);
    expect([waveOf(q, "a"), waveOf(q, "b"), waveOf(q, "c"), waveOf(q, "e")]).toEqual([0, 0, 1, 2]);
    expect(openTo(q, "b", at(0))).toBe(true);
    expect(openTo(q, "c", at(29))).toBe(false);
    expect(openTo(q, "c", at(30))).toBe(true);
    expect(openTo(q, "e", at(60))).toBe(true);
  });
  it("un sauveteur absent de la file ne reçoit jamais l'appel ; sans file ou sans vagues, tout le monde le reçoit (appels anciens, réglage à 0)", () => {
    expect(openTo(r(["a", "b"]), "x", at(10_000))).toBe(false);
    expect(openTo(r([]), "x", at(0))).toBe(true);
    expect(openTo(r(["a", "b"], 1, 0), "b", at(0))).toBe(true);
  });
  it("vague courante : plafonnée à la dernière vague", () => {
    const q = r(["a", "b", "c"]);
    expect([0, 44, 45, 90, 5000].map((s) => currentWave(q, at(s)))).toEqual([0, 0, 1, 2, 2]);
    expect(currentWave(r(["a"], 1, 0), at(100))).toBe(0);
  });
  it("délai entre vagues : le dernier garde 40 % de la durée de l'appel, jamais moins de 5 s, 0 s s'il n'y a qu'une vague ou si désactivé", () => {
    expect(planWaveSeconds(1, 1800, 1, 45)).toBe(0); // un seul candidat
    expect(planWaveSeconds(3, 1800, 1, 45)).toBe(45); // large : le délai demandé
    expect(planWaveSeconds(10, 600, 1, 45)).toBe(40); // 10 vagues sur 10 min : resserré (360 s / 9)
    expect(planWaveSeconds(10, 60, 1, 45)).toBe(5); // plancher
    expect(planWaveSeconds(10, 600, 1, 0)).toBe(0); // désactivé
    expect(planWaveSeconds(6, 600, 3, 45)).toBe(45); // 2 vagues de 3
  });
});
