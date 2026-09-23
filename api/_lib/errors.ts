// Something about the request that is the user's to fix: a source the tool
// cannot give back, a clip too long for the format, a logo that is no PNG.
// The functions answer these with a 400 and the `code`, which the client (and
// the smoke run) can tell apart without reading the message; anything else
// that gets thrown is a server fault (500).
export type InputErrorCode =
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
