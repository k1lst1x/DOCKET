import {
  CognitoIdentityProviderClient,
  ConfirmSignUpCommand,
  InitiateAuthCommand,
  ResendConfirmationCodeCommand,
  RespondToAuthChallengeCommand,
  SignUpCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import type { AuthErrorCode } from "./auth-codes";
import { canReceiveCode } from "./ses-recipients";

// Passwordless sign-in with Amazon Cognito (Essentials tier) email one-time codes.
//   New person:     SignUp (no password) -> code emailed -> ConfirmSignUp -> USER_AUTH with its Session
//   Returning:      InitiateAuth USER_AUTH, PREFERRED_CHALLENGE=EMAIL_OTP -> RespondToAuthChallenge
// The app client has no secret and is only called from the Next.js server.

export class AuthError extends Error {
  constructor(readonly code: AuthErrorCode) {
    super(`auth: ${code}`);
    this.name = "AuthError";
  }
}

export interface CodeChallenge {
  kind: "signup" | "signin";
  cognitoSession: string | null;
}

export interface VerifiedIdentity {
  sub: string;
  email: string;
  name: string | null;
}

interface Settings {
  userPoolId: string;
  clientId: string;
  region: string;
}

function settings(): Settings {
  const userPoolId = process.env.COGNITO_USER_POOL_ID;
  const clientId = process.env.COGNITO_CLIENT_ID;
  if (!userPoolId || !clientId) throw new AuthError("not_configured");
  // Pool IDs look like "us-west-2_AbC123", so the region never needs its own variable.
  return { userPoolId, clientId, region: userPoolId.split("_")[0] };
}

const cache = globalThis as typeof globalThis & { __docketCognito?: CognitoIdentityProviderClient };
const cognito = (region: string) => (cache.__docketCognito ??= new CognitoIdentityProviderClient({ region }));

function createIdTokenVerifier(s: Settings) {
  return CognitoJwtVerifier.create({ userPoolId: s.userPoolId, tokenUse: "id", clientId: s.clientId });
}
let idTokenVerifier: ReturnType<typeof createIdTokenVerifier> | undefined;

export function mapCognitoError(error: unknown): AuthErrorCode {
  switch ((error as { name?: string } | null)?.name) {
    case "CodeMismatchException":
      return "wrong_code";
    case "ExpiredCodeException":
    case "NotAuthorizedException":
      return "expired";
    case "CodeDeliveryFailureException":
      return "undeliverable";
    case "TooManyRequestsException":
    case "TooManyFailedAttemptsException":
    case "LimitExceededException":
      return "busy";
    default:
      return "failed";
  }
}

const asAuthError = (error: unknown) => (error instanceof AuthError ? error : new AuthError(mapCognitoError(error)));
const errorName = (error: unknown) => (error as { name?: string } | null)?.name;

/** Cognito reports no error when SES can't deliver, so check first instead of leaving someone waiting for a code. */
async function requireDeliverable(s: Settings, email: string): Promise<void> {
  if (!(await canReceiveCode(email, s.region))) throw new AuthError("not_invited");
}

async function startSignIn(s: Settings, email: string): Promise<CodeChallenge> {
  try {
    const out = await cognito(s.region).send(
      new InitiateAuthCommand({
        ClientId: s.clientId,
        AuthFlow: "USER_AUTH",
        AuthParameters: { USERNAME: email, PREFERRED_CHALLENGE: "EMAIL_OTP" },
      }),
    );
    if (out.ChallengeName !== "EMAIL_OTP" || !out.Session) throw new AuthError("failed");
    return { kind: "signin", cognitoSession: out.Session };
  } catch (error) {
    // Signed up before but never entered the code: send a fresh confirmation code instead.
    if (errorName(error) === "UserNotConfirmedException") {
      await cognito(s.region).send(new ResendConfirmationCodeCommand({ ClientId: s.clientId, Username: email }));
      return { kind: "signup", cognitoSession: null };
    }
    throw error;
  }
}

/**
 * Emails a code. An email without an account gets one first (with the join
 * form's name, if any); an existing account falls through to a sign-in code.
 * Sign-up always runs first because the app client hides user existence: for
 * an unknown email, InitiateAuth returns a fake challenge and no email is sent.
 */
export async function sendCode(email: string, name: string | null): Promise<CodeChallenge> {
  const s = settings();
  try {
    await requireDeliverable(s, email);
    try {
      const out = await cognito(s.region).send(
        new SignUpCommand({
          ClientId: s.clientId,
          Username: email,
          UserAttributes: [{ Name: "email", Value: email }, ...(name ? [{ Name: "name", Value: name }] : [])],
        }),
      );
      return { kind: "signup", cognitoSession: out.Session ?? null };
    } catch (error) {
      if (errorName(error) !== "UsernameExistsException") throw error;
    }
    return await startSignIn(s, email);
  } catch (error) {
    throw asAuthError(error);
  }
}

export async function resendCode(pending: { kind: "signup" | "signin"; email: string }): Promise<CodeChallenge> {
  const s = settings();
  try {
    await requireDeliverable(s, pending.email);
    if (pending.kind === "signup") {
      await cognito(s.region).send(new ResendConfirmationCodeCommand({ ClientId: s.clientId, Username: pending.email }));
      return { kind: "signup", cognitoSession: null };
    }
    return await startSignIn(s, pending.email);
  } catch (error) {
    throw asAuthError(error);
  }
}

/**
 * Checks the code and returns the verified identity from Cognito's ID token.
 * Throws AuthError("signin_required") when an email was confirmed but Cognito
 * gave no session to finish signing in; the caller then sends a sign-in code.
 */
export async function verifyCode(
  pending: { kind: "signup" | "signin"; email: string; cognitoSession: string | null },
  code: string,
): Promise<VerifiedIdentity> {
  const s = settings();
  const client = cognito(s.region);
  try {
    let idToken: string | undefined;
    if (pending.kind === "signup") {
      const confirmed = await client.send(
        new ConfirmSignUpCommand({
          ClientId: s.clientId,
          Username: pending.email,
          ConfirmationCode: code,
          Session: pending.cognitoSession ?? undefined,
        }),
      );
      if (!confirmed.Session) throw new AuthError("signin_required");
      const out = await client.send(
        new InitiateAuthCommand({
          ClientId: s.clientId,
          AuthFlow: "USER_AUTH",
          AuthParameters: { USERNAME: pending.email },
          Session: confirmed.Session,
        }),
      );
      if (!out.AuthenticationResult?.IdToken) throw new AuthError("signin_required");
      idToken = out.AuthenticationResult.IdToken;
    } else {
      if (!pending.cognitoSession) throw new AuthError("expired");
      const out = await client.send(
        new RespondToAuthChallengeCommand({
          ClientId: s.clientId,
          ChallengeName: "EMAIL_OTP",
          Session: pending.cognitoSession,
          ChallengeResponses: { USERNAME: pending.email, EMAIL_OTP_CODE: code },
        }),
      );
      idToken = out.AuthenticationResult?.IdToken;
    }
    if (!idToken) throw new AuthError("failed");

    idTokenVerifier ??= createIdTokenVerifier(s);
    const claims = await idTokenVerifier.verify(idToken);
    return {
      sub: claims.sub,
      email: String(claims.email ?? pending.email).toLowerCase(),
      name: typeof claims.name === "string" ? claims.name : null,
    };
  } catch (error) {
    throw asAuthError(error);
  }
}
