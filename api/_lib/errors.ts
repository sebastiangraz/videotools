// User-fixable errors → 400; the client and smoke run branch on `code`.
type InputErrorCode =
  | "unsupported-source"
  | "unreadable-source"
  | "too-long"
  | "too-large"
  | "invalid-option"
  | "invalid-watermark";

export class InputError extends Error {
  code: InputErrorCode;

  constructor(message: string, code: InputErrorCode) {
    super(message);
    this.name = "InputError";
    this.code = code;
  }
}
