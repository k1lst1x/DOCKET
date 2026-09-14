import { GetAccountCommand, GetEmailIdentityCommand, SESv2Client } from "@aws-sdk/client-sesv2";

// While the SES account is in the sandbox, Cognito's emails only reach verified addresses, and a
// code sent anywhere else disappears without an error. So the server checks the address before
// sending a code. Testers are added with scripts/ses-testers.sh; once SES production access is
// granted, every address passes.

const ACCOUNT_TTL_MS = 10 * 60_000;
const VERIFIED_TTL_MS = 10 * 60_000;
// Short, so a tester who just clicked the verification link can sign in right away.
const UNVERIFIED_TTL_MS = 30_000;

const clients = new Map<string, SESv2Client>();
const cached = new Map<string, { ok: boolean; until: number }>();

function sesClient(region: string): SESv2Client {
  let client = clients.get(region);
  if (!client) {
    client = new SESv2Client({ region });
    clients.set(region, client);
  }
  return client;
}

async function remember(key: string, check: () => Promise<boolean>, ttl: (ok: boolean) => number): Promise<boolean> {
  const hit = cached.get(key);
  if (hit && hit.until > Date.now()) return hit.ok;
  const ok = await check();
  cached.set(key, { ok, until: Date.now() + ttl(ok) });
  return ok;
}

async function isVerified(ses: SESv2Client, identity: string): Promise<boolean> {
  try {
    const out = await ses.send(new GetEmailIdentityCommand({ EmailIdentity: identity }));
    return out.VerificationStatus === "SUCCESS";
  } catch (error) {
    if ((error as { name?: string } | null)?.name === "NotFoundException") return false;
    throw error;
  }
}

/** Whether a code emailed to this address can arrive. Fails open: if SES can't be asked, the code is sent as before. */
export async function canReceiveCode(email: string, region: string): Promise<boolean> {
  const ses = sesClient(region);
  try {
    const production = await remember(
      `account:${region}`,
      async () => Boolean((await ses.send(new GetAccountCommand({}))).ProductionAccessEnabled),
      () => ACCOUNT_TTL_MS,
    );
    if (production) return true;
    const ttl = (ok: boolean) => (ok ? VERIFIED_TTL_MS : UNVERIFIED_TTL_MS);
    const domain = email.slice(email.lastIndexOf("@") + 1);
    return (
      (await remember(`identity:${email}`, () => isVerified(ses, email), ttl)) ||
      (await remember(`identity:${domain}`, () => isVerified(ses, domain), ttl))
    );
  } catch (error) {
    console.warn(`[docket] could not check SES recipients; sending the code anyway: ${(error as Error)?.name ?? error}`);
    return true;
  }
}

/** Test hook. */
export function resetRecipientCache(): void {
  cached.clear();
}
