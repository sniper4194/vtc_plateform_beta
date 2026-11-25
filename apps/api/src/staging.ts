/** Préproduction isolée : pas de prestataires payants ni de code OTP fixe. */
export function checkStagingEnv(env:NodeJS.ProcessEnv){
 if(env.APP_ENV!=="staging")return;
 if(env.NODE_ENV!=="production")throw new Error("Staging exige NODE_ENV=production");
 let db:URL;
 try{db=new URL(env.DATABASE_URL??"");}catch{throw new Error("Staging : DATABASE_URL invalide");}
 if(db.hostname!=="db"||db.pathname!=="/clicab_staging")throw new Error("Staging : base isolée clicab_staging sur db requise");
 if(env.SMS_PROVIDER!=="console"||env.EMAIL_PROVIDER!=="console")throw new Error("Staging : prestataires console requis");
 if(env.DRIVER_DEV_OTP||env.CRM_EMAIL_ENABLED==="1"||env.ROUTING_URL||env.ERROR_WEBHOOK_URL||env.RESEND_API_KEY||env.TWILIO_AUTH_TOKEN||env.OVH_APP_SECRET||env.INFOBIP_API_KEY)throw new Error("Staging : intégration externe ou OTP fixe interdit");
 if(env.TRACKING_BASE_URL!=="https://suivi-test.clicab.fr"||env.CORS_ORIGINS!=="https://admin-test.clicab.fr,https://suivi-test.clicab.fr")throw new Error("Staging : domaines dédiés requis");
}
