// Génère l'icône de l'application chauffeur (choix de l'utilisateur : « Cli cab », pastille crème sur bleu nuit).
// Usage : node marketing/icone-app.cjs   → apps/driver-app/assets/icon.png et adaptive-icon.png (Playwright requis)
const { chromium } = require("playwright");
const path = require("path"), fs = require("fs");
const SITE = path.resolve(__dirname, "../apps/site"), OUT = path.resolve(__dirname, "../apps/driver-app/assets"), TMP = path.join(__dirname, ".tmp-icone");
const font = (n, f) => `@font-face{font-family:${n};src:url("file://${SITE}/fonts/${f}.woff2") format("woff2")}`;
const css = `${font("Alfa","alfa-slab-one-latin-400-normal")}${font("Kaushan","kaushan-script-latin-400-normal")}
*{margin:0;box-sizing:border-box}body{width:1024px;height:1024px;position:relative;overflow:hidden}
.c{position:absolute;border-radius:50%;border:28px solid #14172b}`;
// icon : icône complète ; adaptive-icon : premier plan transparent réduit (Android découpe le centre en rond ou en carré arrondi).
const icons = {
  "icon": `<body style="background:#0b2a4a">
      <div class="c" style="left:172px;top:172px;width:680px;height:680px;background:#f5eedd;box-shadow:26px 26px 0 #ee2a14"></div>
      <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:.9">
        <div style="font-family:Alfa;font-size:330px;color:#ee2a14;text-shadow:12px 12px 0 #14172b">Cli</div>
        <div style="font-family:Kaushan;font-size:190px;color:#0b2a4a;margin-top:-10px">cab</div></div></body>`,
  "adaptive-icon": `<body style="background:transparent"><div style="position:absolute;inset:0;transform:scale(.72)">
      <div class="c" style="left:172px;top:172px;width:680px;height:680px;background:#f5eedd;box-shadow:26px 26px 0 #ee2a14"></div>
      <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:.9">
        <div style="font-family:Alfa;font-size:330px;color:#ee2a14;text-shadow:12px 12px 0 #14172b">Cli</div>
        <div style="font-family:Kaushan;font-size:190px;color:#0b2a4a;margin-top:-10px">cab</div></div></div></body>`,
};
(async () => {
  fs.mkdirSync(TMP, { recursive: true });
  const b = await chromium.launch();
  for (const [name, body] of Object.entries(icons)) {
    const p = await b.newPage({ viewport: { width: 1024, height: 1024 } });
    const f = path.join(TMP, `${name}.html`); fs.writeFileSync(f, `<!doctype html><meta charset=utf-8><style>${css}</style>${body}`);
    await p.goto("file://" + f); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(200);
    await p.screenshot({ path: path.join(OUT, `${name}.png`), omitBackground: name === "adaptive-icon" }); await p.close(); console.log("ok", name);
  }
  await b.close(); fs.rmSync(TMP, { recursive: true, force: true });
})();
