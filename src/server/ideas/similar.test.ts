import { describe, expect, it } from "vitest";
import { REPEAT_BLOCK, REPEAT_WARN, similarity, stems } from "./similar";

const corpus = [
  { id: "a", text: "AGENTS.md file: the cheapest way to give an AI coding agent project context" },
  { id: "b", text: "Pet korakov do prve aplikacije brez programiranja" },
  { id: "c", text: "Why vibe-coded apps break in production: missing tests and secrets in code" },
  { id: "d", text: "Cenik tečaja Vibe Coding 101 in popust za zgodnje prijave" },
];

describe("no-repeat similarity", () => {
  it("stems fold diacritics and inflection", () => {
    expect(stems("Koraki, korakov — Tečaj!")).toEqual(["korak", "korak", "tecaj"]);
  });

  it("the same topic in other words repeats; a related but different angle warns; another topic passes", () => {
    const s = similarity(corpus);
    const same = s.closest("The AGENTS.md file gives your AI coding agent the project context cheaply");
    expect(same).toMatchObject({ id: "a" });
    expect(same!.score).toBeGreaterThanOrEqual(REPEAT_BLOCK);
    const inflected = s.closest("Prva aplikacija brez programiranja v petih korakih");
    expect(inflected).toMatchObject({ id: "b" });
    expect(inflected!.score).toBeGreaterThanOrEqual(REPEAT_WARN);
    const other = s.closest("How to price a freelance design project for a new client");
    expect(other?.score ?? 0).toBeLessThan(REPEAT_WARN);
  });

  it("nothing in common or an empty corpus → no match", () => {
    expect(similarity([]).closest("anything")).toBeNull();
    expect(similarity(corpus).closest("zzz qqq")).toBeNull();
    expect(similarity(corpus).between("Cenik tečaja", "cenik tecaja")).toBeCloseTo(1, 5);
  });
});
