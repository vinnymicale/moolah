import { describe, expect, it } from "vitest";
import { renderTemplate } from "./render";

describe("renderTemplate", () => {
  it("substitutes known variables", () => {
    expect(renderTemplate("{{category}} is {{spent}} over", { category: "Groceries", spent: "$42.00" }))
      .toBe("Groceries is $42.00 over");
  });

  it("leaves unknown variables literal", () => {
    expect(renderTemplate("hello {{nope}}", { category: "x" })).toBe("hello {{nope}}");
  });

  it("substitutes repeated variables", () => {
    expect(renderTemplate("{{a}} and {{a}}", { a: "1" })).toBe("1 and 1");
  });

  it("returns plain text untouched", () => {
    expect(renderTemplate("no vars here", {})).toBe("no vars here");
  });

  it("renders an empty-string variable", () => {
    expect(renderTemplate("[{{a}}]", { a: "" })).toBe("[]");
  });
});
