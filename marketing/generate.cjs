// Génère les visuels de la campagne (PNG + PDF) dans le style de CliCab.
// Usage : node marketing/generate.cjs   (Playwright requis ; voir marketing/README.md)
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const SITE = path.resolve(__dirname, "../apps/site");
const out = path.join(__dirname, "visuels");
const font = (n, f) => `@font-face{font-family:${n};src:url("file://${SITE}/fonts/${f}.woff2") format("woff2")}`;
const css = `
${font("Rozha", "rozha-one-latin-400-normal")}${font("Alfa", "alfa-slab-one-latin-400-normal")}${font("Anton", "anton-latin-400-normal")}${font("Kaushan", "kaushan-script-latin-400-normal")}
:root{--sky:#8fd0f5;--cream:#f5eedd;--navy:#0b2a4a;--ink:#14172b;--yel:#f7b30a;--red:#ee2a14}
*{box-sizing:border-box;margin:0}
body{background:var(--sky);color:var(--navy);font-family:Anton,sans-serif;overflow:hidden;position:relative}
.rozha{font-family:Rozha,serif}.alfa{font-family:Alfa,serif}.script{font-family:Kaushan,cursive}
.card{background:var(--cream);border:5px solid var(--ink);border-radius:30px;box-shadow:12px 12px 0 var(--ink);color:var(--ink)}
.sticker{position:absolute;border-radius:50%;border:5px solid var(--ink);display:flex;align-items:center;justify-content:center;text-align:center;font-family:Alfa;line-height:1}
.caps{text-transform:uppercase;letter-spacing:.06em}
.pill{display:inline-block;background:var(--yel);border:4px solid var(--ink);border-radius:999px;padding:10px 26px;color:var(--ink);font-family:Alfa}
.shot{border:5px solid var(--ink);border-radius:34px;box-shadow:12px 12px 0 var(--ink);display:block;background:#fff}
.brand{font-family:Rozha;color:var(--navy);text-shadow:3px 3px 0 var(--cream)}
.red{color:var(--red)}
.foot{position:absolute;left:0;right:0;bottom:0;background:var(--navy);color:var(--cream);display:flex;justify-content:space-between;align-items:center}
`;
const img = (n) => `file://${SITE}/img/${n}`;
const page = (w, h, body) => `<!doctype html><meta charset=utf-8><style>${css}body{width:${w}px;height:${h}px}</style><body>${body}`;

const demo = (s = 20) => `<div class="caps" style="position:absolute;font-size:${s}px;letter-spacing:.08em;color:var(--navy);opacity:.75">Captures de démonstration · données fictives</div>`;

