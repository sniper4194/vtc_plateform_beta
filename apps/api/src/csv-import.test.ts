import { describe, expect, it } from "vitest";
import { guessMapping, parseCategory, parseCsv, parseDateTime, parsePriceCents, toDraft } from "./csv-import";

const now = new Date("2026-11-27T10:00:00Z");

describe("lecture du fichier CSV", () => {
  it("devine le séparateur, gère guillemets, BOM et fins de ligne Windows", () => {
    const { headers, rows, delimiter } = parseCsv('﻿Référence;Adresse de départ;Notes\r\nA1;"12, rue de la Paix";"dit ""bonjour"""\r\n\r\nA2;Orly;\r\n');
    expect(delimiter).toBe(";");
    expect(headers).toEqual(["Référence", "Adresse de départ", "Notes"]);
    expect(rows).toEqual([["A1", "12, rue de la Paix", 'dit "bonjour"'], ["A2", "Orly", ""]]);
    expect(parseCsv("a,b\n1,2").delimiter).toBe(",");
  });

  it("reconnaît les colonnes en français et en anglais", () => {
    const fr = guessMapping(["Référence", "Date", "Heure", "Adresse de départ", "Adresse d'arrivée", "Prénom", "Nom", "Téléphone", "Vol", "Passagers", "Prix"]);
    expect(fr).toMatchObject({ reference: 0, pickupDate: 1, pickupTime: 2, pickupAddress: 3, dropoffAddress: 4, passengerFirstName: 5, passengerLastName: 6, passengerPhone: 7, flightNumber: 8, passengers: 9, price: 10 });
    const en = guessMapping(["Booking ID", "Pickup date time", "Pickup location", "Dropoff location", "Passenger name", "Phone number", "Flight number", "Pax", "Vehicle type", "Price"]);
    expect(en).toMatchObject({ reference: 0, pickupDateTime: 1, pickupAddress: 2, dropoffAddress: 3, passengerName: 4, passengerPhone: 5, flightNumber: 6, passengers: 7, category: 8, price: 9 });
  });

  it("lit les dates à l'heure de Paris (heure d'hiver et d'été)", () => {
    expect(parseDateTime("01/12/2026", "14:30")?.toISOString()).toBe("2026-12-01T13:30:00.000Z");
    expect(parseDateTime("2026-07-15 08h05")?.toISOString()).toBe("2026-07-15T06:05:00.000Z");
    expect(parseDateTime("2026-12-01T14:30:00Z")?.toISOString()).toBe("2026-12-01T14:30:00.000Z");
    expect(parseDateTime("12/01/2026 2:15 PM")?.toISOString()).toBe("2026-01-12T13:15:00.000Z"); // jour/mois à la française
    expect(parseDateTime("demain")).toBeNull();
    expect(parseDateTime("01/12/2026")).toBeNull(); // sans heure : pas de supposition
  });

  it("lit les prix et les catégories", () => {
    expect(parsePriceCents("55,00 €")).toBe(5500);
    expect(parsePriceCents("EUR 1 234.5")).toBe(123450);
    expect(parsePriceCents("1.234,56")).toBe(123456);
    expect(parsePriceCents("gratuit")).toBeNull();
    expect(parseCategory("Minivan")).toBe("VAN");
    expect(parseCategory("Business class")).toBe("BUSINESS");
    expect(parseCategory("Standard sedan")).toBe("BERLINE");
  });

  it("transforme une ligne en brouillon et liste ses problèmes sans rien deviner", () => {
    const { headers, rows } = parseCsv("Booking ID,Pickup date time,Pickup,Dropoff,Passenger,Phone,Flight,Pax,Price\nTZ-1,05/12/2026 09:40,CDG Terminal 2E,10 rue de Rivoli Paris,Camille Durand,+33 6 12 34 56 78,af 1234,2,62.50\nTZ-2,01/01/2020 10:00,,Paris,,12,???,9,abc");
    const m = guessMapping(headers);
    const ok = toDraft(rows[0], m, now);
    expect(ok.errors).toEqual([]);
    expect(ok).toMatchObject({ reference: "TZ-1", pickupAddress: "CDG Terminal 2E", firstName: "Camille", lastName: "Durand", flightNumber: "AF1234", passengers: 2, priceCents: 6250 });
    const bad = toDraft(rows[1], m, now);
    expect(bad.errors).toEqual(expect.arrayContaining(["prise en charge déjà passée", "adresse de départ manquante", "nom du voyageur manquant", "téléphone du voyageur manquant ou invalide", "nombre de passagers hors limites (1 à 8)"]));
    expect(bad.errors.some((e) => e.startsWith("numéro de vol illisible"))).toBe(true);
    expect(bad.errors.some((e) => e.startsWith("prix illisible"))).toBe(true);
  });
});
