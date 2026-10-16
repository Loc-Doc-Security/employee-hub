import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { LOCDOC_PLATFORM } from "./locdocProduction";

const SECRET_KEYS = [
  "HUB_JWT_SECRET",
  "DATABASE_URL",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "LAB_BOOTSTRAP_ADMIN_PASSWORD",
  "GEMINI_API_KEY",
  "GOOGLE_SERVICE_ACCOUNT_JSON",
  "GOOGLE_WORKSPACE_DELEGATED_USER",
  "GOOGLE_CHAT_WEBHOOK_SECRET",
  "GOOGLE_CHAT_OUTBOUND_WEBHOOK_URL",
  "GOOGLE_CHAT_BOT_SERVICE_ACCOUNT_JSON",
  "GOOGLE_CHAT_LOGO_URL",
  "AWS_S3_BUCKET",
  "SES_FROM_EMAIL",
  "IT_WEBHOOK_URL",
  "N8N_INTEGRATION_KEY",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_FROM_NUMBER",
  "HUB_WEBHOOK_URL",
  "HUB_WEBHOOK_SIGNING_SECRET",
  "LAB_USE_AWS_SECRETS",
];

function isLabDev(env: NodeJS.ProcessEnv): boolean {
  const raw = env.DEV?.trim().toLowerCase();
  if (raw === "true" || raw === "1" || raw === "yes") return true;
  if (raw === "false" || raw === "0" || raw === "no") return false;
  return env.NODE_ENV !== "production";
}

/**
 * In production, read Lab-Hub-Secrets with the ARN baked at setup.
 * The ARN is not a password. DATABASE_URL and HUB_JWT_SECRET stay in AWS.
 */
export async function loadPlatformSecrets(env: NodeJS.ProcessEnv = process.env) {
  const fromEnv = env.LAB_PLATFORM_SECRET_ARN?.trim();
  if (isLabDev(env) && !fromEnv) return { loaded: false as const };
  const baked = isLabDev(env) ? "" : LOCDOC_PLATFORM.platformSecretArn;
  const arn = fromEnv || baked;
  if (!arn) return { loaded: false as const };
  if (!fromEnv && baked) {
    env.LAB_PLATFORM_SECRET_ARN = baked;
    console.log("[startup] using baked LAB_PLATFORM_SECRET_ARN");
  }
  const client = new SecretsManagerClient({ region: LOCDOC_PLATFORM.awsRegion });
  let out;
  try {
    out = await client.send(new GetSecretValueCommand({ SecretId: arn }));
  } catch (err) {
    const name = err && typeof err === "object" && "name" in err ? String(err.name) : "";
    if (name === "CredentialsProviderError" || String(err).includes("Could not load credentials")) {
      throw new Error(
        "LAB_PLATFORM_SECRET_ARN is set but this task has no IAM task role. " +
          "The task role needs secretsmanager:GetSecretValue on Lab-Hub-Secrets.",
        { cause: err },
      );
    }
    throw err;
  }
  if (!out.SecretString) return { loaded: false as const };
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(out.SecretString) as Record<string, unknown>;
  } catch {
    throw new Error("LAB_PLATFORM_SECRET_ARN secret must be JSON");
  }
  for (const key of SECRET_KEYS) {
    const val = parsed[key];
    if (val !== undefined && val !== null && String(val).trim() !== "") {
      env[key] = String(val);
    }
  }
  return { loaded: true as const, keys: Object.keys(parsed).length };
}
