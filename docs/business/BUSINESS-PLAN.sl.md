# Postaja — poslovni načrt

Verzija 1 · 2026-10-08 · Lastnik in prodajalec: David Tacer s.p.
Status: **predlog** — cene, garancija in prvi segment čakajo potrditev lastnika (§15).
Jezik: slovenščina (lastnikov dokument, kot `guides/user/sl`). Tehnični del za razvoj je v angleščini v
`docs/tasks/README.md` (TASK-035…045) in `docs/01-PRODUCT-SPEC.md` §12.
Živa verzija za urejanje in komentarje: Claude Docs dokument »Postaja — poslovni načrt«; ob večjih spremembah se ta datoteka posodobi.

Postajo prodajamo najprej **slovenskim agencijam in freelancerjem, ki vodijo 5–30 brandov**, kot orodje, ki pripravi
mesec objav za vse stranke v enem popoldnevu — v tonu, jeziku in podobi vsake stranke. Cilj: 10 plačljivih strank do
konca leta 2026, 40 do konca marca 2027 (~5.000 € MRR), večina pridobivanja in onboardinga avtomatizirana, lastnik ostane
le na demo klicih in odobritvah.

---

## 1. Stanje izdelka

Izdelek je za prodajo funkcionalno pripravljen (TASK-001…034, dev). Manjka »prodajna lupina«: produkcijsko okolje,
lastna domena, registracija, plačila, pravni dokumenti in dokaz (case study).

| Področje | Stanje | Pomen za prodajo |
| --- | --- | --- |
| Več organizacij, ekipa, limiti paketov, super admin | Narejeno | Osnova za naročnine |
| CGP + baza znanja (PDF, Word, Excel, PPT) + pravila platform | Narejeno | Glavni razlog, da AI ne piše generično |
| Uvoz kateregakoli plana, AI ideje, brez ponavljanja 180 dni | Narejeno | Prihranek časa pri planiranju |
| Množično ustvarjanje (brand ali vsi brandi dneva), cena vnaprej | Narejeno | »Mesec v enem popoldnevu« |
| Slike, karuseli, LinkedIn PDF, vizualna podoba po brandu | Narejeno | Vsaka stranka izgleda drugače |
| Oglasi v vseh dimenzijah + copy.csv, animacije | Narejeno | Upsell za agencije |
| Persona (AI influencer) + video 5/10 s | Narejeno | Premium dodatek |
| Povezava s Claude (MCP), vodič v slovenščini | Narejeno | Hiter onboarding |
| Varnostne kopije produkcije (TASK-030) | Koda narejena, vklopi se s produkcijo | Pogoj za prvo plačljivo stranko |
| Produkcijsko okolje (`postaja.…`, `main`) | Planirano | **Pogoj za prvo plačljivo stranko** |
| Raziskava konkurence (§4.3 speca) | Planirano (lastnikov vrstni red: 2.) | Močan lead magnet |
| Landing, samopostrežna registracija, plačila | Planirano (faza 3) | **Pogoj za prodajo** |
| Neposredno objavljanje / urnik, analitika objav | Ni v načrtu v1 | Največja vrzel proti Predis/Ocoya |
| Odobritev s strani stranke agencije (povezava za pregled) | Ni v načrtu | Agencije to pričakujejo |
| Angleški vodič in UI | Delno (UI SL/EN, vodič samo SL) | Za HR/EU trg |

Priporočilo: prodaja se lahko začne z **ročno vodenimi pilotnimi strankami že pred samopostrežno registracijo**
(organizacijo ustvari super admin v /admin, račun se izstavi ročno). Tako dobimo dokaz in denar, medtem ko se gradi faza 3.

## 2. Komu prodajamo

Prvi segment so **male agencije in freelance social media managerji** (1–10 ljudi, 5–30 brandov strank). Imajo akutno
bolečino (čas izdelave na objavo, vsaka stranka svoj ton in podobo), denar (stranke jim plačujejo 300–1.500 €/mesec na
brand), so lahko najdljivi (AJPES/Bizi, LinkedIn, Google Maps) in trg raste. Postaja jim ne zmanjša prihodka, ampak dvigne
maržo na brand.

