import { expect, it } from "vitest";
import { messages } from "./messageStore";

const shown = () => messages.getSnapshot().message?.excerpt;

it("shows the newest error over any newer remark, and the newest remark once none is left", () => {
  messages.set("remark", { excerpt: "first remark" });
  messages.set("error", { kind: "error", excerpt: "an error" });
  messages.set("later", { excerpt: "later remark" });
  expect(shown()).toBe("an error");

  messages.remove("error");
  expect(shown()).toBe("later remark");
});
