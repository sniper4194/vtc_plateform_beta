-- Badge d'accès aéroport : justificatif obligatoire (facture de parking Aéroports de Paris).
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'AIRPORT_BADGE';