const visuals = {
  // 1. Chauffeurs, carré
  "post-chauffeurs-carre": [1080, 1080, `
    <div class="sticker" style="width:300px;height:300px;right:-70px;top:-70px;background:var(--yel);transform:rotate(12deg)"></div>
    <div class="sticker" style="width:340px;height:340px;left:-110px;bottom:-110px;background:var(--red);transform:rotate(-10deg)"></div>
    <div style="position:absolute;left:70px;top:70px;font-size:40px" class="brand">CliCab</div>
    <div class="script" style="position:absolute;left:70px;top:150px;font-size:56px">chauffeurs VTC</div>
    <div class="rozha" style="position:absolute;left:70px;top:230px;font-size:150px;line-height:.95;text-shadow:6px 6px 0 var(--cream)">Jamais<br>seul.</div>
    <div class="card" style="position:absolute;left:70px;top:600px;width:520px;padding:34px 36px;font-size:36px;line-height:1.35">
      <div>✔ Le prix <b>avant</b> d'accepter</div><div>✔ Des règles claires, publiées</div><div>✔ L'entraide entre chauffeurs</div></div>
    <img class="shot" src="${img("app-cap.jpg")}" style="position:absolute;right:70px;top:300px;width:330px;transform:rotate(4deg)">
    <div class="foot" style="height:110px;padding:0 70px;font-size:34px"><span class="caps">Phase pilote · premiers chauffeurs</span><span class="alfa" style="color:var(--yel)">clicab.fr/chauffeurs</span></div>`],
  // 2. Prix fixe, carré
  "post-prix-fixe-carre": [1080, 1080, `
    <div class="sticker" style="width:330px;height:330px;right:-60px;top:-80px;background:var(--red);transform:rotate(10deg);color:var(--yel);font-size:50px">PRIX<br>FIXE</div>
    <div style="position:absolute;left:70px;top:70px;font-size:40px" class="brand">CliCab</div>
    <div class="rozha" style="position:absolute;left:70px;top:170px;font-size:120px;line-height:1;text-shadow:5px 5px 0 var(--cream)">Le prix,<br>annoncé<br><span class="red">à l'avance.</span></div>
    <div class="card" style="position:absolute;left:70px;top:640px;width:560px;padding:30px 36px;font-size:34px;line-height:1.35">
      <div class="alfa" style="font-size:60px">37,40 €</div><div style="opacity:.8;font-size:28px" class="caps">Exemple de transfert à prix fixe</div>
      <div style="margin-top:12px">Devis, réservation, suivi : par API.</div></div>
    <img class="shot" src="${img("app-radar.jpg")}" style="position:absolute;right:70px;top:380px;width:310px;transform:rotate(-4deg)">
    <div class="foot" style="height:110px;padding:0 70px;font-size:34px"><span class="caps">Agences · plateformes · voyageurs</span><span class="alfa" style="color:var(--yel)">clicab.fr</span></div>`],
  // 3. Voyageur, carré
  "post-voyageur-carre": [1080, 1080, `
    <div class="sticker" style="width:300px;height:300px;left:-170px;top:-170px;background:var(--yel);transform:rotate(-12deg)"></div>
    <div style="position:absolute;right:70px;top:70px;font-size:40px" class="brand">CliCab</div>
    <div class="script" style="position:absolute;left:70px;top:130px;font-size:60px">pour les voyageurs</div>
    <div class="rozha" style="position:absolute;left:70px;top:215px;font-size:112px;line-height:1;text-shadow:5px 5px 0 var(--cream)">Sachez qui vient vous chercher.</div>
    <div class="card" style="position:absolute;left:70px;top:640px;width:940px;padding:30px 40px;display:flex;gap:34px;align-items:center">
      <div style="width:130px;height:130px;border-radius:50%;border:5px solid var(--ink);background:var(--yel);display:flex;align-items:center;justify-content:center;font:60px Alfa">T</div>
      <div style="font-size:34px;line-height:1.4"><div class="alfa" style="font-size:44px">Thomas · Berline</div>
        <div>Plaque <b>AB-123-CD</b> · Vol AF1234 à l'heure</div><div class="caps" style="font-size:26px;opacity:.7">Exemple fictif · lien reçu par SMS ou e-mail</div></div></div>
    <div class="foot" style="height:110px;padding:0 70px;font-size:34px"><span class="caps">Photo, véhicule, plaque, état du vol</span><span class="alfa" style="color:var(--yel)">clicab.fr</span></div>`],
  // 4. Story chauffeurs
  "story-chauffeurs": [1080, 1920, `
    <div class="sticker" style="width:420px;height:420px;right:-120px;top:-100px;background:var(--yel);transform:rotate(12deg)"></div>
    <div class="sticker" style="width:480px;height:480px;left:-290px;bottom:-290px;background:var(--red);transform:rotate(-10deg)"></div>
    <div style="position:absolute;left:80px;top:110px;font-size:56px" class="brand">CliCab</div>
    <div class="script" style="position:absolute;left:80px;top:200px;font-size:72px">chauffeurs & sociétés VTC</div>
    <div class="rozha" style="position:absolute;left:80px;top:310px;font-size:150px;line-height:.95;text-shadow:7px 7px 0 var(--cream)">Rouler<br>sans<br>risque<br>inutile.</div>
    <img class="shot" src="${img("app-cap.jpg")}" style="position:absolute;left:80px;top:930px;width:330px;transform:rotate(-4deg)">
    <div class="card" style="position:absolute;right:80px;top:960px;width:480px;padding:30px 34px;font-size:38px;line-height:1.35">
      <div>Prix visible avant d'accepter</div><div style="margin-top:10px">Barème de pénalités publié</div><div style="margin-top:10px">Un sauveteur si ça tourne mal</div></div>
    <div style="position:absolute;left:80px;right:80px;bottom:90px;text-align:center"><div class="pill" style="font-size:52px">clicab.fr/chauffeurs</div>
      <div class="caps" style="font-size:30px;margin-top:22px;color:var(--navy)">Phase pilote · les premiers chauffeurs comptent</div>
      <div class="caps" style="font-size:22px;margin-top:14px;color:var(--navy);opacity:.8">Captures de démonstration, données fictives</div></div>`],
  // 5. LinkedIn partenaires
  "linkedin-partenaires": [1200, 627, `
    <div class="sticker" style="width:260px;height:260px;right:-60px;top:-70px;background:var(--red);transform:rotate(10deg);color:var(--yel);font-size:40px">PRIX<br>FIXE</div>
    <div style="position:absolute;left:60px;top:50px;font-size:34px" class="brand">CliCab</div>
    <div class="rozha" style="position:absolute;left:60px;top:110px;font-size:82px;line-height:1;text-shadow:4px 4px 0 var(--cream)">Transferts VTC<br>à <span class="red">prix fixe</span>,<br>par API.</div>
    <div class="card" style="position:absolute;left:60px;top:400px;width:700px;padding:20px 28px;font-size:27px;line-height:1.35;box-shadow:8px 8px 0 var(--ink)">
      Devis · réservation · événements signés · suivi du voyageur et du vol</div>
    <div class="foot" style="height:80px;padding:0 60px;font-size:28px"><span class="caps">Phase pilote · nous cherchons nos premiers partenaires</span><span class="alfa" style="color:var(--yel)">clicab.fr/partenaires</span></div>`],
  // 6. Couverture Facebook / LinkedIn page
  "banniere-reseaux": [1640, 624, `
    <div class="sticker" style="width:380px;height:380px;right:-80px;top:-120px;background:var(--yel);transform:rotate(12deg)"></div>
    <div class="sticker" style="width:300px;height:300px;right:260px;bottom:-150px;background:var(--red);transform:rotate(-8deg)"></div>
    <div class="rozha" style="position:absolute;left:80px;top:70px;font-size:130px;text-shadow:5px 5px 0 var(--cream)">CliCab</div>
    <div class="script" style="position:absolute;left:84px;top:230px;font-size:64px">le dernier kilomètre, enfin fiable</div>
    <div class="caps" style="position:absolute;left:84px;top:380px;font-size:40px;line-height:1.5">Prix fixe · Chauffeurs contrôlés · Entraide entre chauffeurs</div>
    <div class="pill" style="position:absolute;left:84px;top:470px;font-size:36px">clicab.fr</div>`],
};

