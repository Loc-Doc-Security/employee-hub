/** LocDoc production values baked in at setup. Passwords stay in AWS Secrets Manager. */

export const LOCDOC_PLATFORM = {
  awsRegion: "us-east-1",
  platformSecretArn:
    "arn:aws:secretsmanager:us-east-1:323643917694:secret:Lab-Hub-Secrets-yALd4A",
  hubJwtIssuer: "lab-hub",
  companyId: "locdoc",
  allowedEmailDomains: "locdoc.net",
  hubCookieDomain: ".locdoc.net",
  dataBackend: "postgres",
  databaseSsl: "1",
  hubDbSchema: "hub",
  hubAppUrl: "https://lab-hub.locdoc.net",
  appUrl: "https://employee-hub.locdoc.net",
  appDbSchema: "employee_hub",
  appDbSchemaEnv: "EMPLOYEE_HUB_DB_SCHEMA",
  listenPort: "3000",
} as const;
