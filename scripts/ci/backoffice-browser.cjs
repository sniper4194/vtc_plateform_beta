const assert = require("node:assert/strict");
const { chromium } = require("playwright-core"); // installer hors du dépôt, voir docs/PILOTE.md
const apiOrigin = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:5300";
const webOrigin = process.env.BACKOFFICE_URL ?? "http://127.0.0.1:5301";

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium", args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"] });
  try {
    const page = await browser.newPage();
    let alerts = [], incidents = [], assigned = false, audioRequests = 0;
    const apiErrors = [];
    await page.clock.install();
    await page.addInitScript(() => {
      window.alarmStarted = 0;
      const play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () {
        if (this.src.endsWith("/sounds/alarme.mp3")) {
          return play.call(this).then(() => { window.alarmStarted++; });
        }
        return play.call(this);
      };
    });
    page.on("response", (response) => {
      if (response.url().endsWith("/sounds/alarme.mp3") && response.ok()) audioRequests++;
    });
    const date = new Date().toISOString();
    const ride = { id: "ride-1", ref: 1, status: "DISPATCHING", pickupAt: date, pickupAddress: "CDG", dropoffAddress: "Paris",
      priceCents: 5500, driverNetCents: 4400, commissionCents: 1100, booking: { passengerFirstName: "Ana", passengerLastName: "Test" }, offers: [] };
    await page.route(`${apiOrigin}/**`, (route) => {
      const req = route.request();
      const headers = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type", "access-control-allow-methods": "GET, POST, OPTIONS" };
      if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
      const path = new URL(req.url()).pathname;
      if (path === "/auth/login") return route.fulfill({ headers, json: { token: "browser-test", user: { role: "ADMIN", name: "Test", email: "test@example.test" } } });
      if (path === "/admin/alerts") return route.fulfill({ headers, json: alerts });
      if (path === "/admin/incidents") return route.fulfill({ headers, json: incidents });
      if (path === "/admin/rides") return route.fulfill({ headers, json: [{ ...ride, status: assigned ? "ASSIGNED" : "DISPATCHING" }] });
      if (path === "/admin/drivers") return route.fulfill({ headers, json: [{ id: "driver-1", firstName: "Alice", lastName: "Test" }] });
      if (path === "/admin/rides/ride-1/assign") {
        try { assert.equal(req.postDataJSON().driverId, "driver-1"); } catch (err) { apiErrors.push(err); }
        assigned = true;
        return route.fulfill({ headers, json: { status: "ASSIGNED" } });
      }
      if (path === "/admin/incidents/incident-1/ack") {
        incidents = [];
        return route.fulfill({ headers, json: { status: "ACKNOWLEDGED" } });
      }
      return route.fulfill({ headers, json: [] });
    });
    await page.goto(webOrigin);
    const themeSelector = page.getByRole("combobox", { name: "Thème de la tour de contrôle" });
    const classique = page.locator('.regulator[data-theme="classique"]');
    const original = page.locator('.regulator[data-theme="original"]');

    await page.getByRole("button", { name: /^Classique/ }).click();
    await classique.locator('input[type="email"]').waitFor();
    await page.reload();
    await classique.locator('input[type="email"]').waitFor();
    await themeSelector.selectOption("original");
    await original.locator('input[type="email"]').waitFor();
    await page.locator('input[type="email"]').fill("test@example.test");
    await page.locator('input[type="password"]').fill("test-local");
    await page.locator('form').getByRole("button").click();
    await page.getByRole("button", { name: "Quitter" }).waitFor();
    await themeSelector.selectOption("classique");
    await classique.getByRole("button", { name: "Tableau", exact: true }).waitFor();
    await page.clock.fastForward(9000);
    assert.equal(await page.evaluate(() => window.alarmStarted), 0);

    incidents = [{ id: "incident-1", status: "OPEN", urgent: true, kind: "OTHER", label: "Incident test", createdAt: date, driver: "Alice Test" }];
    await page.clock.fastForward(9000);
    await page.waitForFunction(() => window.alarmStarted === 1);
    await page.clock.fastForward(9000);
    assert.equal(await page.evaluate(() => window.alarmStarted), 1);

    alerts = [{ reason: "NO_DRIVER", rideId: "ride-1", pickupAt: date }, { reason: "FLIGHT_CANCELLED", rideId: "ride-2", pickupAt: date }];
    await page.clock.fastForward(9000);
    await page.waitForFunction(() => window.alarmStarted === 2);
    await page.clock.fastForward(9000);
    assert.equal(await page.evaluate(() => window.alarmStarted), 2);
    assert.ok(audioRequests > 0);

    const assignDriver = page.locator('select').filter({ has: page.locator('option[value="driver-1"]') });
    await assignDriver.selectOption("driver-1");
    await page.getByRole("button", { name: "OK", exact: true }).click();
    await assignDriver.waitFor({ state: "detached" });
    assert.ok(assigned);
    assert.equal(apiErrors.length, 0);

    await page.getByRole("button", { name: /^Alertes/ }).click();
    await page.getByRole("button", { name: /prendre en charge/i }).click();
    assert.equal(incidents.length, 0);
    await page.getByRole("button", { name: "Quitter" }).click();
    await classique.locator('input[type="email"]').waitFor();
    console.log("OK Chromium : choix et conservation du thème, connexion, alarme, attribution et prise en charge.");
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
