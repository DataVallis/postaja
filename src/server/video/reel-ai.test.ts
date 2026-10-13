import { describe, expect, it } from "vitest";
import { videoBody } from "../images/fal";
import { clipSeconds, reelIssues, reelSchema, sceneGroups, type ReelPlan } from "./reel-ai";

const scene = (s: number, caption = "") => ({ kind: "scene" as const, firstFrame: "A family dinner table, blank paper on it.", motion: "The child slides the paper.", durationS: s, caption });
const screen = (r: number, s = 3) => ({ kind: "screen" as const, reference: r, durationS: s, caption: "" });

describe("reel plan (TASK-058)", () => {
  it("consecutive scenes are one Kling call; a screen splits them", () => {
    const shots: ReelPlan["shots"] = [scene(3), scene(2), screen(1), scene(4)];
    expect(sceneGroups(shots).map((g) => [g.start, g.scenes.length])).toEqual([[0, 2], [3, 1]]);
    expect(clipSeconds([scene(2)])).toBe(3); // Kling takes at least 3 s; cut afterwards
    expect(clipSeconds([scene(6), scene(6), scene(6)])).toBe(15);
  });

  it("2–4 shots; screens only for existing references; at least one scene; about the asked length", () => {
    expect(reelSchema.safeParse({ shots: [scene(3)] }).success).toBe(false);
    expect(reelSchema.safeParse({ shots: [scene(3), screen(5)] }).success).toBe(false);
    expect(reelIssues({ shots: [scene(3), screen(2)] }, 1, 12).join("\n")).toContain("about 12 s");
    expect(reelIssues({ shots: [screen(1), screen(2)] }, 1, 6)).toEqual(["- shot 2: reference R2 does not exist (there are 1)", "- at least one shot must be a scene"]);
    expect(reelIssues({ shots: [scene(5), scene(4), screen(1, 3)] }, 1, 12)).toEqual([]);
  });

  it("Kling 3.0 multi-shot body: one prompt per shot, no audio, no text", () => {
    const body = videoBody("fal-ai/kling-video/v3/standard/image-to-video", { model: "x", prompt: "p", image: "data:image/jpeg;base64,AA", durationS: 5, shots: [{ prompt: "a", durationS: 3 }, { prompt: "b", durationS: 2 }] });
    expect(body).toMatchObject({ multi_prompt: [{ prompt: "a", duration: "3" }, { prompt: "b", duration: "2" }], shot_type: "customize", duration: "5", generate_audio: false, start_image_url: "data:image/jpeg;base64,AA" });
    expect(body).not.toHaveProperty("prompt");
    expect(String(body.negative_prompt)).toContain("text");
    expect(videoBody("fal-ai/kling-video/v3/standard/image-to-video", { model: "x", prompt: "p", image: "i", durationS: 4, shots: [{ prompt: "a", durationS: 4 }] })).toMatchObject({ prompt: "p", duration: "4" });
  });
});
