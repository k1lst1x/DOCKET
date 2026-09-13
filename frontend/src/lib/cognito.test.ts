import { expect, it } from "vitest";
import { mapCognitoError } from "./cognito";

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
