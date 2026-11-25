import {describe,expect,it} from "vitest";
import {checkStagingEnv} from "./staging";
import {smsProviderFromEnv,ConsoleSmsProvider} from "./sms";
import {emailProviderFromEnv,ConsoleEmailProvider} from "./email";
const env={APP_ENV:"staging",NODE_ENV:"production",DATABASE_URL:"postgresql://vtc:secret@db:5432/clicab_staging?schema=public",SMS_PROVIDER:"console",EMAIL_PROVIDER:"console",TRACKING_BASE_URL:"https://suivi-test.clicab.fr",CORS_ORIGINS:"https://admin-test.clicab.fr,https://suivi-test.clicab.fr"};
describe("Préproduction",()=>{
 it("autorise uniquement les simulateurs en staging",()=>{expect(()=>checkStagingEnv(env)).not.toThrow();expect(smsProviderFromEnv(env)).toBeInstanceOf(ConsoleSmsProvider);expect(emailProviderFromEnv(env)).toBeInstanceOf(ConsoleEmailProvider);expect(smsProviderFromEnv({...env,APP_ENV:"production"})).toBeNull();expect(emailProviderFromEnv({...env,APP_ENV:"production"})).toBeNull();});
 it("refuse la base de production, le code fixe et les prestataires payants",()=>{for(const x of [{DATABASE_URL:"postgresql://vtc:secret@db:5432/vtc"},{DATABASE_URL:"postgresql://vtc:secret@prod:5432/clicab_staging"},{DRIVER_DEV_OTP:"000000"},{SMS_PROVIDER:"ovh"},{EMAIL_PROVIDER:"resend"},{CRM_EMAIL_ENABLED:"1"},{ROUTING_URL:"https://example.com"}])expect(()=>checkStagingEnv({...env,...x})).toThrow();});
 it("refuse une origine de production",()=>{expect(()=>checkStagingEnv({...env,CORS_ORIGINS:"https://admin.clicab.fr"})).toThrow();});
});
