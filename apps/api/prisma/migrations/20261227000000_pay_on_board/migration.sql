-- Paiement à bord par carte (course) et terminal de paiement déclaré par le chauffeur.
ALTER TABLE "Ride" ADD COLUMN "payOnBoard" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Driver" ADD COLUMN "cardTerminal" BOOLEAN NOT NULL DEFAULT false;
