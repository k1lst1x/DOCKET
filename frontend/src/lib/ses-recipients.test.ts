import { SESv2Client } from "@aws-sdk/client-sesv2";
import { afterEach, expect, it, vi } from "vitest";
import { canReceiveCode, resetRecipientCache } from "./ses-recipients";

afterEach(() => {
  vi.restoreAllMocks();
  resetRecipientCache();
});

it("sends codes to any address once SES production access is on", async () => {
  const send = vi.spyOn(SESv2Client.prototype, "send").mockResolvedValue({ ProductionAccessEnabled: true } as never);
  await expect(canReceiveCode("anyone@example.com", "us-west-2")).resolves.toBe(true);
  expect(send).toHaveBeenCalledTimes(1);
});

it("in the sandbox, only verified addresses and domains get codes", async () => {
  vi.spyOn(SESv2Client.prototype, "send").mockImplementation((async (command: { input: { EmailIdentity?: string } }) => {
    const identity = command.input.EmailIdentity;
    if (identity === undefined) return { ProductionAccessEnabled: false };
    if (identity === "tester@gmail.com" || identity === "team.org") return { VerificationStatus: "SUCCESS" };
    if (identity === "pending@gmail.com") return { VerificationStatus: "PENDING" };
    throw Object.assign(new Error("not found"), { name: "NotFoundException" });
  }) as never);

  await expect(canReceiveCode("tester@gmail.com", "us-west-2")).resolves.toBe(true);
  await expect(canReceiveCode("pending@gmail.com", "us-west-2")).resolves.toBe(false);
  await expect(canReceiveCode("stranger@example.com", "us-west-2")).resolves.toBe(false);
  await expect(canReceiveCode("anyone@team.org", "us-west-2")).resolves.toBe(true);
});

it("fails open when SES can't be asked", async () => {
  vi.spyOn(SESv2Client.prototype, "send").mockRejectedValue(Object.assign(new Error("denied"), { name: "AccessDeniedException" }));
  vi.spyOn(console, "warn").mockImplementation(() => {});
  await expect(canReceiveCode("anyone@example.com", "us-west-2")).resolves.toBe(true);
});
