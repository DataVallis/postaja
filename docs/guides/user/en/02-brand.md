# Brand

A brand is a project in Postaja. Each brand has its own CGP, channels, files, visual identity, posts, ads and, optionally, a persona. You find brands in the **Brands** menu.

## New brand

1. **Brands → New brand** (owner only).
2. Enter the name, short name (slug), website and post languages.
3. Click **Create**.
4. The **Brand setup** wizard opens and guides you step by step.

## Brand setup (wizard)

The results are only as good as what you put in. At each step the wizard says why it matters and what belongs in it:

1. **Communication (CGP)** – required, at least 400 characters: who you are, the offer, the audience, the tone, words you use and avoid.
2. **Logo and past posts** – the logo is required for images; at least 3 past posts are the style references; a font is optional.
3. **Materials** – price list, products, FAQ (recommended).
4. **Topics and rules** – content pillars, calls to action, banned words (recommended).
5. **Colours and image style** – brand colours, illustration style and what pictures must not show (recommended).
6. **Channels** – at least one channel is required.
7. **Visual identity** – Claude prepares the image templates (required for images).
8. **Summary** – what is done, what is missing, and the next steps.

On the left the steps are marked: a green tick means done, a red exclamation mark required and missing, an empty circle recommended. Every step is saved into the brand (CGP and rules as a new profile version), so you can stop any time and continue with **Setup** on the brand page. Until everything is done, the brand page shows how ready the brand is and what is missing.

## Profile (CGP)

The **Profile (CGP)** tab holds the instructions Postaja follows when writing all of the brand's posts.

- **CGP — instructions for the AI**: who you are, your audience, tone, what you do and what you don't. Paste it or click **Import from a document** (Word, PDF, MD or TXT). The text is copied verbatim, without AI.
- **Content pillars**: one line per pillar, in the form `Name | share % | description`, at most 100 % in total.
- **Banned words** and **CTA phrases**: Postaja follows and checks them.
- **Max characters**, **Max hashtags**, **Max emoji**, **Links in caption** and **Post must end with a CTA**: brand rules that apply on top of the platform rules.
- **Colours**, **Image style** and **Never in images**.

Every save creates a **new version**. You see older versions in the **Versions** tab; each post remembers the version it was created from.


## Channels

In the **Channels** tab you add the profiles you post to:
- platform (Instagram, Facebook, LinkedIn, X, TikTok, YouTube) and profile (@name);
- language, number of posts per day and posting days (these become the daily goals on the dashboard);
- default image format and allowed post types;
- its own hashtag limit.

Under each channel you see the rules that **apply** to it (platform + channel + brand).

## Files

Drag individual files or a whole ZIP into the **Files** tab. Postaja sorts them itself:
- **Logos** (images with “logo” in the name, or the **Add logo** button): used on images.
- **Fonts** (TTF, OTF, WOFF, WOFF2): must include č, š, ž, ć and đ.
- **Partner logos**: partners' logos for joint posts (e.g. Polygon). Drop them into the **Drop partner logos here** area (several at once or in a ZIP). The partner's name is the file name (“Polygon-logo.png” → Polygon); you correct it in the field under the logo and confirm with the tick next to it. This is not the brand's logo: on each post or ad you choose whether it goes on the images. If a template writes the partner's name on the image (e.g. a footer “CHERR.IO | Polygon”), Postaja draws the partner's logo in place of the name; otherwise it draws it next to the brand logo.
- **Sources**: documents (PDF, Word, Excel, PowerPoint, CSV, TXT) and images of past posts. Document text is the knowledge base: for every post Postaja takes the parts that match the request. Images of past posts are used for style.

The owner uploads and deletes; all members can download files.

## AI model

At the bottom of the **Profile (CGP)** tab the owner picks the Claude model that writes texts and designs images for the brand. Each model shows its price per million tokens.

## Archiving

The **Archive** button (top right) takes the brand out of active work. An archived brand cannot be edited.