| Segment | Bolečina | Plačilna moč | Najdljivost | Vrstni red |
| --- | --- | --- | --- | --- |
| Male agencije / freelancerji (SI) | Zelo velika: 8–30 objav/mesec na stranko, ročno | Visoka | Visoka | **1. — zdaj** |
| Podjetja z enim marketinškim človekom, več brandov/produktov | Velika | Srednja–visoka | Srednja | 2. — po prvih 10 agencijah |
| Solo founderji / kreatorji z več projekti | Srednja | Nizka | Visoka (AI Builders publika) | 3. — samopostrežno, brez prodaje |
| Agencije HR / BiH / RS (šumniki ć, đ že podprti) | Enaka kot SI | Srednja | Srednja | 4. — Q1 2027 |
| DACH / EU agencije | Velika | Visoka | Težja (konkurenca) | Kasneje |

Ne ciljamo velikih agencij s komisijskim odločanjem (dolg prodajni cikel) in ne podjetij z enim brandom (zanje je Postaja
predraga glede na Canvo).

## 3. Ponudba

Ne prodajamo »AI orodja za objave« (to je primerjava s Predis/Canva po ceni). Prodajamo izid:
**agencija prevzame več strank brez novega zaposlovanja.**

**Sanjski izid (v jeziku kupca):** »Mesečni plan objav za vseh mojih 15 strank je pripravljen v enem popoldnevu — v tonu,
jeziku in podobi vsake stranke — in lahko vzamem še 5 strank brez novega človeka.«

**Vrednostna enačba (Hormozi):**

- Sanjski izid ↑: več strank, višja marža, status »agencija, ki dostavi hitro«.
- Verjetnost ↑: case study (4 lastnikovi brandi, čas na dan, % objav brez popravka), brezplačen vzorec za njihovo stranko, garancija.
- Čas do prve zmage ↓: prvi brand v 20 minutah, prvi teden objav isti dan.
- Napor ↓: »done-with-you« onboarding — mi uvozimo CGP, plane in pretekle objave (Claude + MCP).

**Ovire → rešitve (sklad ponudbe, paket Agencija):**

| Ovira kupca | Rešitev v Postaji (ime za kupca) |
| --- | --- |
| »AI piše generično, ne v tonu stranke« | **Brand DNK**: CGP, pravila, primeri, baza znanja po stranki |
| »Slovenščina je slaba, šumniki v grafikah razbiti« | **Slovenščina najprej**: besedilo izriše Postaja, pisave preverjene za čšžćđ |
| »Vse stranke izgledajo enako« | **Lastna podoba vsake stranke**, brez skupnih predlog |
| »Planiranje vzame dneve« | **Uvoz kateregakoli plana** + AI ideje iz vrzeli |
| »Teme se ponavljajo« | **Spomin 180 dni** — nobena tema dvakrat |
| »Izdelava traja« | **Ves dan v enem kliku**: vsi brandi, cena vnaprej, ZIP |
| »Oglasi v 10 dimenzijah« | **Oglasni set**: vse postavitve + copy.csv za uvoz |
| »Reels in video« | **Animacije** + **AI persona** z videom |
| »Strah pred nepredvidenim stroškom AI« | **Limit porabe** in cena na gumbu pred zagonom |
| »Ne vem, kaj dela konkurenca stranke« | **Raziskava konkurence** (po §4.3 speca) |

**Garancija (pogojna, vezana na aktivacijske točke):** »Če v prvih 30 dneh, ko naložiš CGP, vsaj 3 pretekle objave in
plan za eno stranko, manj kot 8 od 10 objav objaviš brez ročnega popravka besedila, ti vrnemo naročnino in brezplačno
uredimo brande namesto tebe.« Prag 80 % je kriterij sprejema MVP (spec §15) — preveri ga na lastnih brandih, preden ga
obljubimo.

**Ime ponudbe (MAGIC):** »**Agencijski pilot: 30 dni objav za 3 stranke**« (avatar + cilj + čas + posoda).
Za landing: »Postaja — mesec objav za vse stranke v enem popoldnevu.«

**Bonusi namesto popustov** (nikoli ne znižujemo osnovne cene): ustanovne stranke (prvih 20) dobijo brezplačen onboarding
vseh brandov (vrednost 149 €/brand), direktno linijo do lastnika in glas pri roadmapu. Omejitev je realna — lastnikov čas.

## 4. Cene in paketi

Trije mesečni paketi, cena po številu brandov (tako agencije računajo svojim strankam), poraba AI v **kreditih**, da
strošek videa ne poje marže. Cene brez DDV.

