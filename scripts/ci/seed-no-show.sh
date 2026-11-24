#!/bin/sh
# Prépare une mission « sur place » depuis 20 min (prise en charge passée) pour le chauffeur de test : le bouton no-show est actif.
set -eu
PHONE="+33611223355"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<SQL
WITH d AS (SELECT id FROM "Driver" WHERE phone = '$PHONE'),
     v AS (SELECT id FROM "Vehicle" WHERE "driverId" = (SELECT id FROM d) LIMIT 1),
     r AS (SELECT id FROM "Ride" WHERE status = 'DISPATCHING' ORDER BY "createdAt" LIMIT 1)
UPDATE "Ride" SET status = 'ARRIVED', "driverId" = (SELECT id FROM d), "vehicleId" = (SELECT id FROM v), "pickupAt" = now() - interval '30 minutes'
WHERE id = (SELECT id FROM r);
INSERT INTO "RideEvent" (id, "rideId", type, actor, "createdAt")
SELECT gen_random_uuid(), id, 'ride.arrived', 'ci', now() - interval '20 minutes' FROM "Ride" WHERE status = 'ARRIVED';
SELECT id, status, "pickupAt" FROM "Ride" WHERE status = 'ARRIVED';
SQL
