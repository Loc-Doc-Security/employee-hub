import { LOCDOC_PLATFORM } from "./locdocProduction";

function isLabDev(env: NodeJS.ProcessEnv): boolean {
  const raw = env.DEV?.trim().toLowerCase();
  if (raw === "true" || raw === "1" || raw === "yes") return true;
  if (raw === "false" || raw === "0" || raw === "no") return false;
  return env.NODE_ENV !== "production";
}

/** Fill non-secret production settings. Local dev keeps .env.local. */
export function applyLocdocPlatformEnv(env: NodeJS.ProcessEnv = process.env) {
  if (isLabDev(env)) return;
  env.AWS_REGION = LOCDOC_PLATFORM.awsRegion;
  env.AWS_DEFAULT_REGION = LOCDOC_PLATFORM.awsRegion;
  env.PORT = LOCDOC_PLATFORM.listenPort;
  env.DATA_BACKEND = LOCDOC_PLATFORM.dataBackend;
  env.DATABASE_SSL = LOCDOC_PLATFORM.databaseSsl;
  env.HUB_JWT_ISSUER = LOCDOC_PLATFORM.hubJwtIssuer;
  env.LAB_COMPANY_ID = LOCDOC_PLATFORM.companyId;
  env.HUB_DB_SCHEMA = LOCDOC_PLATFORM.hubDbSchema;
  env.HUB_AUTH_ENABLED = "1";
  env.HUB_AUTH_STRICT = "1";
  env.APP_URL = LOCDOC_PLATFORM.appUrl;
  env.HUB_APP_URL = LOCDOC_PLATFORM.hubAppUrl;
  env.HUB_COOKIE_DOMAIN = LOCDOC_PLATFORM.hubCookieDomain;
  env.ALLOWED_EMAIL_DOMAINS = LOCDOC_PLATFORM.allowedEmailDomains;
  env.LAB_PLATFORM_SECRET_ARN = env.LAB_PLATFORM_SECRET_ARN?.trim() || LOCDOC_PLATFORM.platformSecretArn;
  env[LOCDOC_PLATFORM.appDbSchemaEnv] = LOCDOC_PLATFORM.appDbSchema;
}