| Paket | Cena / mesec | Brandi | Člani | Krediti / mesec | Vključeno |
| --- | --- | --- | --- | --- | --- |
| Solo | 39 € | 2 | 1 | 400 | objave, slike, karuseli, LinkedIn PDF, uvoz plana, AI ideje, brez ponavljanja |
| Studio | 99 € | 6 | 3 | 1.500 | + oglasni seti, animacije, raziskava konkurence |
| Agencija | 249 € | 20 | 10 | 5.000 | + 1 persona z videom, onboarding klic, prednostna podpora |
| Partner | od 590 € | po dogovoru | po dogovoru | po dogovoru | + done-for-you onboarding, kasneje white-label |

**Krediti** (1 kredit ≈ 0,05 € prodajne vrednosti; strošek iz `guides/user/sl/09-stroski.md`):

| Dejanje | Krediti | Naš strošek pribl. |
| --- | --- | --- |
| Besedilo objave / oglasni copy | 1 | nekaj centov |
| AI ilustracija (slika, slide) | 2 | 0,04–0,06 € |
| Animacija slike | 1 | nekaj centov |
| Slika s persono / potna slika | 5 | 0,15 € |
| Video s persono 5 s | 25 | do 0,62 € |
| Video s persono 10 s | 40 | do 1,05 € |

- **Dodatni krediti:** 500 za 25 €, 2.000 za 80 € (ne potekajo 12 mesecev).
- **Dodaten brand:** 15 €/mesec; **dodaten član:** 9 €/mesec.
- **Letno plačilo:** 10 × mesečna cena + brezplačen onboarding vseh brandov (bonus, ne popust na osnovo).
- **Brez brezplačnega paketa.** Za agencije: **Agencijski pilot 99 € / 30 dni** (paket Studio, 3 brandi) z garancijo iz §3;
  ob prehodu na letno se 99 € odšteje. Za solo: 7-dnevni preizkus s kartico, 50 kreditov.

**Primerjava s trgom:** Predis.ai Rise 79 $/mesec za 4 brande, Blaze Growth 149 $/mesec, Taplio Pro 199 $/mesec samo za
LinkedIn. Agencija plača za Postajo 249 € za 20 brandov, to je **12,45 € na brand**, medtem ko stranki zaračuna
300–1.500 € na brand. Cena ni ovira; ovira je zaupanje, zato garancija in vzorec.

## 5. Upsell in dodatni prihodki

Upselli sledijo naravni rasti stranke: več brandov → več kreditov → video → storitev. Vsak se ponudi avtomatsko ob
trenutku, ko stranka zadene mejo (§11).

| Upsell | Cena | Sprožilec v aplikaciji | Faza |
| --- | --- | --- | --- |
| Dodatni krediti | 25 € / 80 € | Poraba ≥ 80 % kreditov | Takoj |
| Dodaten brand / član | 15 € / 9 € mesečno | Klik »Nov brand« nad limitom | Takoj |
| Nadgradnja paketa | razlika | 3. dodatni brand = dražje od višjega paketa | Takoj |
| Persona (AI influencer) | 49 €/mesec na persono + krediti | Zavihek Persona v Solo/Studio | Takoj |
| Onboarding brandov »Brand v 48 urah« | 149 €/brand enkratno | Nov brand brez CGP | Takoj (lastnik + Claude) |
| Raziskava konkurence za stranko | 79 €/poročilo ali v Studio+ | Gumb »Najdi konkurente« | Po §4.3 |
| Postaja Done-for-you (lastnik vodi vsebino) | 490–790 €/brand/mesec | Obrazec »Želim, da to naredite vi« | Takoj, max 5 brandov |
| Delavnica »Postaja za agencije« (AI Builders) | 290 €/osebo | Webinar, e-pošta | Q1 2027 |
| Neposredno objavljanje / urnik | +19 €/mesec | Gumb »Objavi« | Ko je zgrajeno |
| White-label (agencija pod svojim imenom) | +149 €/mesec | Partner | Kasneje |

Done-for-you je najdonosnejši in hkrati odvisen od lastnikovega časa: omejitev 5 brandov je resnična, zato je tam pristno
pomanjkanje. Vsak DFY brand je hkrati case study.

## 6. Ekonomika

Tudi če stranka porabi **vse** kredite, ostane bruto marža 35–65 %; pri običajni porabi (~50 % kreditov) 65–80 %.
Predpostavka: najvišji strošek ≈ 0,03 € na kredit (video 10 s = 1,05 € / 40 kreditov = 0,026 €).

