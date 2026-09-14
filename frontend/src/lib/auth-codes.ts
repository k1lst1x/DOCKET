// Account outcome codes shared by the auth API routes and the client forms.

export type AuthErrorCode =
  // A field is missing or malformed; the response carries `fields`.
  | "invalid"
  // No account matches that email and password.
  | "wrong_password"
  // Registering with an email that already has an account.
  | "email_taken"
  | "busy"
  // The database couldn't be reached.
  | "unavailable"
  | "failed";