// 7. Flyer A5 (148 × 210 mm) — dimensions en px à 96 dpi : 559 × 794
const flyer = [559, 794, `
  <style>body{font-size:14px}</style>
  <div class="sticker" style="width:200px;height:200px;right:-50px;top:-50px;background:var(--yel);transform:rotate(12deg);border-width:3px"></div>
  <div style="position:absolute;left:34px;top:30px;font-size:24px" class="brand">CliCab</div>
  <div class="script" style="position:absolute;left:34px;top:70px;font-size:30px">chauffeurs & sociétés VTC</div>
  <div class="rozha" style="position:absolute;left:34px;top:120px;font-size:64px;line-height:.98;text-shadow:3px 3px 0 var(--cream)">Rouler avec<br>le moins de<br><span class="red">risque</span> possible.</div>
  <div class="card" style="position:absolute;left:34px;right:34px;top:370px;padding:18px 22px;font-size:17px;line-height:1.5;border-width:3px;box-shadow:6px 6px 0 var(--ink);border-radius:20px">
    <div>✔ Le prix visible <b>avant</b> d'accepter</div><div>✔ Vos revenus nets, sans zone d'ombre</div>
    <div>✔ Un barème de pénalités publié d'avance</div><div>✔ Un bouton en cas de problème</div><div>✔ Les sauveteurs : l'entraide entre chauffeurs</div></div>
  <div style="position:absolute;left:34px;right:34px;top:600px;text-align:center"><div class="pill" style="font-size:25px;border-width:3px">clicab.fr/chauffeurs</div>
    <div class="caps" style="font-size:15px;margin-top:12px;line-height:1.5">Phase pilote : nous cherchons nos premiers chauffeurs et sociétés<br>contact@clicab.fr</div></div>
  <div class="foot" style="height:46px;padding:0 34px;font-size:13px"><span class="caps">Vous restez indépendant</span><span class="caps">Barème provisoire · phase pilote</span></div>`];