| Paket | Cena | Strošek AI pri 100 % kreditov | Plačilni ponudnik (~5 %) | Bruto marža (najslabše) | Bruto marža (50 % porabe) |
| --- | --- | --- | --- | --- | --- |
| Solo | 39 € | 12 € | 2 € | 64 % | 80 % |
| Studio | 99 € | 45 € | 5 € | 50 % | 72 % |
| Agencija | 249 € | 150 € | 12 € | 35 % | 65 % |

- **Fiksni stroški:** produkcijski strežnik Hetzner + Object Storage (nekaj deset €/mesec), domena, e-pošta, plačilni
  ponudnik. Pokrije jih že 1 stranka Studio.
- **Preveri pred objavo cen:** povprečen dejanski strošek besedila objave (nadzorna plošča → stroški). Če je nad 0,025 €,
  besedilo stane 2 kredita.
- **Znižanje stroška:** prompt caching CGP-ja pri Claude API (CGP je enak pri vsaki objavi branda), Batch API za
  množično ustvarjanje ponoreh.
- **Cilj CAC:** ≤ 3 mesečne naročnine (Studio ≤ 300 €, Agencija ≤ 750 €).

## 7. Predstavitev

Pozicija: **»AI vsebinski studio za agencije z veliko brandi — slovenščina najprej.«** Kategorija ene: Predis, Canva in
Blaze so narejeni za en brand v angleščini; Postaja za 20 strank, vsako s svojo DNK, v slovenščini s pravilnimi šumniki.

**Tri sporočila (v tem vrstnem redu):**

1. **Čas:** »Mesec objav za vse stranke v enem popoldnevu.« (dokaz: lastnikov čas na dan za 4 brande, cilj speca < 15 min)
2. **Kakovost:** »Piše kot tvoja stranka, ne kot ChatGPT.« (dokaz: pred/po primerjava generični AI vs Postaja za isto stranko)
3. **Varnost:** »Ceno vsakega klika vidiš vnaprej, limit porabe, garancija 30 dni.«

**Demo (15 minut, vedno na brandu potencialne stranke):**

1. Pred klicem: »Demo iz URL« iz njihove spletne strani ustvari demo brand in 3 objave (§11, TASK-040).
2. Klic: pokaži 3 objave → uvozi njihov Excel plan v živo → »Ustvari ves dan« → ZIP.
3. Oglasni set v vseh dimenzijah (wow trenutek za agencije).
4. Cena + garancija + pilot 99 €. Zapri na klicu ali pošlji povezavo za plačilo isti dan.

**Materiali (Postaja naredi večino sama):** landing stran, 2-minutni video demo, case study »4 brandi, 1 človek«,
primerjalna stran »Postaja vs Predis vs Canva«, PDF ponudba za agencije. Domena: Postaja ne sme ostati na
`postaja.inzenirji.si` — kupimo lastno (npr. getpostaja.com, postaja.app; preveri razpoložljivost).

## 8. Promocija

Največja prednost: **Postaja promovira sama sebe** — vsaka lastnikova objava je dokaz izdelka.

| Kanal | Kaj | Pogostost | Avtomatizacija |
| --- | --- | --- | --- |
| LinkedIn (davitacer) | Building in public: »ta objava je iz Postaje«, številke, pred/po, demo posnetki | 3× tedensko | Postaja ustvari iz plana, lastnik objavi |
| Outbound agencijam | Personaliziran vzorec za njihovo stranko (§9) | 50 agencij/teden | Polavtomatsko |
| Webinar v živo | »Mesec vsebin za 10 strank v enem dopoldnevu« — demo, ponudba pilota | 1× mesečno | Registracija, opomniki, posnetek avtomatsko |
| AI Builders (aibuilders.si, IG) | Postaja kot primer »zgrajeno z vibe codingom« | ob lansiranju + 1× mesečno | Postaja |
| inzenirji.si, cherr.io | Tišji dokaz: »vsebine tega profila pripravlja Postaja« | stalno | Postaja |
| Partnerstva | Slovenska oglaševalska zbornica (SOZ), Društvo za marketing Slovenije (DMS), konference, podkasti | 1–2× na kvartal | Ročno |
| Priporočila (referral) | 20 % provizije 12 mesecev za agencije in freelancerje | stalno | Koda v aplikaciji |
| Plačani oglasi | Meta + LinkedIn, marketing managerji SI; oglase naredi Postaja | ko je konverzija pilota dokazana, 300–500 €/mesec | Postaja (kreative) |
| SEO | Primerjalne strani, »AI za objave v slovenščini«, vodnik | 2 članka/mesec | Claude osnutki |

