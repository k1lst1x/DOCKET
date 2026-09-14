// Sign-in outcome codes shared by the auth API routes and the client forms.

export type AuthErrorCode =
  | "not_configured"
  | "wrong_code"
  | "expired"
  | "undeliverable"
  | "busy"
  | "signin_required"
  // The code was right, but the server couldn't finish signing in (for example, no database access).
  | "unavailable"
  | "failed";

/** Result of asking Cognito to email a code: "sent", or why it wasn't. */
export type CodeStatus = "sent" | AuthErrorCode;