// Kit rétro du chauffeur : documents à imprimer (PDF à taille réelle + aperçu PNG). Pas de nom ni de prix : génériques.
// [largeur px, hauteur px, largeur mm, hauteur mm, pages HTML]
const kit = {
  // Pancarte A4 paysage, à plastifier : le nom du voyageur s'écrit au feutre effaçable dans le cadre blanc.
  "kit-pancarte-A4": [1123, 794, "297mm", "210mm", [`
    <div class="sticker" style="width:260px;height:260px;right:-60px;top:-70px;background:var(--yel);transform:rotate(12deg)"></div>
    <div class="sticker" style="width:220px;height:220px;left:-70px;bottom:-80px;background:var(--red);transform:rotate(-10deg)"></div>
    <div style="position:absolute;left:60px;top:34px;font-size:64px" class="brand">CliCab</div>
    <div class="script" style="position:absolute;left:300px;top:58px;font-size:40px">votre chauffeur vous attend</div>
    <div class="card" style="position:absolute;left:60px;right:60px;top:150px;bottom:120px;background:#fff;border-width:6px;display:flex;align-items:flex-end;justify-content:center;padding-bottom:18px">
      <span class="caps" style="font-size:18px;color:#9a9a9a;letter-spacing:.14em">Nom du voyageur · feutre effaçable</span></div>
    <div class="foot" style="height:70px;padding:0 60px;font-size:24px"><span class="caps">Transfert à prix fixe</span><span class="caps">clicab.fr</span></div>`]],
  // Carte de visite 85 × 55 mm, recto puis verso. Le chauffeur écrit son prénom et son numéro (aucune donnée imprimée).
  "kit-carte-visite": [321, 208, "85mm", "55mm", [`
    <style>body{border-radius:0}</style>
    <div class="sticker" style="width:110px;height:110px;right:-28px;top:-30px;background:var(--yel);border-width:3px;transform:rotate(12deg)"></div>
    <div style="position:absolute;left:18px;top:16px;font-size:34px;text-shadow:1.5px 1.5px 0 var(--cream)" class="brand">CliCab</div>
    <div class="script" style="position:absolute;left:18px;top:62px;font-size:20px">chauffeur partenaire</div>
    <div style="position:absolute;left:18px;right:18px;top:110px;font-family:Alfa;font-size:12px;color:var(--ink);line-height:2.1">
      <div style="border-bottom:2px solid var(--ink)">Prénom :</div><div style="border-bottom:2px solid var(--ink)">Tél. :</div></div>
    <div class="foot" style="height:24px;padding:0 18px;font-size:10px"><span class="caps">Transfert VTC à prix fixe</span><span class="caps">clicab.fr</span></div>`, `
    <div style="position:absolute;inset:0;background:var(--navy)"></div>
    <div class="rozha" style="position:absolute;left:18px;top:22px;font-size:30px;color:var(--cream);text-shadow:2px 2px 0 var(--red);line-height:1">Jamais<br>seul.</div>
    <div style="position:absolute;left:18px;right:18px;top:100px;font-family:Anton;font-size:12px;color:var(--cream);line-height:1.45">Prix fixe annoncé avant la course.<br>Suivi du trajet et du vol par lien personnel.</div>
    <div class="pill" style="position:absolute;left:18px;bottom:16px;font-size:13px;border-width:2px;padding:4px 14px">clicab.fr</div>`]],
  // Autocollant rond Ø 80 mm (décoratif : ne remplace pas la signalétique VTC obligatoire).
  "kit-autocollant-rond": [302, 302, "80mm", "80mm", [`
    <style>body{background:transparent}</style>
    <div class="sticker" style="left:6px;top:6px;width:290px;height:290px;background:var(--yel);flex-direction:column;border-width:6px;box-shadow:none">
      <div class="brand" style="font-family:Rozha;font-size:64px;color:var(--navy)">CliCab</div>
      <div class="script" style="font-size:24px;color:var(--red);margin-top:4px">chauffeur partenaire</div>
      <div class="caps" style="font-family:Anton;font-size:14px;margin-top:10px;color:var(--ink)">prix fixe · clicab.fr</div></div>`]],
};