**Lead magneti** (rešijo ozek problem v celoti in razkrijejo potrebo po Postaji):

- **Vzorec za tvojo stranko:** 3 objave + oglas v vseh dimenzijah za eno stranko agencije, iz njene spletne strani.
- **Revizija profila:** »Kaj dela tvoja konkurenca na Instagramu« — poročilo iz raziskave konkurence.
- **Brezplačna predloga CGP za stranke agencije** (`templates/BRAND-CGP-TEMPLATE.md`).

## 9. Prodaja in kontaktiranje strank

Prvih 20 strank pridobimo **osebno, z vzorcem v roki** — nikoli s splošnim »imamo novo AI orodje«. Proces je večinoma
avtomatiziran (§11), lastnik odobri sporočilo in vodi demo.

**Iskanje strank:**

1. Seznam agencij: AJPES/Bizi (dejavnost oglaševalskih agencij), Google Maps »marketinška agencija« po mestih, LinkedIn
   (»social media manager«, »digitalni marketing«), Clutch/Sortlist, FB skupine freelancerjev.
2. Kvalifikacija: aktivni na IG/LinkedIn, na spletni strani portfelj strank (= več brandov), 1–10 zaposlenih.
3. Za vsako agencijo izberi eno vidno stranko iz portfelja → vzorec 3 objav + oglas za to stranko.

**Zaporedje stikov (14 dni):**

| Dan | Kanal | Vsebina |
| --- | --- | --- |
| 0 | LinkedIn povabilo | Brez prodaje, kratka osebna opomba |
| 1 | E-pošta / LinkedIn | Vzorec za njihovo stranko (slike ali povezava) + eno vprašanje |
| 4 | E-pošta | Kratek video (60 s): kako je vzorec nastal |
| 8 | LinkedIn | Case study »4 brandi, 1 človek« |
| 14 | E-pošta | Zadnje: »Zaprem mesto za pilot ta mesec?« (realno: 5 pilotov/mesec) |

**Prvo sporočilo (predloga):**

> Pozdravljeni [ime], videl sem, da za [stranka] pripravljate objave na Instagramu. Za test sem iz njihove spletne strani
> pripravil 3 objave in oglas v vseh dimenzijah — v prilogi. Narejeno v Postaji, orodju, ki ga razvijam za agencije z več
> strankami. Koliko časa vam danes vzame mesec objav za eno stranko?

**Ugovori in odgovori:**

- »Imamo ChatGPT/Canvo« → »Koliko časa vam vzame, da ChatGPT piše v tonu vsake stranke in Canva izvozi 6 dimenzij? Tu je
  to en klik — poglejte vzorec.«
- »Stranke ne smejo vedeti za AI« → Postaja izvozi navadne datoteke; besedilo je v tonu stranke; vi odobrite vsako objavo.
- »Predrago« → izračun: 12 € na brand proti vaši uri dela; garancija 30 dni.
- »Nimamo časa za uvajanje« → brande uvozimo mi (onboarding je bonus).

**Pravno:** hladna e-pošta pravnim osebam v Sloveniji je omejena (ZEKom-2, GDPR) — preveri s pravnikom. Varnejše:
LinkedIn, splošni naslovi podjetij (info@), vedno jasna odjava, ne kupujemo seznamov.

## 10. Lijak in cilji

Iz outbounda pričakujemo ~5 novih plačljivih strank na mesec pri 200 kontaktih; inbound (LinkedIn, webinar, priporočila)
naj od Q1 2027 doda še toliko. Vse stopnje so predpostavke — popravi jih po prvih 100 kontaktih.

| Stopnja (na mesec) | Število | Prehod |
| --- | --- | --- |
| Kontaktirane agencije | 200 | — |
| Odgovor na vzorec | 30 | 15 % |
| Demo klic | 15 | 50 % |
| Pilot 99 € | 8 | ~50 % |
| Plačljiva naročnina | 5 | ~60 % |

Največji padec je pri prvem odgovoru — zato je personaliziran vzorec za njihovo stranko najpomembnejši del lijaka.

| Mejnik | Plačljive stranke | MRR (povprečno ~125 €/stranko) | Pogoj |
| --- | --- | --- | --- |
| 31. 12. 2026 | 10 (od tega 5 pilotov → plačljivi) | ~1.200 € | produkcija + ročni računi |
| 31. 3. 2027 | 40 | ~5.000 € | samopostrežna registracija + plačila |
| 30. 6. 2027 | 80 + 3–5 DFY brandov | ~12.000 € | HR trg, objavljanje/urnik |

