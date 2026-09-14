import { CognitoIdentityProviderClient, type SignUpCommand } from "@aws-sdk/client-cognito-identity-provider";
import { expect, it, vi } from "vitest";
import { AuthError, mapCognitoError, sendCode } from "./cognito";

// SES sandbox check: every address is a verified tester except this one.
vi.mock("./ses-recipients", () => ({ canReceiveCode: vi.fn(async (email: string) => email !== "stranger@example.com") }));

it("maps Cognito errors to sign-in outcome codes", () => {
  expect(mapCognitoError({ name: "CodeMismatchException" })).toBe("wrong_code");
  expect(mapCognitoError({ name: "ExpiredCodeException" })).toBe("expired");
  expect(mapCognitoError({ name: "NotAuthorizedException" })).toBe("expired");
  expect(mapCognitoError({ name: "CodeDeliveryFailureException" })).toBe("undeliverable");
  expect(mapCognitoError({ name: "TooManyRequestsException" })).toBe("busy");
  expect(mapCognitoError({ name: "LimitExceededException" })).toBe("busy");
  expect(mapCognitoError(new Error("network down"))).toBe("failed");
  expect(mapCognitoError(null)).toBe("failed");
});

it("creates the account for a new email on the sign-in form, and signs in an existing one", async () => {
  vi.stubEnv("COGNITO_USER_POOL_ID", "us-west-2_test");
  vi.stubEnv("COGNITO_CLIENT_ID", "client");
  const send = vi.spyOn(CognitoIdentityProviderClient.prototype, "send");

  send.mockResolvedValueOnce({ UserConfirmed: false, Session: "signup-session" } as never);
  await expect(sendCode("new@example.com", null)).resolves.toEqual({ kind: "signup", cognitoSession: "signup-session" });
  expect((send.mock.calls[0][0] as SignUpCommand).input.UserAttributes).toEqual([{ Name: "email", Value: "new@example.com" }]);

  send
    .mockRejectedValueOnce(Object.assign(new Error("exists"), { name: "UsernameExistsException" }))
    .mockResolvedValueOnce({ ChallengeName: "EMAIL_OTP", Session: "signin-session" } as never);
  await expect(sendCode("member@example.com", null)).resolves.toEqual({ kind: "signin", cognitoSession: "signin-session" });

  send.mockRestore();
  vi.unstubAllEnvs();
});

it("refuses to send a code SES could never deliver, without creating an account", async () => {
  vi.stubEnv("COGNITO_USER_POOL_ID", "us-west-2_test");
  vi.stubEnv("COGNITO_CLIENT_ID", "client");
  const send = vi.spyOn(CognitoIdentityProviderClient.prototype, "send");

  const refusal = sendCode("stranger@example.com", "Stranger").catch((error: unknown) => error);
  await expect(refusal).resolves.toBeInstanceOf(AuthError);
  expect(((await refusal) as AuthError).code).toBe("not_invited");
  expect(send).not.toHaveBeenCalled();

  send.mockRestore();
  vi.unstubAllEnvs();
});