// setContent() charge la page depuis about:blank, où les fichiers locaux (polices, captures) sont refusés : on passe par un fichier.
const tmp = path.join(__dirname, ".tmp");
async function load(p, name, html) {
  fs.mkdirSync(tmp, { recursive: true });
  const f = path.join(tmp, `${name}.html`);
  fs.writeFileSync(f, html);
  await p.goto("file://" + f);
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch();
  for (const [name, [w, h, body]] of Object.entries(visuals)) {
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    await load(p, name, page(w, h, body)); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(300);
    await p.screenshot({ path: path.join(out, `${name}.png`) }); await p.close(); console.log("ok", name);
  }
  const [w, h, body] = flyer;
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 3 });
  await load(p, "flyer", page(w, h, body)); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(300);
  await p.screenshot({ path: path.join(out, "flyer-chauffeurs-A5.png") });
  await p.pdf({ path: path.join(out, "flyer-chauffeurs-A5.pdf"), width: "148mm", height: "210mm", printBackground: true });
  console.log("ok flyer");
  for (const [name, [kw, kh, mmW, mmH, pages]] of Object.entries(kit)) {
    // Une page HTML par face ; le PDF les enchaîne (recto, verso) à la taille réelle d'impression.
    const html = `<!doctype html><meta charset=utf-8><style>${css}@page{size:${mmW} ${mmH};margin:0}body{width:${kw}px;height:auto}.face{position:relative;width:${kw}px;height:${kh}px;overflow:hidden;background:var(--sky);page-break-after:always}</style><body>` + pages.map((x) => `<div class="face">${x}</div>`).join("");
    const kp = await b.newPage({ viewport: { width: kw, height: kh }, deviceScaleFactor: 3 });
    await load(kp, name, html); await kp.evaluate(() => document.fonts.ready); await kp.waitForTimeout(300);
    await kp.screenshot({ path: path.join(out, `${name}.png`), clip: { x: 0, y: 0, width: kw, height: kh } });
    await kp.pdf({ path: path.join(out, `${name}.pdf`), width: mmW, height: mmH, printBackground: true });
    await kp.close(); console.log("ok", name);
  }
  await b.close(); fs.rmSync(tmp, { recursive: true, force: true });
})();
