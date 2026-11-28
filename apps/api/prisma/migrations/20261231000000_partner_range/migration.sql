-- Gamme CliCab du partenaire (étiquette et couleur au tableau du dispatcheur).
CREATE TYPE "PartnerRange" AS ENUM ('HOTEL', 'DEPANNAGE', 'ASSOCIATION', 'CARE');
ALTER TABLE "Partner" ADD COLUMN "range" "PartnerRange";
