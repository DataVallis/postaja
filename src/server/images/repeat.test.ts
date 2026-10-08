import { describe, expect, it } from "vitest";
import { repeatsCaption } from "./repeat";

// The owner's real post (2026-10-08): the image copied the caption's steps.
const caption = `The most expensive words in AI-assisted building: "it doesn't work, fix it".

The AI will fix something. Often not the thing that's broken. Then it fixes the fix.

Engineers debug in a fixed order:
1. Evidence: exact error, exact steps, exact screen.
2. Root cause: "Explain what is happening and why. Don't change anything yet."
3. Smallest fix: "Change only what's needed for this cause."
4. Proof: test the original steps again.

It feels slower. It's much faster.`;

describe("repeatsCaption (TASK-052)", () => {
  it("catches an image that copies the caption", () => {
    expect(repeatsCaption("Debug in a fixed order.\n*Not by guessing.*", caption)).toBe(true); // five words in a row
    expect(repeatsCaption("Evidence: exact error, steps, screen\nRoot cause: explain, change nothing yet\nSmallest fix: only what this cause needs\nProof: repeat the original steps", caption)).toBe(true);
  });

  it("lets a hook that adds to the caption through", () => {
    expect(repeatsCaption("Slower *on purpose*.", caption)).toBe(false);
    expect(repeatsCaption("Stop asking AI to *fix it*. Ask it to *explain*.", caption)).toBe(false);
    expect(repeatsCaption("Debug like an engineer", caption)).toBe(false);
    expect(repeatsCaption("anything", "")).toBe(false);
  });
});
