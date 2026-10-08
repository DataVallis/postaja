// AI disclosure (TASK-045, EU AI Act Art. 50(4): realistic AI-generated people must be disclosed; Meta, TikTok and
// YouTube ask for their AI label). Images that show a persona carry the IPTC "digital source type" in XMP — Meta reads
// it for its "AI info" label — and exports add a line to the caption; persona videos carry a comment.
import sharp from "sharp";

export const IPTC_COMPOSITE_AI = "http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia";
export const AI_PERSON_NOTE = "Contains an AI-generated person (synthetic, made with Postaja).";

const xmp = () => `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/" xmlns:dc="http://purl.org/dc/elements/1.1/">
   <Iptc4xmpExt:DigitalSourceType>${IPTC_COMPOSITE_AI}</Iptc4xmpExt:DigitalSourceType>
   <dc:description><rdf:Alt><rdf:li xml:lang="x-default">${AI_PERSON_NOTE}</rdf:li></rdf:Alt></dc:description>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;

/** The PNG with the AI disclosure in its metadata (pixels unchanged). */
export async function markAiPng(png: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await sharp(png).withXmp(xmp()).png({ compressionLevel: 6 }).toBuffer());
}

/** The caption line an export adds for a post that shows an AI person, in the post's language. */
export function aiDisclosure(language: string): string {
  return language === "sl" ? "Oseba na sliki ali videu je ustvarjena z umetno inteligenco." : "The person shown is AI-generated.";
}

/** ffmpeg arguments that tag a video as showing an AI person. */
export const AI_VIDEO_METADATA = ["-metadata", `comment=${AI_PERSON_NOTE}`, "-metadata", `description=${AI_PERSON_NOTE}`];