Pravilo (Hormozi): če od 100 kvalificiranih agencij, ki vidijo vzorec in ponudbo, ne kupi vsaj 5, je to **problem
ponudbe**, ne prometa — ne povečuj kontaktov, popravi vzorec, garancijo ali paket.

## 11. Avtomatizacija

Cilj: lastnikov čas za prodajo in podporo **≤ 1 ura na dan + demo klici**. Vse ostalo teče samo; lastnik potrdi samo to,
kar gre ven pod njegovim imenom ali stane denar.

| # | Proces | Sprožilec | Orodja | Kaj teče samo | Kje je lastnik |
| --- | --- | --- | --- | --- | --- |
| 1 | Iskanje agencij | Vsak ponedeljek 7:00 | Claude (načrtovano opravilo), splet, Google Sheet »Prodaja« | 50 novih agencij, brez dvojnikov, kvalificirane, izbrana ena njihova stranka | — |
| 2 | Vzorec za stranko | Nova vrstica v Sheetu | Postaja »Demo iz URL« (TASK-040), MCP | Demo brand iz spletne strani, 3 objave + oglasni set, povezava za ogled | Hiter pregled vzorcev (5 min) |
| 3 | Prvo sporočilo | Vzorec pripravljen | Claude + Gmail (osnutki) | Osebno sporočilo kot osnutek v Gmailu | **Pregleda in pošlje** (10 min/dan) |
| 4 | Follow-up 4/8/14 dni | Ni odgovora | Claude + Gmail | Osnutki follow-upov, odgovori označeni | Pošlje |
| 5 | LinkedIn | Ročno | — | Claude pripravi besedilo povabila | **Ročno** (LinkedIn prepoveduje avtomatizacijo) |
| 6 | Rezervacija dema | Klik na povezavo | Cal.com | Termin, opomnik, brief za klic (agencija, stranke, vzorec) | **Demo klic** |
| 7 | Plačilo in račun | Checkout | Paddle / Lemon Squeezy / Stripe | Naročnina, DDV, račun, opomini ob neuspelem plačilu | — |
| 8 | Odprtje organizacije | Webhook plačila | Postaja (TASK-036) | Organizacija, paket, limiti, povabilo lastniku | — |
| 9 | Onboarding | Dogodki v Postaji | Postaja + Klaviyo (TASK-039) | E-pošte po korakih: brand → CGP → plan → prva objava → prvi prenos | Onboarding klic samo v paketu Agencija |
| 10 | Reševanje aktivacije | Ni prve objave v 48 h | Postaja + Gmail | Osnutek osebnega sporočila | Pošlje |
| 11 | Upsell | 80 % kreditov, limit brandov, persona | Postaja (TASK-038) | Ponudba v aplikaciji + e-pošta, nakup z enim klikom | — |
| 12 | Podpora | Vprašanje | Vodič v aplikaciji + »Vprašaj pomoč« (Claude nad vodičem), Gmail | Odgovor iz vodiča; osnutek odgovora po e-pošti | Odobri odgovore, ki niso v vodiču |
| 13 | Lastni marketing | Plan v Postaji | Postaja (lastnikovi brandi) | Objave za LinkedIn, aibuilders, inzenirji | Objavi (že danes) |
| 14 | Webinar | Mesečno | Landing + Klaviyo | Registracija, 3 opomniki, posnetek, prodajna e-pošta | **Webinar v živo** |
| 15 | Mnenja in case study | Dan 30, aktivna stranka | Klaviyo + Claude | Prošnja za mnenje, osnutek case studyja iz podatkov v Postaji | Odobri objavo |
| 16 | Priporočila | Koda v povezavi | Postaja (TASK-042) / plačilni ponudnik | Sledenje, provizije | Mesečno izplačilo |
| 17 | Tedensko poročilo | Vsak ponedeljek 8:00 | Claude + Postaja /admin + Sheet | MRR, novi piloti, aktivacija, odpovedi, lijak | Prebere (5 min) |

**Pravila avtomatizacije:**

- Nič ne gre ven pod lastnikovim imenom brez njegove potrditve (prva 2 meseca); ko je odstotek popravkov < 10 %,
  follow-upi (4) tečejo samodejno.
- Vsak avtomatski korak piše v Sheet »Prodaja« (status, datum, naslednji korak) — to je CRM, dokler ni preveč vrstic.
- Strošek vzorcev ima lasten limit v Postaji (organizacija »Postaja – prodaja«, 30 USD/mesec, nastavljivo v /admin).

