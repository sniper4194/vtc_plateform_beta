-- CreateEnum
CREATE TYPE "VehicleCategory" AS ENUM ('BERLINE', 'BUSINESS', 'VAN', 'GREEN');

-- CreateEnum
CREATE TYPE "RideStatus" AS ENUM ('CREATED', 'QUOTED', 'CONFIRMED', 'DISPATCHING', 'ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED_BY_CLIENT', 'CANCELLED_BY_PARTNER', 'NO_SHOW', 'DISPUTED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "DriverStatus" AS ENUM ('PENDING_DOCUMENTS', 'PENDING_REVIEW', 'ACTIVE', 'SUSPENDED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DriverAvailability" AS ENUM ('AVAILABLE', 'SUSPENDED', 'BUSY');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('VTC_CARD', 'DRIVING_LICENSE', 'KBIS', 'INSURANCE', 'REGISTRATION_CERT', 'TECHNICAL_INSPECTION', 'ID');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'PAID', 'FAILED');

-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('PREPAID', 'INVOICE');

-- CreateTable
CREATE TABLE "Partner" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "paymentMode" "PaymentMode" NOT NULL DEFAULT 'INVOICE',
    "priceMultiplier" DECIMAL(5,4) NOT NULL DEFAULT 1,
    "commissionRate" DECIMAL(5,4) NOT NULL DEFAULT 0.2,
    "webhookUrl" TEXT,
    "webhookSecret" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Partner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "sandbox" BOOLEAN NOT NULL DEFAULT true,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "siret" TEXT,
    "vtcRegistry" TEXT,
    "iban" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Driver" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'fr',
    "status" "DriverStatus" NOT NULL DEFAULT 'PENDING_DOCUMENTS',
    "availability" "DriverAvailability" NOT NULL DEFAULT 'SUSPENDED',
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 5,
    "reliability" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "contractSignedAt" TIMESTAMP(3),
    "stripeAccountId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Driver_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "driverId" TEXT,
    "plate" TEXT NOT NULL,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "color" TEXT,
    "category" "VehicleCategory" NOT NULL,
    "seats" INTEGER NOT NULL DEFAULT 4,
    "electric" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "type" "DocumentType" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Booking" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT,
    "externalReference" TEXT,
    "idempotencyKey" TEXT,
    "passengerFirstName" TEXT NOT NULL,
    "passengerLastName" TEXT NOT NULL,
    "passengerPhone" TEXT NOT NULL,
    "passengerEmail" TEXT,
    "passengerLanguage" TEXT NOT NULL DEFAULT 'fr',
    "flightNumber" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ride" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "status" "RideStatus" NOT NULL DEFAULT 'CREATED',
    "category" "VehicleCategory" NOT NULL,
    "pickupAddress" TEXT NOT NULL,
    "pickupLat" DOUBLE PRECISION NOT NULL,
    "pickupLng" DOUBLE PRECISION NOT NULL,
    "dropoffAddress" TEXT NOT NULL,
    "dropoffLat" DOUBLE PRECISION NOT NULL,
    "dropoffLng" DOUBLE PRECISION NOT NULL,
    "pickupAt" TIMESTAMP(3) NOT NULL,
    "distanceKm" DOUBLE PRECISION NOT NULL,
    "durationMin" DOUBLE PRECISION NOT NULL,
    "passengers" INTEGER NOT NULL DEFAULT 1,
    "luggage" INTEGER NOT NULL DEFAULT 0,
    "priceCents" INTEGER NOT NULL,
    "commissionCents" INTEGER NOT NULL,
    "driverNetCents" INTEGER NOT NULL,
    "flatRateId" TEXT,
    "driverId" TEXT,
    "vehicleId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Ride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RideEvent" (
    "id" TEXT NOT NULL,
    "rideId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB,
    "actor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RideEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DispatchOffer" (
    "id" TEXT NOT NULL,
    "rideId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "status" "OfferStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DispatchOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rating" (
    "id" TEXT NOT NULL,
    "rideId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "comment" TEXT,

    CONSTRAINT "Rating_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payout" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingRuleSet" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PricingRuleSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlatRate" (
    "id" TEXT NOT NULL,
    "fromZone" TEXT NOT NULL,
    "toZone" TEXT NOT NULL,
    "bidirectional" BOOLEAN NOT NULL DEFAULT true,
    "prices" JSONB NOT NULL,

    CONSTRAINT "FlatRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE UNIQUE INDEX "Company_siret_key" ON "Company"("siret");

-- CreateIndex
CREATE UNIQUE INDEX "Driver_phone_key" ON "Driver"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "Driver_email_key" ON "Driver"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_plate_key" ON "Vehicle"("plate");

-- CreateIndex
CREATE INDEX "Document_driverId_type_idx" ON "Document"("driverId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_partnerId_idempotencyKey_key" ON "Booking"("partnerId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "Ride_status_pickupAt_idx" ON "Ride"("status", "pickupAt");

-- CreateIndex
CREATE INDEX "Ride_driverId_pickupAt_idx" ON "Ride"("driverId", "pickupAt");

-- CreateIndex
CREATE INDEX "RideEvent_rideId_createdAt_idx" ON "RideEvent"("rideId", "createdAt");

-- CreateIndex
CREATE INDEX "DispatchOffer_status_expiresAt_idx" ON "DispatchOffer"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "DispatchOffer_rideId_driverId_key" ON "DispatchOffer"("rideId", "driverId");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Driver" ADD CONSTRAINT "Driver_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ride" ADD CONSTRAINT "Ride_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ride" ADD CONSTRAINT "Ride_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ride" ADD CONSTRAINT "Ride_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RideEvent" ADD CONSTRAINT "RideEvent_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "Ride"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchOffer" ADD CONSTRAINT "DispatchOffer_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "Ride"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchOffer" ADD CONSTRAINT "DispatchOffer_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rating" ADD CONSTRAINT "Rating_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "Ride"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