**Že nastavljeno (2026-10-08):** proces #1. Mapa »Postaja — Prodaja« na Google Drive z glavnim Sheetom
»Postaja — Prodaja (glavni CRM)« in tedensko načrtovano opravilo »Postaja — iskanje agencij (ponedeljek)«, ponedeljek
ob 6:49, ki najde do 50 novih agencij brez dvojnikov. Brez Google Sheets povezave opravilo ne more dopisovati v glavni
Sheet, zato vsak teden ustvari nov Sheet »Postaja — Prodaja — teden YYYY-MM-DD« v isti mapi; z vklopljeno Google Sheets
povezavo dopisuje v glavni Sheet.

## 12. Kaj zgraditi v Postaji za prodajo

Tehnične specifikacije so v `docs/tasks/README.md` (TASK-035…045) in `docs/01-PRODUCT-SPEC.md` §12. Vrstni red po
lastnikovem naročilu (2026-10-08): najprej raziskava konkurence, nato prodaja.

| Task | Kaj | Zakaj | Prioriteta |
| --- | --- | --- | --- |
| TASK-030 | Varnostne kopije produkcije | Narejeno, vklopi se s produkcijo | — |
| TASK-035 | Produkcijsko okolje + lastna domena + landing (SL/EN), cenik, primerjave, case study | Predstavitev | P0 |
| TASK-036 | Plačila: naročnine, dodatki, webhook → paket in limiti (TASK-028) | Prihodek | P0 |
| TASK-037 | Samopostrežna registracija + preizkus + kontrolni seznam prvih korakov | Samodejni onboarding | P0 |
| TASK-038 | Krediti namesto čistih € limitov (cenik dejanj, poraba, opozorilo 80 %, nakup) | Paketi iz §4 | P0 |
| TASK-039 | Dogodki za e-pošto (Klaviyo) | Avtomatska e-pošta | P1 |
| TASK-040 | »Demo iz URL« v /admin → javna povezava za ogled (poteče v 14 dneh) | Outbound vzorci | P1 |
| TASK-041 | Povezava za odobritev stranke agencije | Agencije to zahtevajo | P1 |
| TASK-042 | Priporočila + super-admin poročilo MRR/aktivacija/odpovedi | Rast + merjenje | P2 |
| TASK-043 | Neposredno objavljanje/urnik (Meta, LinkedIn) ali prek posredniškega API-ja | Največja vrzel proti konkurenci | P2 |
| TASK-044 | Angleški vodič + izvoz vodiča v PDF | HR/EU trg | P2 |
| TASK-045 | Oznaka »AI-generirano« na objavah s persono | EU AI Act čl. 50, pravila Meta/TikTok | P1 |

Produkcijski strežnik naj bo ločen od asisto in dev strežnika — stranke ne smejo deliti strežnika z dev okoljem.

## 13. Pravno in operativno

Pred prvo plačljivo stranko potrebujemo štiri dokumente in odločitev o plačilnem ponudniku. Točke s »preveri« potrdi
pravnik ali računovodja.

- **Plačilni ponudnik:** priporočilo **Merchant of Record** (Paddle ali Lemon Squeezy, ki ga lastnik že uporablja za AI
  Builders): sam obračuna DDV v vseh državah EU, izda račune, ureja odpovedi; ~5 % + 0,50 na transakcijo. Stripe je
  cenejši, a DDV (OSS, obrnjena obdavčitev za B2B) in račune urejamo sami — preveri pri računovodji tudi davčno
  potrjevanje pri plačilih s kartico.
- **Pogoji uporabe** (naročnina, krediti, garancija, odpoved, omejitev odgovornosti za AI vsebino — stranka odobri vsako objavo).
- **Politika zasebnosti** (GDPR).
- **Pogodba o obdelavi podatkov (DPA)**: agencije nalagajo podatke svojih strank, Postaja je obdelovalec. Podobdelovalci:
  Hetzner (EU), Anthropic, fal.ai, e-pošta, plačilni ponudnik — preveri prenose izven EU in ustrezne klavzule.
- **Licence modelov:** preveri, da vsi fal.ai modeli (slike, Kling, Nano Banana) dovoljujejo komercialno uporabo izhodov.
- **AI oznake:** EU AI Act čl. 50 (preglednost sintetičnih vsebin; preveri aktualni rok) in pravila Meta/TikTok — posebej persona video.
- **Operativa:** produkcija ločena od dev in asisto, varnostne kopije z vajo obnove (TASK-030), status stran, e-pošta
  z lastno domeno (SPF/DKIM), podpora na podpora@<domena>.
- **Prodajalec (lastnik, 9. 10. 2026):** David Tacer s.p., Robindvor 39, 2370 Dravograd; davčna številka 36130800, ID za DDV SI36130800 (zavezanec za DDV), matična številka 6560024000. Plačila prek Stripe (ni MoR): DDV izračuna Stripe Tax (tudi v sandboxu), račune izda Stripe; računovodja potrdi OSS, obrnjeno davčno obveznost in davčno potrjevanje plačil s kartico.

## 14. Načrt za 90 dni

Prvi pilot plača do 15. 11. 2026; 10 plačljivih strank do 31. 12. 2026.

**8.–25. oktober — pripravljen za denar**

- [ ] Produkcijsko okolje (vklopi TASK-030 varnostne kopije), ločen strežnik
- [ ] Lastna domena, e-pošta na domeni
- [ ] Račun pri plačilnem ponudniku (MoR), pogoji, zasebnost, DPA
- [ ] 2 tedna merjenja na lastnih 4 brandih: minute na dan, % objav brez popravka, strošek na objavo → case study
- [ ] Landing v1 (izid, vzorci, cenik, garancija, »Rezerviraj demo«)
- [x] Sheet »Prodaja« + načrtovano opravilo za iskanje agencij (ponedeljki)

**26. oktober–15. november — prvi piloti**

- [ ] Raziskava konkurence (lastnikov vrstni red: 2.)
- [ ] »Demo iz URL« (TASK-040)
- [ ] Outbound 50 agencij/teden, osnutki v Gmailu
- [ ] 5 agencijskih pilotov po 99 € (ročno odprte organizacije)
- [ ] 3 objave tedensko na LinkedInu: building in public

**16. november–31. december — prvih 10**

- [ ] Prvi webinar (sredi novembra), nato mesečno
- [ ] Plačila, krediti, samopostrežna registracija (TASK-036…038)
- [ ] Dogodki za onboarding e-pošte (TASK-039)
- [ ] Piloti → plačljive naročnine; prvi case study zunanje agencije
- [ ] Priporočila 20 %

**Januar 2027 — skaliranje**

- [ ] Odobritev za stranke agencije (TASK-041), angleški vodič (TASK-044)
- [ ] Priprava HR trga (lokalni primeri, hrvaški landing)
- [ ] Plačani oglasi, če pilot → plačilo ≥ 50 %

## 15. Odločitve lastnika (odprte)

- [ ] Prvi segment: agencije (priporočeno) ali solo founderji prek AI Builders?
- [x] Cene iz §4 — potrjene (lastnik, 8. 10. 2026).
- [x] Plačilni ponudnik: **Stripe** (lastnik, 8. 10. 2026). DDV in račune ureja Stripe Tax / Stripe računi; računovodja naj potrdi OSS, obrnjeno davčno obveznost in davčno potrjevanje plačil s kartico.
- [ ] Domena za Postajo.
- [ ] Garancija 80 %: po meritvi na lastnih brandih?
- [ ] Done-for-you: prodajamo storitev (do 5 brandov) ali samo orodje?
- [ ] Neposredno objavljanje (TASK-043) pred ali po HR trgu?
- [ ] Postaja v promociji: odkrito »to objavo je pripravila Postaja« na vseh profilih ali samo na LinkedInu?

## 16. Viri

- Repo DataVallis/postaja, veja dev: `docs/01-PRODUCT-SPEC.md`, `docs/HANDOFF.md`, `docs/tasks/README.md`, `docs/guides/user/sl/09-stroski.md`
- [Predis.ai cene (stanje 27. 8. 2026)](https://admakeai.com/alternatives-to/predis-ai/pricing)
- [Blaze AI cene](https://costbench.com/software/marketing-automation/blaze-ai/)
- [Ocoya cene](https://pricingsaas.com/companies/ocoya)
- [Taplio cene](https://taplio.com/blog/taplio-pricing)
- [Kontentino: cene social media paketov](https://www.kontentino.com/sl/blog/social-media-paketi-za-mala-podjetja-cene/)
- Okvir ponudbe: Alex Hormozi, $100M Offers / $100M Leads (vrednostna enačba, Grand Slam ponudba, garancije, bonusi, MAGIC ime)
